import React, { useState, useEffect } from 'react';

const TypingAnimation = ({ text, speed = 50, onComplete, className = '' }) => {
  const safeText = text || '';
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < safeText.length) {
      const timer = setTimeout(() => {
        setDisplayedText(prev => prev + safeText[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);

      return () => clearTimeout(timer);
    } else if (onComplete) {
      onComplete();
    }
  }, [currentIndex, safeText, speed, onComplete]);

  // 텍스트가 변경되면 초기화
  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
  }, [safeText]);

  return (
    <span className={className}>
      {displayedText}
      {currentIndex < safeText.length && (
        <span className="animate-pulse">|</span>
      )}
    </span>
  );
};

export default TypingAnimation; 