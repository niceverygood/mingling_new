import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, HeartIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../context/AuthContext';
import { useHearts } from '../hooks/useHearts';
import Avatar from '../components/Avatar';
import TypingAnimation from '../components/TypingAnimation';
import RelationshipModal from '../components/RelationshipModal';
import CharacterDetail from './CharacterCreation/CharacterDetail';


// API imports
import * as charactersAPI from '../services/api';
import * as conversationsAPI from '../services/api';
import { heartsAPI, chatsAPI } from '../services/api';
import { getRelationInfo } from '../services/relationshipAPI';
import { openHeartShop, isInApp, listenForHeartUpdates } from '../utils/webview';
import { usePopup } from '../context/PopupContext';

const ChatPage = () => {
  const { chatId } = useParams();
  const navigate = useNavigate();
  // eslint-disable-next-line no-unused-vars
  const { isLoggedIn, user: authUser } = useAuth();
  
  // 커스텀 팝업 훅
  const { showInsufficientHearts, showError } = usePopup();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatInfo, setChatInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  // 하트 초기값을 로컬 스토리지에서 가져오기
  const getInitialHearts = () => {
    try {
      const cached = localStorage.getItem('heartBalance');
      if (cached) {
        const parsed = JSON.parse(cached);
        // 캐시가 1시간 이내인 경우에만 사용
        if (Date.now() - parsed.timestamp < 3600000) {
          console.log('📦 로컬 캐시에서 하트 잔액 복원:', parsed.hearts);
          return parsed.hearts;
        }
      }
    } catch (e) {
      console.warn('로컬 스토리지 로드 실패:', e);
    }
    return 150; // 기본값
  };

  const [hearts, setHearts] = useState(getInitialHearts);

  // 하트 업데이트 통합 함수 (로컬 스토리지 동기화 포함)
  const updateHearts = (newHearts, transactionId = null) => {
    setHearts(newHearts);
    
    // 로컬 스토리지 동기화
    try {
      localStorage.setItem('heartBalance', JSON.stringify({
        hearts: newHearts,
        timestamp: Date.now(),
        lastTransaction: transactionId
      }));
    } catch (e) {
      console.warn('로컬 스토리지 동기화 실패:', e);
    }
    
    console.log('💎 하트 잔액 업데이트:', {
      새잔액: newHearts,
      트랜잭션ID: transactionId,
      시간: new Date().toLocaleTimeString()
    });
  };
  const [heartLoading, setHeartLoading] = useState(false);
  const [isGeneratingResponse, setIsGeneratingResponse] = useState(false);
  const [hasInitiallyScrolled, setHasInitiallyScrolled] = useState(false);
  
  // 타이핑 애니메이션 관련 상태
  const [typingMessage, setTypingMessage] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  
  // 호감도 관련 상태
  const [relationInfo, setRelationInfo] = useState(null);
  


  
  // 모바일 터치 최적화 상태
  const [touchStartY, setTouchStartY] = useState(0);
  const [touchEndY, setTouchEndY] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [buttonPressed, setButtonPressed] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  
  // 모바일 최적화를 위한 ref
  const containerRef = useRef(null);
  const messagesContainerRef = useRef(null);
  
  // 다음 단계까지 남은 점수 계산 (실시간 업데이트)
  const nextStageInfo = useMemo(() => {
    if (!relationInfo) return null;
    
    const stageThresholds = {
      0: { next: 150, label: '친구 😊' },
      1: { next: 300, label: '썸 전야 😄' },
      2: { next: 500, label: '연인 💕' },
      3: { next: 700, label: '진지한 관계 💖' },
      4: { next: 850, label: '약혼 💍' },
      5: { next: 930, label: '결혼 👑' }
    };
    
    const currentStage = relationInfo.stage;
    if (currentStage >= 6) return null; // 최대 단계
    
    const nextThreshold = stageThresholds[currentStage];
    const pointsNeeded = nextThreshold.next - relationInfo.score;
    
    return {
      nextStageLabel: nextThreshold.label,
      pointsNeeded: Math.max(0, pointsNeeded),
      progressPercentage: ((relationInfo.score / 1000) * 100).toFixed(1)
    };
  }, [relationInfo]);
  
  // 스크롤 자동 이동을 위한 ref
  const messagesEndRef = useRef(null);
  // 텍스트 입력 필드 커서 유지를 위한 ref
  const inputRef = useRef(null);

  // 관계 모달 상태 추가
  const [isRelationshipModalOpen, setIsRelationshipModalOpen] = useState(false);
  
  // 캐릭터 상세 모달 상태 추가
  const [showCharacterDetail, setShowCharacterDetail] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(null);

  // 모바일 터치 이벤트 핸들러
  const handleTouchStart = (e) => {
    setTouchStartY(e.touches[0].clientY);
    setIsScrolling(true);
  };

  const handleTouchEnd = (e) => {
    setTouchEndY(e.changedTouches[0].clientY);
    setIsScrolling(false);
  };

  // 터치 피드백 핸들러
  const handleButtonPress = (buttonId) => {
    setButtonPressed(buttonId);
    setTimeout(() => setButtonPressed(null), 150);
  };

  // 중복 터치 방지 핸들러
  const handleSendWithPreventDuplication = async () => {
    if (sendingMessage) return;
    setSendingMessage(true);
    
    try {
      await handleSendMessage();
    } finally {
      setTimeout(() => setSendingMessage(false), 500);
    }
  };

  // 최초 메시지 로딩 완료 시에만 스크롤 실행 (메시지 변경에 반응하지 않음)
  useEffect(() => {
    if (!loading && !hasInitiallyScrolled) {
      // 메시지가 있든 없든 스크롤 위치를 최하단으로 설정 (애니메이션 없이 즉시)
      setTimeout(() => {
        scrollToBottomInstant();
        setHasInitiallyScrolled(true);
      }, 50); // 더 짧은 딜레이로 빠르게 스크롤
    }
  }, [loading, hasInitiallyScrolled]); // messages 의존성 제거

  // 새 메시지 전송 시에만 스크롤 (AI 응답 생성 중일 때)
  useEffect(() => {
    if (isGeneratingResponse) {
      scrollToBottom();
    }
  }, [isGeneratingResponse]);

  // 타이핑 애니메이션 시작 시 스크롤
  useEffect(() => {
    if (isTyping) {
      scrollToBottom();
    }
  }, [isTyping]);

  // 새 메시지가 추가될 때마다 스크롤 (메시지 배열 변경 감지)
  useEffect(() => {
    if (hasInitiallyScrolled && messages.length > 0) {
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 100); // 메시지 렌더링 완료 후 스크롤
      
      return () => clearTimeout(timer);
    }
  }, [messages.length, hasInitiallyScrolled]);

  // 즉시 스크롤 (애니메이션 없음) - 초기 로딩 시 사용
  const scrollToBottomInstant = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  };

  // 부드러운 스크롤 - 새 메시지 전송 시 사용
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (chatId) {
      // 새로운 채팅방으로 이동할 때 초기화
      setHasInitiallyScrolled(false);
      fetchChatInfo();
      fetchMessages();
      fetchHeartBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // 네이티브 앱에서 하트 업데이트 리스너
  useEffect(() => {
    if (isInApp()) {
      const removeListener = listenForHeartUpdates((newHearts) => {
        console.log('📱 네이티브에서 하트 업데이트 수신:', newHearts);
        updateHearts(newHearts, 'native-update');
      });
      
      return removeListener;
    }
  }, []);

  // 감정 관련 함수 제거됨

  // 호감도 정보 불러오기 (개선된 버전)
  const fetchRelationInfo = async (characterId) => {
    if (!characterId) {
      console.warn('⚠️ 캐릭터 ID가 없어 관계 정보를 불러올 수 없습니다.');
      return;
    }

    try {
      console.log('🔄 관계 정보 불러오기 시도:', characterId);
      const relationData = await getRelationInfo(characterId);
      console.log('✅ 관계 정보 불러오기 성공:', relationData);
      
      if (relationData && relationData.data) {
        // 안전한 데이터 검증
        const safeRelationData = {
          score: typeof relationData.data.score === 'number' ? relationData.data.score : 0,
          stage: typeof relationData.data.stage === 'number' ? relationData.data.stage : 0,
          stageChanged: Boolean(relationData.data.stageChanged),
          ...relationData.data
        };
        setRelationInfo(safeRelationData);
      } else {
        // 기본값 설정
        console.log('⚠️ 관계 정보가 없어 기본값으로 설정');
        setRelationInfo({
          score: 0,
          stage: 0,
          stageChanged: false
        });
      }
    } catch (error) {
      console.error('❌ 관계 정보 불러오기 실패:', error);
      // 네트워크 오류와 서버 오류 구분
      if (error.response?.status >= 500) {
        console.error('서버 에러로 관계 정보 로딩 실패');
      } else if (error.code === 'NETWORK_ERROR') {
        console.error('네트워크 에러로 관계 정보 로딩 실패');
      }
      
      // 기본값 설정 (에러 발생 시에도 UI는 정상 표시)
      setRelationInfo({
        score: 0,
        stage: 0,
        stageChanged: false
      });
    }
  };

  // 채팅 정보가 로드되면 호감도 정보도 불러오기
  useEffect(() => {
    if (chatInfo?.character?.id) {
      fetchRelationInfo(chatInfo.character.id);
      
      // 첫 만남 감지 (메시지가 없거나 1개 이하인 경우)
      // if (messages.length <= 1) { // 첫 만남 애니메이션 제거
      //   setIsFirstMeeting(true);
      // }
    }
  }, [chatInfo, messages.length]);

  const fetchHeartBalance = async (force = false) => {
    try {
      console.log('💎 하트 잔액 조회 시도...', { force, currentHearts: hearts });
      
      const response = await heartsAPI.getBalance();
      
      if (response.data && response.data.success && typeof response.data.data.hearts === 'number') {
        const newHearts = response.data.data.hearts;
        const previousHearts = hearts;
        
        updateHearts(newHearts);
        
        console.log('✅ 하트 잔액 조회 성공:', {
          이전잔액: previousHearts,
          현재잔액: newHearts,
          변동량: newHearts - previousHearts,
          lastUpdated: response.data.data.lastUpdated
        });

        // 하트가 0이 되면 사용자에게 알림
        if (newHearts === 0 && previousHearts > 0) {
          console.log('⚠️ 하트가 모두 소진되었습니다!');
          // 선택적으로 사용자에게 알림 표시
        }
        
        return newHearts;
      } else {
        console.warn('⚠️ 하트 잔액 응답 형식 오류:', response.data);
        return hearts; // 기존 값 유지
      }
    } catch (error) {
      console.error('❌ 하트 잔액 조회 실패:', error);
      
      // 에러 유형별 처리
      if (error.response?.status === 401) {
        console.error('인증 오류 - 로그인이 필요합니다');
        // 로그인 페이지로 리다이렉트 고려
      } else if (error.response?.status >= 500) {
        console.error('서버 에러로 하트 잔액 조회 실패');
      } else if (error.code === 'NETWORK_ERROR') {
        console.error('네트워크 에러로 하트 잔액 조회 실패');
      }
      
      return hearts; // 실패 시 기존 값 유지
    }
  };

  const fetchChatInfo = async () => {
    if (!chatId) {
      console.warn('⚠️ 채팅 ID가 없어 채팅 정보를 불러올 수 없습니다.');
      return;
    }

    try {
      console.log('🔄 채팅 정보 불러오기 시도:', chatId);
      // 채팅 목록에서 해당 채팅 정보 찾기
      const response = await chatsAPI.getAll();
      if (Array.isArray(response.data)) {
        const chat = response.data.find(c => c.id === chatId);
        if (chat) {
          setChatInfo(chat);
          console.log('✅ 채팅 정보 로딩 성공:', chat.character?.name);
        } else {
          console.warn('⚠️ 해당 채팅을 찾을 수 없습니다:', chatId);
          setChatInfo(null);
        }
      } else {
        console.error('❌ 채팅 목록 응답 형식 오류:', response.data);
        setChatInfo(null);
      }
    } catch (error) {
      console.error('❌ 채팅 정보 로딩 실패:', error);
      // 네트워크 오류 시 사용자에게 알림
      if (error.response?.status >= 500) {
        console.error('서버 에러로 채팅 정보 로딩 실패');
      } else if (error.code === 'NETWORK_ERROR') {
        console.error('네트워크 에러로 채팅 정보 로딩 실패');
      }
      setChatInfo(null);
    }
  };

  const fetchMessages = async () => {
    if (!chatId) {
      console.warn('⚠️ 채팅 ID가 없어 메시지를 불러올 수 없습니다.');
      setMessages([]);
      setLoading(false);
      return;
    }

    try {
      console.log('🔄 메시지 불러오기 시도:', chatId);
      const response = await chatsAPI.getMessages(chatId);
      // 응답이 배열인지 확인
      if (Array.isArray(response.data)) {
        setMessages(response.data);
        console.log('✅ 메시지 로딩 성공:', response.data.length, '개');
      } else {
        console.error('❌ 메시지 응답 형식 오류:', response.data);
        setMessages([]);
      }
    } catch (error) {
      console.error('❌ 메시지 로딩 실패:', error);
      // 네트워크 오류 시 사용자에게 알림
      if (error.response?.status >= 500) {
        console.error('서버 에러로 메시지 로딩 실패');
      } else if (error.code === 'NETWORK_ERROR') {
        console.error('네트워크 에러로 메시지 로딩 실패');
      } else if (error.response?.status === 404) {
        console.warn('채팅을 찾을 수 없습니다 - 새로운 채팅일 수 있습니다');
      }
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;
    
    // 하트가 부족한 경우
    if (hearts < 1) {
      console.log('💔 하트 부족으로 메시지 전송 차단:', { currentHearts: hearts });
      handleButtonPress('heart-insufficient');
      if (isInApp()) {
        // 네이티브 앱에서는 네이티브 하트샵 열기
        openHeartShop(hearts);
      } else {
        // 웹에서는 기존 팝업 방식 유지
        showInsufficientHearts(hearts, {
          onConfirm: () => navigate('/heart-shop'),
          onCancel: () => {}
        });
      }
      return;
    }

    console.log('💎 메시지 전송 시작 - 현재 하트:', hearts, '| 차감 예정:', 1);

    // 전송할 메시지 내용을 미리 저장 (언어 변환 방지)
    const userMessageContent = newMessage.trim();
    
    // 입력창 즉시 비우기 (전송 후 언어 변환 방지)
    setNewMessage('');
    
    // 입력 필드에 포커스 유지 (약간의 딜레이 후 실행)
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);

    // 사용자 메시지를 즉시 화면에 추가
    const tempUserMessage = {
      id: `temp-user-${Date.now()}`,
      content: userMessageContent,
      isFromUser: true,
      createdAt: new Date().toISOString()
    };

    setMessages(prevMessages => [...prevMessages, tempUserMessage]);
    setHeartLoading(true);
    setIsGeneratingResponse(true);

    try {
      console.log('💎 하트 차감 시작... 현재 하트:', hearts);
      
      // 하트 차감 (재시도 로직 포함)
      let heartResponse;
      let heartError = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`🔄 하트 차감 시도 ${attempt}/3`);
          heartResponse = await heartsAPI.spend(1, '채팅 메시지 전송');
          console.log('✅ 하트 차감 성공:', heartResponse.data);
          break;
        } catch (error) {
          console.error(`❌ 하트 차감 시도 ${attempt} 실패:`, error);
          heartError = error;
          
          if (attempt < 3) {
            console.log('⏳ 0.5초 후 재시도...');
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      
      if (!heartResponse) {
        throw new Error(`하트 차감 실패: ${heartError?.message || '알 수 없는 오류'}`);
      }
      
      // 하트 잔액 업데이트 (로컬 스토리지 동기화 포함)
      const newHeartBalance = heartResponse.data.hearts;
      updateHearts(newHeartBalance, heartResponse.data.transactionId);
      
      console.log('💎 하트 차감 완료:', {
        이전잔액: hearts,
        새잔액: newHeartBalance,
        차감량: hearts - newHeartBalance,
        트랜잭션ID: heartResponse.data.transactionId || 'N/A'
      });

      // 하트 잔액이 0이 되면 즉시 알림
      if (newHeartBalance === 0) {
        console.log('⚠️ 하트 잔액이 0이 되었습니다. 다음 메시지부터 차단됩니다.');
      } else if (newHeartBalance <= 5) {
        console.log('⚠️ 하트 잔액이 부족합니다:', newHeartBalance, '개 남음');
      }

      console.log('📨 메시지 전송 시작...');
      
      // 메시지 전송 (재시도 로직 포함)
      let messageResponse;
      let messageError = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`🔄 메시지 전송 시도 ${attempt}/3`);
          messageResponse = await chatsAPI.sendMessage(chatId, {
            content: userMessageContent
          });
          console.log('✅ 메시지 전송 성공:', messageResponse.data);
          break;
        } catch (error) {
          console.error(`❌ 메시지 전송 시도 ${attempt} 실패:`, error);
          messageError = error;
          
          if (attempt < 3) {
            console.log('⏳ 1초 후 재시도...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      if (!messageResponse) {
        // 메시지 전송 실패 시 하트 복구 시도
        console.log('🔄 메시지 전송 실패로 인한 하트 복구 시도...');
        try {
          const refundResponse = await heartsAPI.refund(1, '메시지 전송 실패로 인한 복구');
          if (refundResponse.data && refundResponse.data.hearts) {
            updateHearts(refundResponse.data.hearts, refundResponse.data.transactionId);
          } else {
            // 응답에 하트 정보가 없으면 기존 값에 1 추가
            updateHearts(hearts + 1);
          }
          console.log('✅ 하트 복구 완료');
        } catch (refundError) {
          console.error('❌ 하트 복구 실패:', refundError);
        }
        
        throw new Error(`메시지 전송 실패: ${messageError?.message || '서버 연결 오류'}`);
      }
      
      // 호감도 변화 처리
      if (messageResponse.data.favorability) {
        const favorabilityData = messageResponse.data.favorability;
        
        console.log('🔄 호감도 변화 데이터:', favorabilityData);
        
        // 호감도 정보 즉시 업데이트 (강제 리렌더링)
        if (favorabilityData.relation) {
          console.log('🔄 이전 관계 정보:', relationInfo);
          console.log('🔄 새로운 관계 정보:', favorabilityData.relation);
          
          // 새로운 객체로 상태 업데이트 (React 리렌더링 보장)
          setRelationInfo(prevInfo => ({
            ...favorabilityData.relation,
            // 타임스탬프 추가로 강제 업데이트
            _lastUpdated: Date.now()
          }));
          
          console.log('✅ 관계 정보 즉시 업데이트 완료');
        }
        

        
        // 메시지 전송 후 관계 정보와 하트 잔액 다시 불러오기 (최종 동기화 보장)
        setTimeout(() => {
          if (chatInfo?.character?.id) {
            fetchRelationInfo(chatInfo.character.id);
          }
          // 하트 잔액도 새로고침하여 서버와 동기화
          fetchHeartBalance(true);
        }, 500);
      } else {
        // 호감도 데이터가 없는 경우에도 관계 정보 새로고침
        console.log('⚠️ 호감도 데이터 없음, 관계 정보 새로고침');
        setTimeout(() => {
          if (chatInfo?.character?.id) {
            fetchRelationInfo(chatInfo.character.id);
          }
        }, 500);
      }
      
      // 임시 사용자 메시지 제거하고 실제 메시지들로 교체
      setMessages(prevMessages => {
        // 임시 메시지 제거
        const filteredMessages = prevMessages.filter(msg => msg.id !== tempUserMessage.id);
        
        // 응답이 배열인지 확인하고 새 메시지들 추가
        const messagesData = messageResponse.data.messages || messageResponse.data;
        if (Array.isArray(messagesData)) {
          // 사용자 메시지는 즉시 표시하고, AI 응답은 타이핑 애니메이션 적용
          const userMessage = messagesData.find(msg => msg.isFromUser);
          const aiMessage = messagesData.find(msg => !msg.isFromUser);
          
          if (userMessage) {
            // 사용자 메시지 즉시 추가
            const newMessages = [...filteredMessages, userMessage];
            
            // AI 응답이 있으면 타이핑 애니메이션 시작
            if (aiMessage) {
              setTypingMessage(aiMessage);
              setIsTyping(true);
            }
            
            return newMessages;
          } else {
            return [...filteredMessages, ...messagesData];
          }
        } else {
          console.error('Received non-array response for new messages:', messagesData);
          // 단일 메시지인 경우를 대비하여 배열로 감싸서 추가
          if (messagesData && typeof messagesData === 'object') {
            return [...filteredMessages, messagesData];
          }
          return filteredMessages;
        }
      });

    } catch (error) {
      console.error('❌ 메시지 전송 전체 실패:', error);
      
      // 타이핑 애니메이션 종료
      setIsTyping(false);
      setTypingMessage(null);
      
      // 에러 발생 시 임시 사용자 메시지 제거
      setMessages(prevMessages => prevMessages.filter(msg => msg.id !== tempUserMessage.id));
      
      // 구체적인 에러 메시지 표시
      let errorMessage = '메시지 전송에 실패했습니다.';
      
      if (error.message.includes('하트 차감')) {
        errorMessage = '하트 차감 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      } else if (error.message.includes('서버 연결')) {
        errorMessage = '서버 연결에 문제가 있습니다. 네트워크 상태를 확인해주세요.';
      } else if (error.message.includes('Insufficient hearts')) {
        errorMessage = '하트가 부족합니다.';
        if (isInApp()) {
          openHeartShop(hearts);
        } else {
          showInsufficientHearts(hearts, {
            onConfirm: () => navigate('/heart-shop'),
            onCancel: () => {}
          });
        }
        return; // 하트 부족의 경우 에러 팝업 표시하지 않음
      } else if (error.response?.status >= 500) {
        errorMessage = '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      } else if (error.response?.status === 401) {
        errorMessage = '로그인이 필요합니다. 다시 로그인해주세요.';
      }
      
      showError(errorMessage);
    } finally {
      setHeartLoading(false);
      setIsGeneratingResponse(false);
      
      // 모든 작업 완료 후 다시 한 번 포커스 설정
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 200);
    }
  };

  const handleBack = () => {
    handleButtonPress('back');
    setTimeout(() => navigate('/chats'), 150);
  };

  const handleAvatarClick = () => {
    if (chatInfo?.character) {
      setSelectedCharacter(chatInfo.character);
      setShowCharacterDetail(true);
    }
  };

  const handleCloseCharacterDetail = () => {
    setShowCharacterDetail(false);
    setSelectedCharacter(null);
  };

  // 타이핑 애니메이션 완료 처리
  const handleTypingComplete = () => {
    if (typingMessage) {
      setMessages(prevMessages => [...prevMessages, typingMessage]);
      setTypingMessage(null);
      setIsTyping(false);
    }
  };





  // 실제 데이터만 사용 - 더미 하트 수 제거됨

  if (loading) {
    return (
      <div className="max-w-md mx-auto bg-gradient-to-b from-white to-gray-50 h-screen">
        <div className="flex justify-center items-center h-full">
          <div className="text-center">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-gray-200 rounded-full"></div>
              <div className="w-16 h-16 border-4 border-transparent border-t-blue-500 rounded-full animate-spin absolute top-0 left-0"></div>
            </div>
            <p className="text-gray-600 text-base mt-6 font-medium">채팅을 불러오는 중...</p>
            <p className="text-gray-400 text-sm mt-2">잠시만 기다려주세요</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-gradient-to-b from-white to-gray-50 h-screen flex flex-col">
      <div 
        ref={containerRef}
        className="flex flex-col h-full overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
      {/* Header - 참고 이미지 스타일 */}
      <div className="flex-shrink-0 bg-white border-b border-gray-100">
        <div className="flex items-center px-4 py-4">
          {/* 뒤로가기 버튼 */}
          <button 
            onClick={handleBack}
            className="flex-shrink-0 p-2 -ml-2 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-all duration-200 active:scale-95"
          >
            <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
          </button>
          
          {/* 중앙 정렬된 캐릭터 정보 */}
          <div className="flex-1 flex flex-col items-center gap-1 min-w-0 mx-4">
            <div className="flex items-center gap-2" onClick={handleAvatarClick}>
              <div className="relative flex-shrink-0">
                <Avatar 
                  src={chatInfo?.character?.avatarUrl}
                  alt={chatInfo?.character?.name}
                  name={chatInfo?.character?.name}
                  size="sm"
                  fallbackType="emoji"
                  className="w-8 h-8 border-2 border-gray-100"
                />
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 border border-white rounded-full"></div>
              </div>
              <h1 className="text-base font-semibold text-gray-900 truncate max-w-[120px]">
                {chatInfo?.character?.name || '채팅'}
              </h1>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
              <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0"></div>
              <span className="truncate">실시간 대화</span>
            </div>
          </div>
          
          {/* 오른쪽 하트 카운터와 메뉴 */}
          <div className="flex-shrink-0 flex items-center gap-1">
            <div 
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all duration-200 border ${
                hearts < 1 
                  ? 'bg-red-50 text-red-600 border-red-200' 
                  : hearts < 10 
                    ? 'bg-red-50 text-red-600 border-red-200' 
                    : hearts < 50 
                      ? 'bg-amber-50 text-amber-600 border-amber-200'
                      : 'bg-pink-50 text-pink-600 border-pink-200'
              }`}
              onClick={() => hearts < 1 && handleButtonPress('heart-insufficient')}
            >
              <HeartIcon className={`w-4 h-4 ${hearts < 1 ? 'fill-current' : ''}`} />
              <span className="text-sm font-bold min-w-[20px] text-center">
                {hearts}
              </span>
              {hearts < 1 && (
                <span className="text-xs">충전필요</span>
              )}
            </div>

            
            {heartLoading && (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70"></div>
            )}
          </div>
        </div>
      </div>

      {/* Relationship Status Bar - 참고 이미지 스타일 */}
      {relationInfo && (
        <div className="flex-shrink-0 bg-gradient-to-r from-purple-100 via-pink-100 to-blue-100 border-b border-gray-100">
          <button
            onClick={() => setIsRelationshipModalOpen(true)}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-white/30 active:bg-white/50 transition-all duration-200 group"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex-shrink-0 text-lg group-hover:scale-110 transition-transform duration-200">
                {relationInfo.stage === 0 && '👋'}
                {relationInfo.stage === 1 && '😊'}
                {relationInfo.stage === 2 && '😄'}
                {relationInfo.stage === 3 && '💕'}
                {relationInfo.stage === 4 && '💖'}
                {relationInfo.stage === 5 && '💍'}
                {relationInfo.stage === 6 && '👑'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-purple-900">
                  {relationInfo.stage === 0 && '아는 사이'}
                  {relationInfo.stage === 1 && '친구'}
                  {relationInfo.stage === 2 && '썸 전야'}
                  {relationInfo.stage === 3 && '연인'}
                  {relationInfo.stage === 4 && '진지한 관계'}
                  {relationInfo.stage === 5 && '약혼'}
                  {relationInfo.stage === 6 && '결혼'}
                </div>
              </div>
            </div>
            
            <div className="flex-shrink-0 flex items-center gap-2">
              <div className="text-right">
                <div className="text-xs font-bold text-purple-700">
                  {relationInfo.score}% 
                </div>
                <div className="w-12 h-1 bg-white/50 rounded-full overflow-hidden mt-0.5">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (relationInfo.score / 1000) * 100)}%` }}
                  ></div>
                </div>
              </div>
              <div className="text-purple-600 opacity-60 group-hover:opacity-100 transition-opacity text-sm">
                ✨
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Messages - 참고 이미지 스타일 */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 bg-white min-h-0 chat-messages-scroll"
        style={{ 
          WebkitOverflowScrolling: 'touch',
          transform: 'translateZ(0)', // 하드웨어 가속 활성화
          willChange: 'scroll-position' // 스크롤 최적화
        }}
      >
        <div className="space-y-4"
          style={{
            contain: 'layout', // 레이아웃 최적화
            overflowAnchor: 'auto' // 스크롤 앵커링
          }}
        >
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.isFromUser ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[270px] group">
                {/* 캐릭터 메시지 (왼쪽) - 캐릭터 아바타 */}
                {!message.isFromUser && (
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <Avatar 
                      src={chatInfo?.character?.avatarUrl}
                      alt={chatInfo?.character?.name}
                      name={chatInfo?.character?.name}
                      size="xs"
                      fallbackType="emoji"
                      className="w-6 h-6"
                    />
                    <span className="text-xs font-medium text-gray-700">
                      {chatInfo?.character?.name}
                    </span>
                  </div>
                )}
                
                {/* 사용자 메시지 (오른쪽) - 페르소나 아바타 */}
                {message.isFromUser && (
                  <div className="flex items-center gap-2 mb-1 px-1 justify-end">
                    <span className="text-xs font-medium text-gray-700">
                      {chatInfo?.persona?.name || '나'}
                    </span>
                    <Avatar 
                      src={chatInfo?.persona?.avatarUrl}
                      alt={chatInfo?.persona?.name || '나'}
                      name={chatInfo?.persona?.name || '나'}
                      size="xs"
                      fallbackType="icon"
                      className="w-6 h-6"
                    />
                  </div>
                )}
                
                <div className={`px-4 py-3 transition-all duration-200 ${
                  message.isFromUser
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-2xl rounded-br-md shadow-sm group-hover:shadow-md'
                    : 'bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md group-hover:bg-gray-50'
                }`}>
                  <p className="text-sm leading-relaxed break-words">
                    {message.content}
                  </p>
                </div>
                <div className={`flex ${message.isFromUser ? 'justify-end' : 'justify-start'} mt-1 px-1`}>
                  <p className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {new Date(message.createdAt).toLocaleTimeString('ko-KR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false
                    })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* 타이핑 애니메이션 표시 - 개선된 디자인 */}
        {isTyping && typingMessage && (
          <div key={`typing-${typingMessage.id}`} className="flex justify-start">
            <div className="max-w-[280px] group">
              {/* 캐릭터 아바타 */}
              <div className="flex items-center gap-2 mb-1 px-1">
                <Avatar 
                  src={chatInfo?.character?.avatarUrl}
                  alt={chatInfo?.character?.name}
                  name={chatInfo?.character?.name}
                  size="xs"
                  fallbackType="emoji"
                  className="w-6 h-6"
                />
                <span className="text-xs font-medium text-gray-700">
                  {chatInfo?.character?.name}
                </span>
              </div>
              
              <div className="px-4 py-3 rounded-2xl bg-white text-gray-900 border border-gray-200 shadow-sm group-hover:shadow-md transition-all duration-200">
                <p className="text-sm leading-relaxed break-words">
                  <TypingAnimation
                    text={typingMessage.content}
                    speed={30}
                    onComplete={handleTypingComplete}
                  />
                </p>
              </div>
              <div className="flex justify-start mt-1 px-1">
                <p className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {new Date(typingMessage.createdAt).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                  })}
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* 응답 생성 중일 때 로딩 인디케이터 표시 - 개선된 디자인 */}
        {isGeneratingResponse && !isTyping && (
          <div className="flex justify-start">
            <div className="max-w-[280px] group">
              {/* 캐릭터 아바타 */}
              <div className="flex items-center gap-2 mb-1 px-1">
                <Avatar 
                  src={chatInfo?.character?.avatarUrl}
                  alt={chatInfo?.character?.name}
                  name={chatInfo?.character?.name}
                  size="xs"
                  fallbackType="emoji"
                  className="w-6 h-6"
                />
                <span className="text-xs font-medium text-gray-700">
                  {chatInfo?.character?.name}
                </span>
              </div>
              
              <div className="px-4 py-3 rounded-2xl bg-white border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-xs text-gray-500">응답 생성 중...</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* 스크롤 자동 이동을 위한 빈 div */}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input - 참고 이미지 스타일 */}
      <div className="flex-shrink-0 bg-white border-t border-gray-100 safe-area-bottom">
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !heartLoading && hearts >= 1 && !isGeneratingResponse && !sendingMessage && handleSendWithPreventDuplication()}
              onClick={() => {
                if (hearts < 1) {
                  handleButtonPress('heart-insufficient');
                  console.log('💔 하트 부족으로 입력 불가:', { currentHearts: hearts });
                }
              }}
              placeholder={
                hearts < 1 
                  ? "💖 하트를 충전하고 대화해보세요!" 
                  : isGeneratingResponse 
                    ? "AI가 응답 중입니다..." 
                    : "메시지를 입력하세요 (하트 1개 소모)"
              }
              disabled={hearts < 1 || heartLoading || isGeneratingResponse || sendingMessage}
              className={`w-full px-4 py-3 border rounded-2xl text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-0 transition-all duration-200 ${
                hearts < 1 
                  ? 'border-red-200 bg-red-50 text-red-600 placeholder-red-400' 
                  : heartLoading || isGeneratingResponse || sendingMessage
                    ? 'border-gray-200 bg-gray-100' 
                    : 'border-gray-200 bg-gray-50 focus:border-purple-300 focus:bg-white'
              }`}
              style={{
                fontSize: '16px', // iOS 줌 방지
                WebkitAppearance: 'none'
              }}
            />
            
            {hearts < 1 && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <button
                  onClick={() => navigate('/heart-shop')}
                  className="text-xs text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-full font-medium transition-colors"
                >
                  💖 하트 충전
                </button>
              </div>
            )}
            
            {hearts >= 1 && hearts <= 5 && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
                  💖 {hearts}개 남음
                </span>
              </div>
            )}
          </div>
          
          <div className="flex-shrink-0">
            <button
              onClick={handleSendWithPreventDuplication}
              disabled={!newMessage.trim() || hearts < 1 || heartLoading || isGeneratingResponse || sendingMessage}
              className={`p-3 rounded-full transition-all duration-200 active:scale-95 ${
                !newMessage.trim() || hearts < 1 || heartLoading || isGeneratingResponse || sendingMessage
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-lg hover:shadow-xl'
              }`}
              onTouchStart={() => handleButtonPress('send')}
              title={hearts < 1 ? '하트가 부족합니다' : '메시지 전송 (1 하트 소모)'}
            >
              {heartLoading || isGeneratingResponse || sendingMessage ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <PaperAirplaneIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
      


      {/* Relationship Modal */}
      <RelationshipModal 
        isOpen={isRelationshipModalOpen}
        onClose={() => setIsRelationshipModalOpen(false)}
        relationInfo={relationInfo}
        characterInfo={chatInfo?.character}
      />

      {/* Character Detail Modal */}
      {showCharacterDetail && selectedCharacter && (
        <CharacterDetail
          characterId={selectedCharacter.id}
          onClose={handleCloseCharacterDetail}
          onEdit={() => {}} // 편집 기능은 비활성화
        />
      )}


      </div>
    </div>
  );
};

export default ChatPage; 