import axios from 'axios';
import API_CONFIG, { API_ENDPOINTS, getAxiosConfig, getDefaultHeaders } from '../config/api';
import { handleError, withRetry, isOnline, getUserFriendlyMessage } from '../utils/errorHandler';
import performanceMonitor from '../utils/monitoring';

// 🔧 환경 정보 로깅
if (API_CONFIG.enableDebug) {
  console.log('🔧 API Service 초기화:', {
    environment: API_CONFIG.environment,
    baseURL: API_CONFIG.baseURL,
    apiURL: API_CONFIG.apiURL,
    timestamp: new Date().toISOString()
  });
}

// 📊 API 요청 통계
const apiStats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  lastError: null
};

// 🔍 안전한 로깅 함수
const safeLog = (level, message, data = {}) => {
  if (API_CONFIG.enableDebug) {
    console[level](`[API ${level.toUpperCase()}]`, message, data);
  }
  
  // 에러만 로컬 스토리지에 저장 (최대 5개)
  if (level === 'error') {
    try {
      const logs = JSON.parse(localStorage.getItem('api_error_logs') || '[]');
      logs.unshift({
        timestamp: new Date().toISOString(),
        message,
        data
      });
      localStorage.setItem('api_error_logs', JSON.stringify(logs.slice(0, 5)));
    } catch (e) {
      // 로컬 스토리지 에러 무시
    }
  }
};

// 🚨 에러 분류 함수
const classifyError = (error) => {
  if (error.message?.includes('CORS') || error.message?.includes('Network Error')) {
    return 'NETWORK_ERROR';
  } else if (error.response?.status >= 400 && error.response?.status < 500) {
    return 'CLIENT_ERROR';
  } else if (error.response?.status >= 500) {
    return 'SERVER_ERROR';
  } else {
    return 'UNKNOWN_ERROR';
  }
};

// Axios 인스턴스 생성 (새로운 설정 사용)
const api = axios.create(getAxiosConfig());

// 요청 인터셉터
api.interceptors.request.use(
  (config) => {
    apiStats.totalRequests++;
    config.metadata = { startTime: Date.now() };
    
    // FormData 업로드 요청 감지
    const isFileUpload = config.data instanceof FormData;
    
    // 자동으로 인증 헤더 추가
    const userId = localStorage.getItem('userId');
    const userEmail = localStorage.getItem('userEmail');
    
    if (userId) {
      config.headers['x-user-id'] = userId;
    }
    
    if (userEmail) {
      config.headers['x-user-email'] = userEmail;
    }
    
    // 최신 헤더 정보로 업데이트
    const currentHeaders = getDefaultHeaders();
    
    if (isFileUpload) {
      // 파일 업로드의 경우 Content-Type을 설정하지 않음 (브라우저가 자동으로 multipart/form-data 설정)
      const { 'Content-Type': _, ...headersWithoutContentType } = currentHeaders;
      Object.assign(config.headers, headersWithoutContentType);
      
      // 기존 Content-Type 헤더 완전 제거
      delete config.headers['Content-Type'];
      delete config.headers['content-type'];
    } else {
      // 일반 JSON 요청은 기존대로 처리
      Object.assign(config.headers, currentHeaders);
    }
    
    safeLog('info', '🚀 API Request', {
      method: config.method?.toUpperCase(),
      url: config.url,
      contentType: config.headers['Content-Type'] || 'auto-detect',
      isFileUpload,
      hasAuth: !!userId
    });
    
    return config;
  },
  (error) => {
    apiStats.failedRequests++;
    safeLog('error', '🚨 Request Setup Error', { message: error.message });
    return Promise.reject(error);
  }
);

