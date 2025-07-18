import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { HeartIcon } from '@heroicons/react/24/solid';
import { useAuth } from '../context/AuthContext';
import LoginModal from '../components/LoginModal';
import PersonaSelection from './PersonaCreation/PersonaSelection';
import { heartsAPI } from '../services/api';
import API_CONFIG from '../config/api';
import Avatar from '../components/Avatar';
import { usePopup } from '../context/PopupContext';
import CharacterIntroCard from '../components/CharacterIntroCard';
import RecommendationTimer from '../components/RecommendationTimer';
import CharacterDetail from './CharacterCreation/CharacterDetail';


const ForYouPage = () => {
  const { isLoggedIn } = useAuth();
  const { showInsufficientHearts, showError } = usePopup();
  const [characters, setCharacters] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPersonaSelection, setShowPersonaSelection] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  
  // For You 페이지 전용 상태
  const [excludeIds, setExcludeIds] = useState([]);
  const [hearts, setHearts] = useState(150);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [refreshInfo, setRefreshInfo] = useState(null);
  const [countdown, setCountdown] = useState({ minutes: 0, seconds: 0 });
  const [showCharacterDetail, setShowCharacterDetail] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(null);

  
  // 터치/스와이프 관련 상태
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchEndX, setTouchEndX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // 모바일 최적화를 위한 ref
  const containerRef = useRef(null);
  const timerRef = useRef(null);

  // 스와이프 감지 최소 거리
  const minSwipeDistance = 50;

  // 함수들을 useEffect보다 먼저 정의
  const fetchHeartBalance = useCallback(async () => {
    try {
      const response = await heartsAPI.getBalance();
      if (response.data && typeof response.data.hearts === 'number') {
        setHearts(response.data.hearts);
      }
    } catch (error) {
      console.error('❌ 하트 잔액 조회 실패:', error);
    }
  }, []);

  const fetchForYouCharacters = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🎯 For You 캐릭터 로딩 시도...', { excludeIds: excludeIds.length });
      
      // userId, userEmail을 항상 localStorage에서 읽어옴
      const userId = localStorage.getItem('userId');
      const userEmail = localStorage.getItem('userEmail');
      const headers = {
        'Content-Type': 'application/json'
      };
      if (userId) headers['x-user-id'] = userId;
      if (userEmail) headers['x-user-email'] = userEmail;
      
      console.log('🔍 For You 캐릭터 요청 헤더:', { userId, userEmail, headers });
      
      // userId가 없으면 로그인 모달 표시 후 요청 중단
      if (!userId) {
        console.log('❌ 사용자 ID가 없어 For You 요청 중단');
        setShowLoginModal(true);
        setLoading(false);
        return;
      }
      
      // exclude 파라미터 추가
      const queryParams = excludeIds.length > 0 ? `?exclude=${excludeIds.join(',')}` : '';
      
      const response = await fetch(`${API_CONFIG.apiURL}/characters/for-you${queryParams}`, {
        method: 'GET',
        headers
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.characters && Array.isArray(data.characters)) {
          setCharacters(data.characters);
          setRefreshInfo(data.refreshInfo);
          if (data.characters.length > 0) {
            setCurrentIndex(0);
          }
          console.log('✅ For You 캐릭터 로딩 성공:', data.characters.length, '개');
          console.log('⏰ 다음 새로고침:', data.refreshInfo.nextRefreshAt);
        } else {
          console.error('Received invalid response:', data);
          setCharacters([]);
          setError('캐릭터 데이터를 불러올 수 없습니다.');
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('❌ For You 캐릭터 로딩 실패:', error);
      setCharacters([]);
      setError('캐릭터를 불러오는 중 오류가 발생했습니다. 페이지를 새로고침해주세요.');
    } finally {
      setLoading(false);
    }
  }, [excludeIds]);

  const updateCountdown = useCallback(() => {
    if (!refreshInfo) return;
    
    const now = new Date().getTime();
    const nextRefresh = new Date(refreshInfo.nextRefreshAt).getTime();
    const timeDiff = nextRefresh - now;
    
    if (timeDiff <= 0) {
      setCountdown({ minutes: 0, seconds: 0 });
      // 자동 새로고침
      setTimeout(() => {
        setExcludeIds([]);
        fetchForYouCharacters();
      }, 1000);
    } else {
      const minutes = Math.floor(timeDiff / (1000 * 60));
      const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
      setCountdown({ minutes, seconds });
    }
  }, [refreshInfo, fetchForYouCharacters]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchForYouCharacters();
      fetchHeartBalance();
    }
  }, [isLoggedIn, fetchForYouCharacters, fetchHeartBalance]);

  // 카운트다운 타이머 효과
  useEffect(() => {
    if (refreshInfo) {
      updateCountdown();
      timerRef.current = setInterval(updateCountdown, 1000);
      
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }
  }, [refreshInfo, updateCountdown]);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // 터치 이벤트 핸들러 - 버튼과 인터랙티브 요소 제외
  const handleTouchStart = (e) => {
    // 버튼이나 인터랙티브 요소는 터치 스와이프에서 제외
    const target = e.target;
    const isInteractive = target.closest('button') || 
                         target.closest('[data-interactive]') || 
                         target.closest('a') ||
                         target.closest('input') ||
                         target.closest('.card-modern');
    
    if (isInteractive) {
      setIsDragging(false);
      return;
    }
    
    setTouchStartX(e.touches[0].clientX);
    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    
    // 인터랙티브 요소 위에서는 스와이프 비활성화
    const target = e.target;
    const isInteractive = target.closest('button') || 
                         target.closest('[data-interactive]') || 
                         target.closest('.card-modern');
    
    if (isInteractive) {
      setIsDragging(false);
      return;
    }
    
    setTouchEndX(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    
    const distance = touchStartX - touchEndX;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    // 좌우 스와이프 처리 (무한 루프 제거)
    if (isLeftSwipe && currentIndex < characters.length - 1) {
      handleNext();
    }
    if (isRightSwipe && currentIndex > 0) {
      handlePrevious();
    }
  };

  const handleStartChat = () => {
    console.log('🚀 ForYouPage - handleStartChat 호출됨', { isLoggedIn });
    
    if (!isLoggedIn) {
      console.log('❌ 로그인되지 않음 - 로그인 모달 표시');
      setShowLoginModal(true);
      return;
    }
    
    console.log('✅ 페르소나 선택 모달 열기');
    setShowPersonaSelection(true);
  };

  const handleClosePersonaSelection = () => {
    setShowPersonaSelection(false);
  };

  const handleAvatarClick = () => {
    setSelectedCharacter(currentCharacter);
    setShowCharacterDetail(true);
  };

  const handleCloseCharacterDetail = () => {
    setShowCharacterDetail(false);
    setSelectedCharacter(null);
  };

  const handlePrevious = () => {
    if (isTransitioning || currentIndex <= 0) return;
    setIsTransitioning(true);
    setCurrentIndex((prev) => prev - 1);
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const handleNext = () => {
    if (isTransitioning || currentIndex >= characters.length - 1) return;
    setIsTransitioning(true);
    setCurrentIndex((prev) => prev + 1);
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const handleAddCharacter = async () => {
    if (addingCharacter) return;
    
    if (hearts < 5) {
      showInsufficientHearts(hearts, {
        onConfirm: () => {
          // 하트샵으로 이동 로직 (필요한 경우)
        },
        onCancel: () => {}
      });
      return;
    }

    try {
      setAddingCharacter(true);
      console.log('💎 하트로 캐릭터 추가 요청...');

      const headers = {
        'Content-Type': 'application/json'
      };

      // userId와 userEmail을 localStorage에서 직접 읽어옴
      const userId = localStorage.getItem('userId');
      const userEmail = localStorage.getItem('userEmail');
      
      if (userId) {
        headers['x-user-id'] = userId;
      }
      if (userEmail) {
        headers['x-user-email'] = userEmail;
      }

      console.log('🔍 카드 추가 요청 헤더:', { userId, userEmail, headers });

      // userId가 없으면 에러 처리
      if (!userId) {
        throw new Error('사용자 ID가 없습니다. 다시 로그인해주세요.');
      }

      // ✅ 현재 캐릭터 ID들을 문자열로 확실히 변환
      const currentCharacterIds = characters.map(char => String(char.id));
      
      // ✅ excludeIds를 문자열 배열로 필터링 (정수 제거)
      const validExcludeIds = excludeIds
        .map(id => String(id))
        .filter(id => {
          // 정수로만 이루어진 문자열은 제외 (실제 cuid가 아님)
          if (/^\d+$/.test(id)) {
            console.log(`⚠️ 정수 형태 ID ${id}는 제외됩니다 (실제 캐릭터 ID는 cuid 형태)`);
            return false;
          }
          return true;
        });
      
      // ✅ 모든 제외 ID를 문자열로 통일
      const allExcludeIds = [...validExcludeIds, ...currentCharacterIds];

      console.log('🔍 제외 ID 처리:', {
        excludeIds: excludeIds,
        validExcludeIds: validExcludeIds,
        currentCharacterIds: currentCharacterIds,
        allExcludeIds: allExcludeIds
      });

      const response = await fetch(`${API_CONFIG.apiURL}/characters/for-you/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          excludeIds: allExcludeIds
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // 새로운 캐릭터를 맨 앞에 추가
        setCharacters(prev => [data.character, ...prev]);
        setHearts(data.remainingHearts);
        setCurrentIndex(0); // 새 캐릭터로 이동
        
        console.log('✅ 캐릭터 추가 성공:', data.character.name);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || '캐릭터 추가에 실패했습니다.');
      }
    } catch (error) {
      console.error('❌ 캐릭터 추가 실패:', error);
      showError(error.message || '캐릭터 추가 중 오류가 발생했습니다.');
    } finally {
      setAddingCharacter(false);
    }
  };



  if (loading) {
    return (
      <div className="max-w-md mx-auto bg-gradient-to-br from-violet-50 to-purple-50" style={{ minHeight: 'calc(100vh - 60px)' }}>
        <div className="flex justify-center items-center p-6" style={{ height: 'calc(100vh - 60px)' }}>
          <div className="text-center max-w-sm">
            <div className="relative mb-6">
              <div className="animate-pulse w-12 h-12 bg-gradient-to-r from-violet-400 to-purple-400 rounded-full mx-auto mb-2"></div>
              <div className="flex justify-center space-x-1">
                <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
            <p className="text-body-sm font-medium text-gray-700">추천 캐릭터를 불러오는 중...</p>
          </div>
        </div>
      </div>
    );
  }

  // 로그인하지 않은 경우 게스트 화면
  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto bg-gradient-to-br from-violet-500 via-purple-500 to-pink-500" style={{ minHeight: 'calc(100vh - 60px)' }}>
        <div className="relative w-full overflow-hidden" style={{ height: 'calc(100vh - 60px)' }}>
          {/* Header */}
          <div className="relative z-10 flex items-center justify-between p-6 pt-12">
            <div className="flex items-center space-x-2">
              <h1 className="text-white text-heading-lg font-semibold">FOR YOU</h1>
              <HeartIcon className="w-5 h-5 text-pink-200" />
            </div>
            <div className="glass-dark rounded-full px-3 py-1.5">
              <span className="text-white text-caption font-medium">게스트</span>
            </div>
          </div>

          {/* Content */}
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center text-white max-w-xs">
              <div className="text-6xl mb-6">💕</div>
              <h2 className="text-2xl font-semibold mb-3">AI 캐릭터와 채팅하세요</h2>
              <p className="text-lg mb-8 opacity-90 leading-relaxed">다양한 성격의 AI 캐릭터들이 기다리고 있어요</p>
              
              <button 
                onClick={() => setShowLoginModal(true)}
                className="glass text-white px-6 py-3 rounded-xl font-medium text-body-md hover:bg-white/20 active:bg-white/30 transition-all shadow-lg backdrop-blur-md"
              >
                로그인하고 시작하기
              </button>
            </div>
          </div>

          {/* Login Modal */}
          <LoginModal
            isOpen={showLoginModal}
            onClose={() => setShowLoginModal(false)}
            title="채팅을 시작하려면 로그인하세요"
            subtitle="AI 캐릭터와 대화하기 위해 로그인이 필요해요"
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto bg-gradient-to-br from-red-50 to-rose-50" style={{ minHeight: 'calc(100vh - 60px)' }}>
        <div className="flex justify-center items-center p-6" style={{ height: 'calc(100vh - 60px)' }}>
          <div className="text-center max-w-sm">
            <div className="text-5xl mb-4">😞</div>
            <h3 className="text-heading-md text-gray-900 mb-3">문제가 발생했어요</h3>
            <p className="text-body-sm text-gray-600 mb-6 leading-relaxed">{error}</p>
            <button 
              onClick={fetchForYouCharacters}
              className="btn-gradient px-6 py-2.5 rounded-lg text-body-sm font-medium"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="max-w-md mx-auto bg-gradient-to-br from-gray-50 to-slate-100" style={{ minHeight: 'calc(100vh - 60px)' }}>
        <div className="flex justify-center items-center p-6" style={{ height: 'calc(100vh - 60px)' }}>
          <div className="text-center max-w-sm">
            <div className="text-5xl mb-4">🎭</div>
            <h3 className="text-heading-md text-gray-900 mb-2">캐릭터가 없어요</h3>
            <p className="text-body-sm text-gray-600 mb-6 leading-relaxed">아직 추천할 캐릭터가 없습니다.</p>
            <button 
              onClick={fetchForYouCharacters}
              className="btn-gradient px-6 py-2.5 rounded-lg text-body-sm font-medium"
            >
              새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentCharacter = characters[currentIndex];

  return (
    <div className="max-w-md mx-auto bg-white" style={{ minHeight: 'calc(100vh - 60px)' }}>
      <div 
        ref={containerRef}
        className="relative w-full overflow-hidden"
        style={{ height: 'calc(100vh - 60px)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Background Image with Blur */}
        <div className="absolute inset-0">
          {currentCharacter.avatarUrl ? (
            <>
              <img 
                src={currentCharacter.avatarUrl} 
                alt={currentCharacter.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 backdrop-blur-md bg-black bg-opacity-40"></div>
            </>
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
              <div className="absolute inset-0 bg-black bg-opacity-30"></div>
            </div>
          )}
        </div>

        {/* Navigation Arrows */}
        {currentIndex > 0 && (
          <button 
            onClick={handlePrevious}
            disabled={isTransitioning}
            className="absolute left-4 top-1/2 transform -translate-y-1/2 z-30 w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-white backdrop-blur-sm hover:bg-opacity-30 active:bg-opacity-40 transition-all disabled:opacity-50"
          >
            <ChevronLeftIcon className="w-6 h-6" />
          </button>
        )}
        
        {currentIndex < characters.length - 1 && (
          <button 
            onClick={handleNext}
            disabled={isTransitioning}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 z-30 w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-white backdrop-blur-sm hover:bg-opacity-30 active:bg-opacity-40 transition-all disabled:opacity-50"
          >
            <ChevronRightIcon className="w-6 h-6" />
          </button>
        )}

                  {/* Main Content Flow */}
          <div className="relative z-10 h-full flex flex-col justify-between p-6 pt-12 pb-20">
          {/* Character Profile Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <Avatar 
                src={currentCharacter.avatarUrl}
                alt={currentCharacter.name}
                name={currentCharacter.name}
                size="lg"
                className="ring-3 ring-white/30 shadow-lg"
                onClick={handleAvatarClick}
              />
              <div className="min-w-0 flex-1">
                <h1 className="text-white text-lg font-semibold truncate drop-shadow-sm">{currentCharacter.name}</h1>
                <p className="text-white text-sm opacity-90 mt-1">
                  {currentCharacter.age && `${currentCharacter.age}세`}
                  {currentCharacter.age && currentCharacter.characterType && ' • '}
                  {currentCharacter.characterType}
                </p>
              </div>
            </div>
            

          </div>



          {/* Character Introduction Card */}
          <div className="flex-1 flex items-center justify-center px-4">
            <CharacterIntroCard 
              character={currentCharacter} 
              onStartChat={handleStartChat}
            />
          </div>

          {/* Recommendation Timer */}
          <div className="mt-6 mb-4 px-2">
            <RecommendationTimer
              countdown={countdown}
              onAddCharacter={handleAddCharacter}
              addingCharacter={addingCharacter}
              hearts={hearts}
            />
          </div>
        </div>

        {/* Persona Selection Modal */}
        <PersonaSelection
          isOpen={showPersonaSelection}
          onClose={handleClosePersonaSelection}
          characterId={currentCharacter?.id}
          characterName={currentCharacter?.name}
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

export default ForYouPage;