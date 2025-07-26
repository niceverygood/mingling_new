import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, HeartIcon, PaperAirplaneIcon, FaceSmileIcon } from '@heroicons/react/24/outline';
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

const EMOJI_OPTIONS = ['❤️', '👍', '😂', '😮', '😢'];

const ChatPage = () => {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { isLoggedIn, user: authUser } = useAuth();
  
  const { showInsufficientHearts, showError } = usePopup();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [chatInfo, setChatInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeReactionMenu, setActiveReactionMenu] = useState(null);

  const getInitialHearts = () => {
    try {
      const cached = localStorage.getItem('heartBalance');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 3600000) {
          return parsed.hearts;
        }
      }
    } catch (e) {
      console.warn('로컬 스토리지 로드 실패:', e);
    }
    return 150;
  };

  const [hearts, setHearts] = useState(getInitialHearts);

  const updateHearts = (newHearts, transactionId = null) => {
    setHearts(newHearts);
    
    try {
      localStorage.setItem('heartBalance', JSON.stringify({
        hearts: newHearts,
        timestamp: Date.now(),
        lastTransaction: transactionId
      }));
    } catch (e) {
      console.warn('로컬 스토리지 동기화 실패:', e);
    }
  };
  const [heartLoading, setHeartLoading] = useState(false);
  const [isGeneratingResponse, setIsGeneratingResponse] = useState(false);
  const [hasInitiallyScrolled, setHasInitiallyScrolled] = useState(false);
  
  const [typingMessage, setTypingMessage] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  
  const [relationInfo, setRelationInfo] = useState(null);
  
  const [touchStartY, setTouchStartY] = useState(0);
  const [touchEndY, setTouchEndY] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [buttonPressed, setButtonPressed] = useState(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  
  const containerRef = useRef(null);
  const messagesContainerRef = useRef(null);
  
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
    if (currentStage >= 6) return null;
    
    const nextThreshold = stageThresholds[currentStage];
    const pointsNeeded = nextThreshold.next - relationInfo.score;
    
    return {
      nextStageLabel: nextThreshold.label,
      pointsNeeded: Math.max(0, pointsNeeded),
      progressPercentage: ((relationInfo.score / 1000) * 100).toFixed(1)
    };
  }, [relationInfo]);
  
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const [isRelationshipModalOpen, setIsRelationshipModalOpen] = useState(false);
  
  const [showCharacterDetail, setShowCharacterDetail] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(null);

  const handleTouchStart = (e) => {
    setTouchStartY(e.touches[0].clientY);
    setIsScrolling(true);
  };

  const handleTouchEnd = (e) => {
    setTouchEndY(e.changedTouches[0].clientY);
    setIsScrolling(false);
  };

  const handleButtonPress = (buttonId) => {
    setButtonPressed(buttonId);
    setTimeout(() => setButtonPressed(null), 150);
  };

  const handleSendWithPreventDuplication = async () => {
    if (sendingMessage) return;
    setSendingMessage(true);
    
    try {
      await handleSendMessage();
    } finally {
      setTimeout(() => setSendingMessage(false), 500);
    }
  };

  useEffect(() => {
    if (!loading && !hasInitiallyScrolled) {
      setTimeout(() => {
        scrollToBottomInstant();
        setHasInitiallyScrolled(true);
      }, 50);
    }
  }, [loading, hasInitiallyScrolled]);

  useEffect(() => {
    if (isGeneratingResponse) {
      scrollToBottom();
    }
  }, [isGeneratingResponse]);

  useEffect(() => {
    if (isTyping) {
      scrollToBottom();
    }
  }, [isTyping]);

  useEffect(() => {
    if (hasInitiallyScrolled && messages.length > 0) {
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [messages.length, hasInitiallyScrolled]);

  const scrollToBottomInstant = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  };

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (chatId) {
      setHasInitiallyScrolled(false);
      fetchChatInfo();
      fetchMessages();
      fetchHeartBalance();
    }
  }, [chatId]);

  useEffect(() => {
    if (isInApp()) {
      const removeListener = listenForHeartUpdates((newHearts) => {
        updateHearts(newHearts, 'native-update');
      });
      
      return removeListener;
    }
  }, []);

  const fetchRelationInfo = async (characterId) => {
    if (!characterId) return;

    try {
      const relationData = await getRelationInfo(characterId);
      if (relationData && relationData.data) {
        const safeRelationData = {
          score: typeof relationData.data.score === 'number' ? relationData.data.score : 0,
          stage: typeof relationData.data.stage === 'number' ? relationData.data.stage : 0,
          stageChanged: Boolean(relationData.data.stageChanged),
          ...relationData.data
        };
        setRelationInfo(safeRelationData);
      } else {
        setRelationInfo({ score: 0, stage: 0, stageChanged: false });
      }
    } catch (error) {
      console.error('❌ 관계 정보 불러오기 실패:', error);
      setRelationInfo({ score: 0, stage: 0, stageChanged: false });
    }
  };

  useEffect(() => {
    if (chatInfo?.character?.id) {
      fetchRelationInfo(chatInfo.character.id);
    }
  }, [chatInfo, messages.length]);

  const fetchHeartBalance = async (force = false) => {
    try {
      const response = await heartsAPI.getBalance();
      if (response.data && response.data.success && typeof response.data.data.hearts === 'number') {
        const newHearts = response.data.data.hearts;
        updateHearts(newHearts);
        return newHearts;
      } else {
        return hearts;
      }
    } catch (error) {
      console.error('❌ 하트 잔액 조회 실패:', error);
      return hearts;
    }
  };

  const fetchChatInfo = async () => {
    if (!chatId) return;
    try {
      const response = await chatsAPI.getAll();
      if (Array.isArray(response.data)) {
        const chat = response.data.find(c => c.id === chatId);
        setChatInfo(chat || null);
      } else {
        setChatInfo(null);
      }
    } catch (error) {
      console.error('❌ 채팅 정보 로딩 실패:', error);
      setChatInfo(null);
    }
  };

  const fetchMessages = async () => {
    if (!chatId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      const response = await chatsAPI.getMessages(chatId);
      if (Array.isArray(response.data)) {
        setMessages(response.data);
      } else {
        setMessages([]);
      }
    } catch (error) {
      console.error('❌ 메시지 로딩 실패:', error);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleReaction = async (messageId, emoji) => {
    if (!authUser) return;

    // 1. 현재 상태를 기준으로 어떤 작업을 할지 먼저 결정합니다.
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const existingReaction = message.reactions?.find(
      r => r.emoji === emoji && r.userId === authUser.uid
    );
    const isAdding = !existingReaction;

    console.log(`--- Handling Reaction for message ${messageId} with emoji ${emoji} ---`);
    console.log('Action determined:', isAdding ? 'ADD' : 'REMOVE');

    // 2. UI를 먼저 낙관적으로 업데이트합니다.
    setMessages(currentMessages =>
      currentMessages.map(m => {
        if (m.id === messageId) {
          const newReactions = isAdding
            ? [...(m.reactions || []), { emoji, userId: authUser.uid }]
            : m.reactions.filter(r => !(r.emoji === emoji && r.userId === authUser.uid));
          return { ...m, reactions: newReactions };
        }
        return m;
      })
    );
    setActiveReactionMenu(null);

    // 3. 위에서 결정한 작업에 따라 올바른 API를 호출합니다.
    try {
      if (isAdding) {
        console.log('--- Calling addReaction API ---');
        await chatsAPI.addReaction(messageId, emoji);
      } else {
        console.log('--- Calling removeReaction API ---');
        await chatsAPI.removeReaction(messageId, emoji);
      }
      console.log('--- API Call Successful ---');
    } catch (error) {
      console.error("Reaction update failed:", error);
      // 에러 발생 시, 서버의 실제 데이터로 롤백합니다.
      fetchMessages();
      showError('반응을 업데이트하지 못했습니다.');
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;
    
    if (hearts < 1) {
      if (isInApp()) {
        openHeartShop(hearts);
      } else {
        showInsufficientHearts(hearts, {
          onConfirm: () => navigate('/heart-shop'),
          onCancel: () => {}
        });
      }
      return;
    }

    const userMessageContent = newMessage.trim();
    setNewMessage('');
    
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);

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
      const heartResponse = await heartsAPI.spend(1, '채팅 메시지 전송');
      const newHeartBalance = heartResponse.data.hearts;
      updateHearts(newHeartBalance, heartResponse.data.transactionId);
      
      const messageResponse = await chatsAPI.sendMessage(chatId, {
        content: userMessageContent
      });
      
      if (messageResponse.data.favorability) {
        const favorabilityData = messageResponse.data.favorability;
        if (favorabilityData.relation) {
          setRelationInfo(prevInfo => ({
            ...favorabilityData.relation,
            _lastUpdated: Date.now()
          }));
        }
        setTimeout(() => {
          if (chatInfo?.character?.id) {
            fetchRelationInfo(chatInfo.character.id);
          }
          fetchHeartBalance(true);
        }, 500);
      } else {
        setTimeout(() => {
          if (chatInfo?.character?.id) {
            fetchRelationInfo(chatInfo.character.id);
          }
        }, 500);
      }
      
      setMessages(prevMessages => {
        const filteredMessages = prevMessages.filter(msg => msg.id !== tempUserMessage.id);
        const messagesData = messageResponse.data.messages || messageResponse.data;
        if (Array.isArray(messagesData)) {
          const userMessage = messagesData.find(msg => msg.isFromUser);
          const aiMessage = messagesData.find(msg => !msg.isFromUser);
          
          if (userMessage) {
            const newMessages = [...filteredMessages, userMessage];
            if (aiMessage) {
              setTypingMessage(aiMessage);
              setIsTyping(true);
            }
            return newMessages;
          } else {
            return [...filteredMessages, ...messagesData];
          }
        } else {
          if (messagesData && typeof messagesData === 'object') {
            return [...filteredMessages, messagesData];
          }
          return filteredMessages;
        }
      });

    } catch (error) {
      console.error('❌ 메시지 전송 전체 실패:', error);
      setIsTyping(false);
      setTypingMessage(null);
      setMessages(prevMessages => prevMessages.filter(msg => msg.id !== tempUserMessage.id));
      
      let errorMessage = '메시지 전송에 실패했습니다.';
      if (error.message.includes('하트 차감')) {
        errorMessage = '하트 차감 중 오류가 발생했습니다.';
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
        return;
      }
      showError(errorMessage);
    } finally {
      setHeartLoading(false);
      setIsGeneratingResponse(false);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 200);
    }
  };

  const handleBack = () => {
    navigate('/chats');
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

  const handleTypingComplete = () => {
    if (typingMessage) {
      setMessages(prevMessages => [...prevMessages, typingMessage]);
      setTypingMessage(null);
      setIsTyping(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-full">Loading...</div>;
  }

  return (
    <div className="max-w-md mx-auto bg-white h-screen flex flex-col">
      <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
        <div className="flex-shrink-0 bg-white border-b border-gray-200">
          <div className="flex items-center px-4 py-3">
            <button onClick={handleBack} className="p-2 rounded-full hover:bg-gray-100">
              <ArrowLeftIcon className="w-6 h-6 text-gray-500" />
            </button>
            <div className="flex-1 flex items-center justify-center" onClick={handleAvatarClick}>
              <Avatar src={chatInfo?.character?.avatarUrl} alt={chatInfo?.character?.name} size="sm" />
              <h1 className="text-lg font-semibold ml-3">{chatInfo?.character?.name || 'Chat'}</h1>
            </div>
            <div className="flex items-center">
              <HeartIcon className="w-6 h-6 text-red-500" />
              <span className="ml-1 font-bold">{hearts}</span>
            </div>
          </div>
        </div>

        {relationInfo && (
          <div className="flex-shrink-0 bg-gray-50 border-b">
            <button onClick={() => setIsRelationshipModalOpen(true)} className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-100">
              {/* ... relationship bar ... */}
            </button>
          </div>
        )}

        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex items-end gap-2 ${message.isFromUser ? 'justify-end' : 'justify-start'}`}>
              {!message.isFromUser && <Avatar src={chatInfo?.character?.avatarUrl} size="xs" />}
              <div className="relative group max-w-xs min-w-0">
                <div className={`px-4 py-2 rounded-lg ${message.isFromUser ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                  {message.content}
                </div>
                
                <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setActiveReactionMenu(activeReactionMenu === message.id ? null : message.id)} className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 shadow">
                    <FaceSmileIcon className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                {activeReactionMenu === message.id && (
                  <div className="absolute top-7 right-0 z-10 flex gap-1 bg-white p-1 rounded-full shadow-md">
                    {EMOJI_OPTIONS.map(emoji => (
                      <button key={emoji} onClick={() => handleReaction(message.id, emoji)} className="p-1 rounded-full hover:bg-gray-200">
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {message.reactions && message.reactions.length > 0 && (
                  <div className={`absolute -bottom-4 left-2 flex gap-1 mt-1`}>
                    {message.reactions.map((reaction, index) => (
                      <div
                        key={index}
                        className={`px-2 py-0.5 rounded-full text-xs cursor-pointer border shadow-sm ${
                          reaction.userId === authUser?.uid
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'bg-gray-100 border-gray-200 text-gray-600'
                        }`}
                        onClick={() => handleReaction(message.id, reaction.emoji)}
                      >
                        {reaction.emoji}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {message.isFromUser && <Avatar src={authUser?.photoURL} size="xs" />}
            </div>
          ))}
          {isTyping && <TypingAnimation />}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="메시지를 입력하세요..."
              className="w-full px-4 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={heartLoading || isGeneratingResponse}
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || heartLoading || isGeneratingResponse}
              className="p-3 rounded-full bg-blue-500 text-white disabled:bg-gray-300"
            >
              <PaperAirplaneIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>

      <RelationshipModal 
        isOpen={isRelationshipModalOpen}
        onClose={() => setIsRelationshipModalOpen(false)}
        relationInfo={relationInfo}
        characterInfo={chatInfo?.character}
      />

      {showCharacterDetail && selectedCharacter && (
        <CharacterDetail
          characterId={selectedCharacter.id}
          onClose={handleCloseCharacterDetail}
        />
      )}
    </div>
  );
};

export default ChatPage;