// 응답 인터셉터 (응답 검증 포함)
api.interceptors.response.use(
  (response) => {
    const endTime = Date.now();
    const duration = endTime - response.config.metadata.startTime;
    
    apiStats.successfulRequests++;
    
    // 응답 데이터 검증
    if (response.data) {
      // 표준 API 응답 형식 검증
      const hasStandardFormat = (
        response.data.hasOwnProperty('success') ||
        response.data.hasOwnProperty('data') ||
        response.data.hasOwnProperty('error')
      );
      
      // 비표준 형식이지만 유효한 데이터인 경우도 허용
      const hasValidData = (
        Array.isArray(response.data) ||
        (typeof response.data === 'object' && Object.keys(response.data).length > 0)
      );
      
      if (!hasStandardFormat && !hasValidData) {
        console.warn('⚠️ 비표준 API 응답 형식:', {
          url: response.config.url,
          data: response.data
        });
      }
    }
    
    safeLog('info', '✅ API Response', {
      method: response.config.method?.toUpperCase(),
      url: response.config.url,
      status: response.status,
      duration: `${duration}ms`,
      hasData: !!response.data
    });
    
    return response;
  },
  (error) => {
    const endTime = Date.now();
    const duration = error.config?.metadata ? endTime - error.config.metadata.startTime : 0;
    
    apiStats.failedRequests++;
    
    // 401 에러 시 자동 로그인 모달 표시
    if (error.response?.status === 401) {
      safeLog('warn', '🔐 인증 오류 - 로그인 필요', {
        url: error.config?.url,
        status: error.response.status
      });
      
      // 로그인 모달 표시 (전역 이벤트 발생)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:loginRequired', {
          detail: { reason: '인증이 필요합니다', redirectUrl: window.location.pathname }
        }));
      }
    }
    
    // 에러 로깅
    const errorInfo = {
      method: error.config?.method?.toUpperCase(),
      url: error.config?.url,
      status: error.response?.status,
      statusText: error.response?.statusText,
      duration: `${duration}ms`,
      message: error.message
    };
    
    if (error.response?.status >= 500) {
      safeLog('error', '🚨 Server Error', errorInfo);
    } else if (error.response?.status >= 400) {
      safeLog('warn', '⚠️ Client Error', errorInfo);
    } else {
      safeLog('error', '❌ Network Error', errorInfo);
    }
    
    return Promise.reject(error);
  }
);

// API 디버깅 함수
if (API_CONFIG.enableDebug && typeof window !== 'undefined') {
  window.apiDebug = {
    getStats: () => apiStats,
    getErrorLogs: () => JSON.parse(localStorage.getItem('api_error_logs') || '[]'),
    clearErrorLogs: () => localStorage.removeItem('api_error_logs'),
    getConfig: () => API_CONFIG,
    getEndpoints: () => API_ENDPOINTS
  };
}

