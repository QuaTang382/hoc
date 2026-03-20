
import React, { useState, useEffect, useRef } from 'react';
import { QuizSet, Question } from '../types';

interface QuizPlayerProps {
  quiz: QuizSet;
  onClose: () => void;
  onComplete?: (score: number) => void;
}

// Hàm xáo trộn mảng (Fisher-Yates Shuffle)
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

// FIX: Thuật toán xáo trộn đáp án an toàn
const shuffleQuestionOptions = (question: Question): Question => {
  const optionsWithStatus = question.options.map((opt, index) => ({
    text: opt,
    isCorrect: index === question.correctAnswer
  }));

  const shuffledOptionsWithStatus = shuffleArray(optionsWithStatus);
  const newOptions = shuffledOptionsWithStatus.map(o => o.text);
  const newCorrectIndex = shuffledOptionsWithStatus.findIndex(o => o.isCorrect);

  return {
    ...question,
    options: newOptions,
    correctAnswer: newCorrectIndex,
  };
};

const QuizPlayer: React.FC<QuizPlayerProps> = ({ quiz, onClose, onComplete }) => {
  const [playableQuestions, setPlayableQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [finished, setFinished] = useState(false);
  const [streak, setStreak] = useState(0);
  const [hasClaimed, setHasClaimed] = useState(false); // New state: Đã khiếu nại chưa
  const [timeElapsed, setTimeElapsed] = useState(0);
  
  const correctSfx = useRef(new Audio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg'));
  const wrongSfx = useRef(new Audio('https://actions.google.com/sounds/v1/cartoon/slip_and_slide.ogg'));
  const winSfx = useRef(new Audio('https://actions.google.com/sounds/v1/foley/wind_chime_fast.ogg'));
  const claimSfx = useRef(new Audio('https://actions.google.com/sounds/v1/cartoon/pop.ogg'));

  const playVoice = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'vi-VN';
      utterance.rate = 1.2;
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    const shuffledQs = shuffleArray(quiz.questions);
    const fullyShuffled = shuffledQs.map(shuffleQuestionOptions);
    setPlayableQuestions(fullyShuffled);
  }, [quiz]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (!finished && playableQuestions.length > 0) {
      timer = setInterval(() => {
        setTimeElapsed(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [finished, playableQuestions.length]);

  if (playableQuestions.length === 0) return null;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentQuestion = playableQuestions[currentIdx];

  const handleOptionSelect = (idx: number) => {
    if (isAnswered) return;
    setSelectedOption(idx);
    setIsAnswered(true);
    setHasClaimed(false);
    
    if (idx === currentQuestion.correctAnswer) {
      setScore(prev => prev + 1);
      setStreak(prev => prev + 1);
      correctSfx.current.currentTime = 0;
      correctSfx.current.play().catch(() => {});
      playVoice("Chính xác");
    } else {
      setStreak(0);
      wrongSfx.current.currentTime = 0;
      wrongSfx.current.play().catch(() => {});
      playVoice("Sai rồi");
    }
  };

  // Tính năng: Khiếu nại (Tôi đúng)
  const handleClaimCorrect = () => {
    if (!isAnswered || hasClaimed) return;
    setScore(prev => prev + 1);
    setStreak(prev => prev + 1); // Khôi phục streak (tạm tính là 1 nếu trước đó về 0)
    setHasClaimed(true);
    claimSfx.current.play().catch(() => {});
  };

  const nextQuestion = () => {
    if (currentIdx + 1 < playableQuestions.length) {
      setCurrentIdx(prev => prev + 1);
      setSelectedOption(null);
      setIsAnswered(false);
      setHasClaimed(false);
    } else {
      setFinished(true);
      winSfx.current.play().catch(() => {});
      if (onComplete) {
        onComplete(score);
      }
    }
  };

  if (finished) {
    return (
      <div className="fixed inset-0 bg-[#0f172a] z-50 flex flex-col items-center justify-center p-6 text-center animate__animated animate__fadeIn">
        <div className="mb-10 relative">
          <div className="w-48 h-48 bg-yellow-400/20 rounded-full flex items-center justify-center mx-auto mb-4 animate__animated animate__bounceIn">
             <span className="text-8xl floating">🏆</span>
          </div>
          <div className="absolute -top-4 -right-4 bg-indigo-600 text-white px-4 py-2 rounded-full font-bold shadow-xl animate__animated animate__jackInTheBox">
            KẾT QUẢ
          </div>
        </div>
        
        <h2 className="text-5xl font-black text-white mb-2">Hoàn thành!</h2>
        <p className="text-2xl text-indigo-300 mb-2">Bạn đã trả lời đúng {score}/{playableQuestions.length} câu</p>
        <p className="text-lg text-slate-400 mb-8">Thời gian: {formatTime(timeElapsed)}</p>
        
        <div className="flex gap-4">
          <button 
            onClick={onClose}
            className="px-10 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl font-bold hover:scale-105 transition-all shadow-2xl shadow-indigo-500/40"
          >
            Về bảng tin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0f172a] z-50 flex flex-col p-4 md:p-8 animate__animated animate__slideInUp overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full flex flex-col min-h-full">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 bg-white/5 p-4 rounded-2xl backdrop-blur-md sticky top-0 z-10">
          <div className="flex flex-col">
            <span className="text-indigo-400 text-xs font-bold uppercase tracking-widest">Đang trả lời</span>
            <div className="text-white font-black text-xl">
              Câu {currentIdx + 1} <span className="text-slate-500 font-normal">/ {playableQuestions.length}</span>
            </div>
          </div>
          
          <div className="flex-1 mx-4 md:mx-8 h-3 bg-slate-800 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000 ease-out" 
              style={{ width: `${((currentIdx + 1) / playableQuestions.length) * 100}%` }}
            />
          </div>

          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full font-mono text-sm text-indigo-200">
               ⏱ {formatTime(timeElapsed)}
             </div>
             {streak > 1 && (
               <div className="hidden md:flex items-center gap-1 bg-orange-500 text-white px-3 py-1 rounded-full font-bold animate__animated animate__pulse animate__infinite">
                 🔥 {streak}x
               </div>
             )}
             <button onClick={onClose} className="text-white/40 hover:text-white text-3xl transition-colors">×</button>
          </div>
        </div>

        {/* Question Area */}
        <div className="flex-1 flex flex-col justify-center items-center text-center space-y-6 md:space-y-10 py-2">
          <div className={`transition-all duration-500 ${isAnswered ? 'scale-95 opacity-80' : 'scale-100'}`}>
             <h1 className="text-2xl md:text-4xl font-black text-white px-2 leading-tight drop-shadow-2xl">
              {currentQuestion.question}
            </h1>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            {currentQuestion.options.map((option, idx) => {
              let btnClass = "relative p-5 md:p-8 text-lg font-bold rounded-3xl transition-all text-left flex items-center border-4 group ";
              
              if (!isAnswered) {
                btnClass += "bg-white/5 hover:bg-white/10 text-white border-white/10 hover:border-indigo-500/50 hover:-translate-y-1 active:scale-95";
              } else {
                if (idx === currentQuestion.correctAnswer) {
                  // Đáp án đúng (theo máy)
                  btnClass += "bg-emerald-500 border-emerald-400 text-white scale-105 shadow-[0_0_40px_rgba(16,185,129,0.4)]";
                } else if (idx === selectedOption) {
                  // Đáp án bạn chọn
                  if (hasClaimed) {
                     // Nếu đã khiếu nại -> Biến thành màu xanh dương (được chấp nhận)
                     btnClass += "bg-blue-500 border-blue-400 text-white animate__animated animate__tada";
                  } else {
                     // Nếu chưa khiếu nại -> Màu đỏ (Sai)
                     btnClass += "bg-rose-500 border-rose-400 text-white animate__animated animate__shakeX";
                  }
                } else {
                  btnClass += "bg-white/5 border-transparent text-white/30 scale-95 opacity-40";
                }
              }

              return (
                <button 
                  key={idx} 
                  onClick={() => handleOptionSelect(idx)}
                  disabled={isAnswered}
                  className={btnClass}
                >
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center mr-4 text-sm transition-colors ${!isAnswered ? 'bg-white/10 group-hover:bg-indigo-500' : 'bg-black/20'}`}>
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="flex-1 text-sm md:text-lg">{option}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feedback Area */}
        <div className="min-h-32 flex flex-col justify-center items-center mt-6 pb-20 md:pb-0">
          {isAnswered && (
            <div className="w-full flex flex-col items-center animate__animated animate__fadeInUp">
              
              {/* Nút Khiếu nại - Chỉ hiện khi chọn sai và chưa khiếu nại */}
              {selectedOption !== currentQuestion.correctAnswer && !hasClaimed && (
                <button 
                  onClick={handleClaimCorrect}
                  className="mb-4 px-4 py-2 bg-blue-600/30 border border-blue-500 text-blue-200 text-xs font-bold rounded-full hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-2"
                >
                  🤔 <span>Đáp án máy sai? Bấm để <b>Cộng điểm</b></span>
                </button>
              )}

              {hasClaimed && (
                 <div className="mb-4 text-blue-400 text-sm font-bold animate__animated animate__fadeIn">
                   ✅ Đã ghi nhận bạn đúng! (+1 Điểm)
                 </div>
              )}

              <div className="bg-white/5 backdrop-blur-xl p-4 rounded-2xl border border-white/10 mb-6 max-w-2xl w-full">
                <p className="text-indigo-200 text-center text-sm md:text-base">
                   <span className="font-bold text-white block mb-1 uppercase tracking-tighter">💡 Giải thích:</span>
                   {currentQuestion.explanation}
                </p>
              </div>
              <button 
                onClick={nextQuestion}
                className="w-full md:w-auto px-10 py-4 bg-white text-indigo-900 rounded-2xl font-black text-lg hover:bg-indigo-50 transition-all shadow-[0_20px_50px_rgba(255,255,255,0.2)] active:scale-95"
              >
                CÂU TIẾP THEO ➔
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizPlayer;