// 🔄 개선된 API 호출 함수 (에러 핸들링 강화)
const apiCall = async (method, url, data = null, options = {}) => {
  const maxRetries = options.retries || 3;
  const showUserError = options.showUserError !== false;
  let lastError;
  
  // 오프라인 체크
  if (!isOnline()) {
    const offlineError = new Error('인터넷 연결을 확인해주세요.');
    offlineError.isOffline = true;
    throw offlineError;
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const config = {
        method,
        url,
        timeout: options.timeout || 15000,
        metadata: { startTime: Date.now() },
        ...options
      };
      
      if (data && ['post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
        config.data = data;
      }
      
      const response = await api(config);
      
      // 성공 시 이전 에러 클리어
      if (attempt > 1) {
        safeLog('info', `✅ API 호출 성공 (${attempt}번째 시도)`, { url });
      }
      
      // 성공한 API 호출 모니터링 기록
      const duration = Date.now() - (config.metadata?.startTime || Date.now());
      performanceMonitor.recordAPICall(
        url,
        method.toUpperCase(),
        duration,
        response.status
      );
      
      return response;
    } catch (error) {
      lastError = error;
      
      // 에러에 컨텍스트 정보 추가
      error.apiContext = {
        method: method.toUpperCase(),
        url,
        attempt,
        maxRetries
      };
      
      // 재시도 불가능한 에러 체크
      const shouldNotRetry = (
        error.response?.status === 401 || 
        error.response?.status === 403 || 
        error.response?.status === 404 ||
        error.response?.status === 422
      );
      
      if (shouldNotRetry) {
        safeLog('error', '🚫 재시도 불가 에러', { 
          url, 
          status: error.response?.status,
          message: error.message 
        });
        break;
      }
      
      if (attempt < maxRetries) {
        const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 5000);
        safeLog('warn', `🔄 API 재시도 ${attempt}/${maxRetries} (${delay}ms 후)`, {
          url,
          error: error.message,
          status: error.response?.status
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        safeLog('error', '❌ 모든 재시도 실패', { url, attempts: maxRetries });
      }
    }
  }
  
  // 최종 에러 처리
  if (lastError) {
    // 사용자 친화적 에러 메시지 추가
    if (showUserError) {
      lastError.userMessage = getUserFriendlyMessage(lastError);
    }
    
    // 성능 모니터링에 API 호출 기록
    const totalDuration = Date.now() - (lastError.apiContext?.startTime || Date.now());
    performanceMonitor.recordAPICall(
      url,
      method.toUpperCase(),
      totalDuration,
      lastError.response?.status || 0,
      lastError
    );
    
    // 에러 보고 (개발/프로덕션 환경별)
    handleError(lastError, {
      context: {
        component: 'apiCall',
        action: `${method.toUpperCase()} ${url}`,
        attempts: maxRetries
      },
      logError: true,
      showToUser: false // API 레벨에서는 로깅만, UI에서 표시
    });
  }
  
  throw lastError;
};

// Characters API (최적화됨)
export const charactersAPI = {
  // 추천 캐릭터 조회 (For You 페이지용) - 최적화
  getRecommended: async () => {
    try {
      console.log('🔍 추천 캐릭터 API 호출 시작');
      
      const response = await api.get('/characters/recommended');
      
      console.log('✅ 추천 캐릭터 API 응답:', {
        count: response.data?.length || 0,
        hasData: Array.isArray(response.data)
      });
      
      // 데이터 검증 및 후처리
      if (!Array.isArray(response.data)) {
        console.error('❌ 추천 캐릭터 응답 형식 오류:', response.data);
        return { data: [] };
      }
      
      // 캐릭터 데이터 최적화
      const optimizedCharacters = response.data.map(character => ({
        ...character,
        // 기본값 설정
        firstImpression: character.firstImpression || character.description || '새로운 AI 캐릭터입니다.',
        personality: character.personality || '친근한',
        description: character.description || '대화를 나누고 싶은 캐릭터',
        // 이미지 URL 검증
        avatarUrl: character.avatarUrl && character.avatarUrl.startsWith('http') 
          ? character.avatarUrl 
          : character.avatarUrl 
            ? `https://mingling-uploads.s3.ap-northeast-2.amazonaws.com/${character.avatarUrl}`
            : null
      }));
      
      return { data: optimizedCharacters };
    } catch (error) {
      console.error('❌ 추천 캐릭터 조회 실패:', error);
      
      // 네트워크 에러나 서버 에러 시 빈 배열 반환
      if (error.response?.status >= 500 || !error.response) {
        console.log('🔄 서버 에러로 인한 빈 배열 반환');
        return { data: [] };
      }
      
      throw error;
    }
  },

  // 내 캐릭터 목록 조회 - 최적화
  getMy: async () => {
    try {
      console.log('👤 내 캐릭터 API 호출');
      
      const response = await api.get('/characters/my');
      
      if (!Array.isArray(response.data)) {
        console.error('❌ 내 캐릭터 응답 형식 오류:', response.data);
        return { data: [] };
      }
      
      // 이미지 URL 최적화
      const optimizedCharacters = response.data.map(character => ({
        ...character,
        avatarUrl: character.avatarUrl && character.avatarUrl.startsWith('http') 
          ? character.avatarUrl 
          : character.avatarUrl 
            ? `https://mingling-uploads.s3.ap-northeast-2.amazonaws.com/${character.avatarUrl}`
            : null
      }));
      
      console.log('✅ 내 캐릭터 조회 성공:', optimizedCharacters.length, '개');
      return { data: optimizedCharacters };
    } catch (error) {
      console.error('❌ 내 캐릭터 조회 실패:', error);
      return { data: [] };
    }
  },

  // 모든 캐릭터 조회 - 최적화
  getAll: async () => {
    try {
      console.log('🌐 모든 캐릭터 API 호출');
      
      const response = await api.get('/characters');
      
      if (!Array.isArray(response.data)) {
        console.error('❌ 모든 캐릭터 응답 형식 오류:', response.data);
        return { data: [] };
      }
      
      // 이미지 URL 최적화
      const optimizedCharacters = response.data.map(character => ({
        ...character,
        avatarUrl: character.avatarUrl && character.avatarUrl.startsWith('http') 
          ? character.avatarUrl 
          : character.avatarUrl 
            ? `https://mingling-uploads.s3.ap-northeast-2.amazonaws.com/${character.avatarUrl}`
            : null
      }));
      
      console.log('✅ 모든 캐릭터 조회 성공:', optimizedCharacters.length, '개');
      return { data: optimizedCharacters };
    } catch (error) {
      console.error('❌ 모든 캐릭터 조회 실패:', error);
      return { data: [] };
    }
  },

  // 특정 캐릭터 조회 - 최적화
  getById: async (id) => {
    try {
      console.log('🔍 캐릭터 상세 조회:', id);
      
      const response = await api.get(`/characters/${id}`);
      
      // 이미지 URL 최적화
      const character = {
        ...response.data,
        avatarUrl: response.data.avatarUrl && response.data.avatarUrl.startsWith('http') 
          ? response.data.avatarUrl 
          : response.data.avatarUrl 
            ? `https://mingling-uploads.s3.ap-northeast-2.amazonaws.com/${response.data.avatarUrl}`
            : null
      };
      
      console.log('✅ 캐릭터 상세 조회 성공:', character.name);
      return { data: character };
    } catch (error) {
      console.error('❌ 캐릭터 상세 조회 실패:', error);
      throw error;
    }
  },
  
  // 캐릭터 생성 (최적화됨)
  create: async (characterData) => {
    try {
      // 필수 필드 검증
      if (!characterData.name?.trim()) {
        throw new Error('캐릭터 이름은 필수입니다.');
      }
      if (!characterData.avatarUrl?.trim()) {
        throw new Error('프로필 이미지는 필수입니다.');
      }
      
      const response = await apiCall('post', API_ENDPOINTS.CHARACTERS.BASE, characterData, { 
        retries: 2,
        timeout: 20000 
      });
      
      safeLog('info', '✅ 캐릭터 생성 성공', { characterId: response.data.id, name: response.data.name });
      return response;
    } catch (error) {
      safeLog('error', '❌ 캐릭터 생성 실패', { error: error.message, characterData: { name: characterData.name } });
      throw error;
    }
  },
  
  // 캐릭터 수정 (최적화됨)
  update: async (id, characterData) => {
    try {
      const response = await apiCall('put', API_ENDPOINTS.CHARACTERS.BY_ID(id), characterData, { 
        retries: 2,
        timeout: 20000 
      });
      
      safeLog('info', '✅ 캐릭터 수정 성공', { characterId: id, name: response.data.name });
      return response;
    } catch (error) {
      safeLog('error', '❌ 캐릭터 수정 실패', { characterId: id, error: error.message });
      throw error;
    }
  },
  
  delete: (id) => apiCall('delete', API_ENDPOINTS.CHARACTERS.BY_ID(id), null, { timeout: 10000 }),
  getTypes: () => apiCall('get', API_ENDPOINTS.CHARACTERS.TYPES, null, { timeout: 5000 }),
  getHashtags: () => apiCall('get', API_ENDPOINTS.CHARACTERS.HASHTAGS, null, { timeout: 5000 })
};

// Personas API
export const personasAPI = {
  getAll: () => apiCall('get', API_ENDPOINTS.PERSONAS.BASE),
  getMy: () => apiCall('get', API_ENDPOINTS.PERSONAS.MY),
  getById: (id) => apiCall('get', API_ENDPOINTS.PERSONAS.BY_ID(id)),
  create: (personaData) => apiCall('post', API_ENDPOINTS.PERSONAS.BASE, personaData),
  update: (id, personaData) => apiCall('put', API_ENDPOINTS.PERSONAS.BY_ID(id), personaData),
  delete: (id) => apiCall('delete', API_ENDPOINTS.PERSONAS.BY_ID(id))
};

// Chats API
export const chatsAPI = {
  getAll: () => apiCall('get', API_ENDPOINTS.CHATS.BASE),
  getById: (id) => apiCall('get', API_ENDPOINTS.CHATS.BY_ID(id)),
  create: (chatData) => apiCall('post', API_ENDPOINTS.CHATS.BASE, chatData),
  update: (id, chatData) => apiCall('put', API_ENDPOINTS.CHATS.BY_ID(id), chatData),
  delete: (id) => apiCall('delete', API_ENDPOINTS.CHATS.BY_ID(id)),
  getMessages: (chatId) => apiCall('get', API_ENDPOINTS.CHATS.MESSAGES(chatId)),
  sendMessage: (chatId, messageData) => apiCall('post', API_ENDPOINTS.CHATS.MESSAGES(chatId), messageData),
  getRecommendations: (chatId) => apiCall('get', `${API_ENDPOINTS.CHATS.BY_ID(chatId)}/recommendations`),
  addReaction: (messageId, emoji) => apiCall('post', `/messages/${messageId}/reactions`, { emoji }),
  removeReaction: (messageId, emoji) => {
    const encodedEmoji = encodeURIComponent(emoji);
    return apiCall('delete', `/messages/${messageId}/reactions/${encodedEmoji}`);
  },
};

// Conversations API
export const conversationsAPI = {
  getAll: () => apiCall('get', API_ENDPOINTS.CONVERSATIONS.BASE),
  getById: (id) => apiCall('get', API_ENDPOINTS.CONVERSATIONS.BY_ID(id)),
  create: (conversationData) => apiCall('post', API_ENDPOINTS.CONVERSATIONS.BASE, conversationData),
  update: (id, conversationData) => apiCall('put', API_ENDPOINTS.CONVERSATIONS.BY_ID(id), conversationData),
  delete: (id) => apiCall('delete', API_ENDPOINTS.CONVERSATIONS.BY_ID(id))
};

// Relations/Favorability API
export const relationsAPI = {
  getAll: () => apiCall('get', API_ENDPOINTS.RELATIONS.BASE),
  getByCharacter: (characterId) => apiCall('get', API_ENDPOINTS.RELATIONS.BY_CHARACTER(characterId)),
  getHistory: (characterId, limit = 20, offset = 0) => 
    apiCall('get', `${API_ENDPOINTS.RELATIONS.HISTORY(characterId)}?limit=${limit}&offset=${offset}`),
  processEvent: (characterId, eventData) => 
    apiCall('post', API_ENDPOINTS.RELATIONS.EVENT(characterId), eventData),
  adjustScore: (characterId, adjustData) => 
    apiCall('post', API_ENDPOINTS.RELATIONS.ADJUST(characterId), adjustData)
};

// Hearts API (최적화됨)
export const heartsAPI = {
  // 하트 잔액 조회 (캐싱 포함)
  getBalance: async () => {
    try {
      const response = await apiCall('get', API_ENDPOINTS.HEARTS.BALANCE, null, { timeout: 10000 });
      
      // 로컬 캐시에 저장 (1분 유효)
      localStorage.setItem('heartBalance', JSON.stringify({
        hearts: response.data.hearts,
        timestamp: Date.now()
      }));
      
      return response;
    } catch (error) {
      // 캐시된 데이터 사용 시도
      try {
        const cached = JSON.parse(localStorage.getItem('heartBalance') || '{}');
        if (cached.hearts && Date.now() - cached.timestamp < 60000) {
          safeLog('warn', '🔄 하트 잔액 캐시 사용', { cachedHearts: cached.hearts });
          return { data: { hearts: cached.hearts } };
        }
      } catch (cacheError) {
        // 캐시 에러 무시
      }
      throw error;
    }
  },
  
  // 하트 충전
  charge: (amount) => apiCall('post', API_ENDPOINTS.HEARTS.CHARGE, { amount }, { 
    retries: 2,
    timeout: 20000 // 결제는 더 긴 타임아웃
  }),
  
  // 하트 구매
  purchase: (purchaseData) => apiCall('post', API_ENDPOINTS.HEARTS.PURCHASE, purchaseData, { 
    retries: 2,
    timeout: 30000 // 결제는 가장 긴 타임아웃
  }),
  
  // 하트 거래 내역
  getTransactions: () => apiCall('get', API_ENDPOINTS.HEARTS.TRANSACTIONS, null, { timeout: 10000 }),
  
  // 하트 사용
  spend: async (amount, description = '') => {
    try {
      const response = await apiCall('post', API_ENDPOINTS.HEARTS.SPEND, { 
        amount, 
        description 
      }, { 
        retries: 3,
        timeout: 15000 
      });
      
      // 하트 잔액 변경 전역 이벤트 발생
      if (response.data.hearts !== undefined) {
        window.dispatchEvent(new CustomEvent('hearts:balanceChanged', {
          detail: { 
            newBalance: response.data.hearts, 
            change: -amount,
            reason: description || '하트 사용'
          }
        }));
      }
      
      safeLog('info', '💖 하트 사용 성공', { amount, newBalance: response.data.hearts });
      return response;
    } catch (error) {
      safeLog('error', '❌ 하트 사용 실패', { amount, error: error.message });
      throw error;
    }
  },
  
  // 하트 환불
  refund: async (amount, description = '') => {
    try {
      const response = await apiCall('post', API_ENDPOINTS.HEARTS.REFUND, { 
        amount, 
        description 
      }, { 
        retries: 3,
        timeout: 15000 
      });
      
      // 하트 잔액 변경 전역 이벤트 발생
      if (response.data.hearts !== undefined) {
        window.dispatchEvent(new CustomEvent('hearts:balanceChanged', {
          detail: { 
            newBalance: response.data.hearts, 
            change: +amount,
            reason: description || '하트 환불'
          }
        }));
      }
      
      safeLog('info', '💖 하트 환불 성공', { amount, newBalance: response.data.hearts });
      return response;
    } catch (error) {
      safeLog('error', '❌ 하트 환불 실패', { amount, error: error.message });
      throw error;
    }
  }
};

// Users API
export const usersAPI = {
  getMe: () => apiCall('get', API_ENDPOINTS.USERS.ME),
  update: (userData) => apiCall('put', API_ENDPOINTS.USERS.UPDATE, userData)
};

// Upload API
export const uploadAPI = {
  image: (formData) => apiCall('post', API_ENDPOINTS.UPLOAD.IMAGE, formData, {
    // Content-Type 헤더를 제거하여 브라우저가 자동으로 multipart/form-data를 설정하도록 함
  }),
  characterImage: (formData) => apiCall('post', API_ENDPOINTS.UPLOAD.CHARACTER, formData, {
    // Content-Type 헤더를 제거하여 브라우저가 자동으로 multipart/form-data를 설정하도록 함
  }),
  personaImage: (formData) => apiCall('post', API_ENDPOINTS.UPLOAD.PERSONA, formData, {
    // Content-Type 헤더를 제거하여 브라우저가 자동으로 multipart/form-data를 설정하도록 함
  }),
  userProfile: (formData) => apiCall('post', API_ENDPOINTS.UPLOAD.USER_PROFILE, formData, {
    // Content-Type 헤더를 제거하여 브라우저가 자동으로 multipart/form-data를 설정하도록 함
  })
};

// Health/Debug API
export const debugAPI = {
  health: () => apiCall('get', API_ENDPOINTS.HEALTH),
  stats: () => apiCall('get', API_ENDPOINTS.DEBUG.STATS)
};

// 기본 axios 인스턴스와 설정 내보내기
export { api as default, API_CONFIG, API_ENDPOINTS, apiCall }; 