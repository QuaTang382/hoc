
import React, { useState, useEffect, useRef } from 'react';
import { QuizSet, Question } from './types';
import { extractTextFromFile } from './services/fileService';
import { generateQuizFromText } from './services/geminiService';
import QuizPlayer from './components/QuizPlayer';
import * as fflate from 'fflate';
import { db, auth, googleProvider } from './firebase';
import { doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit, updateDoc, increment, arrayUnion, arrayRemove, addDoc, onSnapshot } from 'firebase/firestore';
import { signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';

declare const QRious: any;

const CHILL_MUSIC_LIST = [
  'https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3',
  'https://cdn.pixabay.com/audio/2022/03/15/audio_12b2e8e078.mp3',
  'https://cdn.pixabay.com/audio/2022/10/25/audio_9242502c38.mp3',
  'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3',
  'https://cdn.pixabay.com/audio/2022/11/22/audio_8bea3dc50f.mp3'
];

const COLORS = [
  'bg-gradient-to-br from-pink-500/20 to-rose-500/20 border-pink-500/30 text-pink-100',
  'bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border-blue-500/30 text-blue-100',
  'bg-gradient-to-br from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-100',
  'bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border-emerald-500/30 text-emerald-100',
  'bg-gradient-to-br from-purple-500/20 to-violet-500/20 border-purple-500/30 text-purple-100',
];

/**
 * COMPRESSION UTILS
 */
const compressToCode = (quiz: QuizSet): string => {
  try {
    const minified = [
      2, 
      quiz.title,
      quiz.questions.map(q => [q.question, q.options, q.correctAnswer, q.explanation])
    ];

    const str = JSON.stringify(minified);
    const buf = new TextEncoder().encode(str);
    const compressed = fflate.zlibSync(buf, { level: 9 });
    
    let binary = "";
    for (let i = 0; i < compressed.length; i++) {
      binary += String.fromCharCode(compressed[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch (e) {
    console.error("Compression error:", e);
    throw new Error("Lỗi nén dữ liệu.");
  }
};

const decompressFromCode = (code: string): QuizSet | null => {
  try {
    let base64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    
    const binary = atob(base64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      buf[i] = binary.charCodeAt(i);
    }

    const decompressed = fflate.unzlibSync(buf);
    const str = new TextDecoder().decode(decompressed);
    const data = JSON.parse(str);

    if (Array.isArray(data) && data[0] === 2) {
       return {
         id: `import-${Date.now()}`,
         title: data[1],
         description: "Được chia sẻ qua mã Code",
         questions: data[2].map((q: any, idx: number) => ({
           id: `q-${Date.now()}-${idx}`,
           question: q[0],
           options: q[1],
           correctAnswer: q[2],
           explanation: q[3] || "Không có giải thích chi tiết."
         })),
         createdAt: Date.now(),
         color: COLORS[Math.floor(Math.random() * COLORS.length)]
       };
    }
    // Fallback v1
    if (Array.isArray(data) && data[0] === 1) {
       return {
         id: `import-${Date.now()}`,
         title: data[1],
         description: data[2],
         questions: data[3].map((q: any, idx: number) => ({
           id: `q-${Date.now()}-${idx}`,
           question: q[0],
           options: q[1],
           correctAnswer: q[2],
           explanation: q[3]
         })),
         createdAt: Date.now(),
         color: COLORS[Math.floor(Math.random() * COLORS.length)]
       };
    }

    return null;
  } catch (e) {
    console.error("Decompression error:", e);
    return null;
  }
};

const App: React.FC = () => {
  const [quizzes, setQuizzes] = useState<QuizSet[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'LIBRARY' | 'COMMUNITY' | 'LEADERBOARD'>('LIBRARY');
  const [publicQuizzes, setPublicQuizzes] = useState<any[]>([]);
  const [leaderboardUsers, setLeaderboardUsers] = useState<any[]>([]);
  const [isLoadingCommunity, setIsLoadingCommunity] = useState(false);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [commentsModalQuizId, setCommentsModalQuizId] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');

  // Music State
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const bgMusic = useRef<HTMLAudioElement | null>(null);
  const [view, setView] = useState<'HOME' | 'IMPORT' | 'SHARE'>('HOME');
  const [shareData, setShareData] = useState<{code: string, url: string | null, shortCode?: string} | null>(null);
  const [importCode, setImportCode] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Multi-QR State
  const [qrChunks, setQrChunks] = useState<string[]>([]);
  const [currentQrIndex, setCurrentQrIndex] = useState(0);
  
  // Import Multipart State
  const [importParts, setImportParts] = useState<(string | null)[]>([]);
  const [totalImportParts, setTotalImportParts] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize audio once
  useEffect(() => {
    if (!bgMusic.current) {
      bgMusic.current = new Audio();
      bgMusic.current.volume = 0.3;
    }
    
    const handleEnded = () => {
      setCurrentTrackIndex(prev => (prev + 1) % CHILL_MUSIC_LIST.length);
    };
    
    bgMusic.current.addEventListener('ended', handleEnded);
    return () => {
      if (bgMusic.current) {
        bgMusic.current.removeEventListener('ended', handleEnded);
      }
    };
  }, []);

  // Handle track change
  useEffect(() => {
    if (bgMusic.current) {
      bgMusic.current.src = CHILL_MUSIC_LIST[currentTrackIndex];
      bgMusic.current.load();
      if (isMusicPlaying) {
        bgMusic.current.play().catch(() => {
           setIsMusicPlaying(false);
        });
      }
    }
  }, [currentTrackIndex]);

  // Handle play/pause toggle
  useEffect(() => {
    if (bgMusic.current) {
      if (isMusicPlaying) {
        bgMusic.current.play().catch(() => {
          setIsMusicPlaying(false);
        });
      } else {
        bgMusic.current.pause();
      }
    }
  }, [isMusicPlaying]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedCode = params.get('c');
    if (sharedCode) {
      setImportCode(sharedCode);
      setView('IMPORT');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const saved = localStorage.getItem('edu_quizzes_v2');
    if (saved) {
      try {
        setQuizzes(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load local storage", e);
      }
    }

    return () => {
      if (bgMusic.current) {
        bgMusic.current.pause();
        bgMusic.current.src = '';
        bgMusic.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (quizzes.length > 0) {
      localStorage.setItem('edu_quizzes_v2', JSON.stringify(quizzes));
    }
  }, [quizzes]);

  // Effect vẽ QR Code (Hỗ trợ Multi-QR)
  useEffect(() => {
    if (view === 'SHARE' && qrChunks.length > 0 && typeof QRious !== 'undefined') {
      try {
        const qrCanvas = document.getElementById('qr-code');
        if (qrCanvas) {
          // Lấy chunk hiện tại để vẽ
          const valueToEncode = qrChunks[currentQrIndex];
          
          new QRious({
            element: qrCanvas,
            value: valueToEncode,
            size: 250,
            level: 'L',
            backgroundAlpha: 0,
            foreground: '#ffffff'
          });
        }
      } catch(e) { console.error(e); }
    }
  }, [view, qrChunks, currentQrIndex]);

  const toggleMusic = () => {
    setIsMusicPlaying(!isMusicPlaying);
  };

  const handleNextTrack = () => {
    setCurrentTrackIndex(prev => (prev + 1) % CHILL_MUSIC_LIST.length);
  };

  const handlePrevTrack = () => {
    setCurrentTrackIndex(prev => (prev - 1 + CHILL_MUSIC_LIST.length) % CHILL_MUSIC_LIST.length);
  };

  // Logic Xử lý Nhập
  const handleImport = async (inputCode: string) => {
    if (!inputCode) return;
    const cleanCode = inputCode.trim();

    // Check if it's a short code (e.g. 6 characters alphanumeric)
    if (/^[A-Z0-9]{6}$/i.test(cleanCode)) {
      if (!auth.currentUser) {
        try {
          await signInWithPopup(auth, googleProvider);
        } catch (e) {
          alert("Vui lòng đăng nhập để tải đề từ server!");
          return;
        }
      }

      setIsImporting(true);
      try {
        const docRef = doc(db, 'shared_quizzes', cleanCode.toUpperCase());
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          const quiz: QuizSet = {
            id: `import-${Date.now()}`,
            title: data.title,
            description: data.description,
            questions: data.questions.map((q: any, idx: number) => ({
              id: `q-${Date.now()}-${idx}`,
              question: q.question,
              options: q.options,
              correctAnswer: q.correctAnswer,
              explanation: q.explanation
            })),
            createdAt: data.createdAt,
            color: COLORS[Math.floor(Math.random() * COLORS.length)]
          };
          
          setQuizzes(prev => {
             if (prev.some(q => q.title === quiz.title && q.questions.length === quiz.questions.length)) return prev;
             return [quiz, ...prev];
          });
          setActiveQuiz(quiz);
          setView('HOME');
          setImportCode('');
          alert(`Đã tải thành công: ${quiz.title}`);
        } else {
          alert("Mã không tồn tại hoặc đã bị xóa!");
        }
      } catch (e) {
        console.error(e);
        alert("Lỗi kết nối máy chủ.");
      } finally {
        setIsImporting(false);
      }
      return;
    }

    // Check Multi-QR Format: "MQR|{index}|{total}|{data}"
    // Index bắt đầu từ 1
    if (cleanCode.startsWith("MQR|")) {
      try {
        const [_, idxStr, totalStr, data] = cleanCode.split("|");
        const index = parseInt(idxStr) - 1; // Convert to 0-based
        const total = parseInt(totalStr);

        // Khởi tạo mảng parts nếu chưa có hoặc size khác (reset nếu quét mã mới)
        let newParts = [...importParts];
        if (totalImportParts !== total) {
           newParts = new Array(total).fill(null);
           setTotalImportParts(total);
        }

        newParts[index] = data;
        setImportParts(newParts);
        setImportCode(""); // Clear input

        // Kiểm tra xem đã đủ chưa
        const loadedCount = newParts.filter(p => p !== null).length;
        if (loadedCount === total) {
           // Ghép lại và giải nén
           const fullCode = newParts.join("");
           processFullCode(fullCode);
           // Reset import state
           setImportParts([]);
           setTotalImportParts(0);
        } else {
           alert(`Đã nhập Phần ${index + 1}/${total}. Hãy quét tiếp các phần còn lại!`);
        }

      } catch (e) {
        alert("Mã Multi-QR không hợp lệ.");
      }
      return;
    }

    // Single QR
    processFullCode(cleanCode);
  };

  const processFullCode = (code: string) => {
    const quiz = decompressFromCode(code);
    if (quiz) {
      setQuizzes(prev => {
         if (prev.some(q => q.title === quiz.title && q.questions.length === quiz.questions.length)) return prev;
         return [quiz, ...prev];
      });
      setActiveQuiz(quiz);
      setView('HOME');
      setImportCode('');
      alert(`Đã nhập thành công: ${quiz.title}`);
    } else {
      alert("Mã lỗi hoặc file bị hỏng!");
    }
  };

  const loadPublicQuizzes = async () => {
    setIsLoadingCommunity(true);
    try {
      const q = query(collection(db, 'public_quizzes'), orderBy('createdAt', 'desc'), limit(50));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPublicQuizzes(data);
    } catch (e) {
      console.error("Error loading public quizzes:", e);
    } finally {
      setIsLoadingCommunity(false);
    }
  };

  const loadLeaderboard = async () => {
    setIsLoadingLeaderboard(true);
    try {
      const q = query(collection(db, 'users'), orderBy('totalScore', 'desc'), limit(20));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLeaderboardUsers(data);
    } catch (e) {
      console.error("Error loading leaderboard:", e);
    } finally {
      setIsLoadingLeaderboard(false);
    }
  };

  useEffect(() => {
    // Check for deep link
    const params = new URLSearchParams(window.location.search);
    const pq = params.get('pq');
    if (pq) {
      getDoc(doc(db, 'public_quizzes', pq)).then(snap => {
        if (snap.exists()) {
          setActiveQuiz({ id: snap.id, ...snap.data() } as QuizSet);
        } else {
          alert("Không tìm thấy bộ đề này!");
        }
      });
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'COMMUNITY') {
      loadPublicQuizzes();
    } else if (activeTab === 'LEADERBOARD') {
      loadLeaderboard();
    }
  }, [activeTab]);

  const publishQuiz = async (quiz: QuizSet, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) {
      alert("Vui lòng đăng nhập để chia sẻ cho cộng đồng!");
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        return;
      }
    }
    
    if (!auth.currentUser) return;

    try {
      const docRef = doc(collection(db, 'public_quizzes'));
      await setDoc(docRef, {
        title: quiz.title,
        description: quiz.description || "Được chia sẻ từ cộng đồng",
        questions: quiz.questions.map(q => ({
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation || "Không có giải thích chi tiết."
        })),
        createdAt: Date.now(),
        authorUid: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Người dùng ẩn danh',
        authorPhoto: auth.currentUser.photoURL || '',
        playCount: 0,
        likes: [],
        color: quiz.color
      });
      alert("Đã đăng lên Cộng đồng thành công!");
      if (activeTab === 'COMMUNITY') {
        loadPublicQuizzes();
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi khi đăng bài.");
    }
  };

  const handleQuizComplete = async (score: number, quizId: string) => {
    // If it's a public quiz, increment play count
    if (activeTab === 'COMMUNITY') {
      try {
        const quizRef = doc(db, 'public_quizzes', quizId);
        await updateDoc(quizRef, { playCount: increment(1) });
      } catch (e) {
        console.error("Error updating play count:", e);
      }
    }

    if (!auth.currentUser || score === 0) return;
    try {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        await updateDoc(userRef, {
          totalScore: increment(score),
          displayName: auth.currentUser.displayName,
          photoURL: auth.currentUser.photoURL
        });
      } else {
        await setDoc(userRef, {
          uid: auth.currentUser.uid,
          displayName: auth.currentUser.displayName,
          photoURL: auth.currentUser.photoURL,
          totalScore: score
        });
      }
    } catch (err) {
      console.error("Lỗi cập nhật điểm:", err);
    }
  };

  const toggleLike = async (quizId: string, currentLikes: string[] = [], e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) {
      alert("Vui lòng đăng nhập để thích!");
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        return;
      }
    }
    if (!auth.currentUser) return;

    const uid = auth.currentUser.uid;
    const quizRef = doc(db, 'public_quizzes', quizId);
    const isLiked = currentLikes.includes(uid);

    try {
      if (isLiked) {
        await updateDoc(quizRef, { likes: arrayRemove(uid) });
        setPublicQuizzes(prev => prev.map(q => q.id === quizId ? {...q, likes: q.likes.filter((id: string) => id !== uid)} : q));
      } else {
        await updateDoc(quizRef, { likes: arrayUnion(uid) });
        setPublicQuizzes(prev => prev.map(q => q.id === quizId ? {...q, likes: [...(q.likes || []), uid]} : q));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const sharePublicQuiz = (quizId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}?pq=${quizId}`;
    navigator.clipboard.writeText(url);
    alert("Đã sao chép link chia sẻ bộ đề này!");
  };

  const openComments = (quizId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCommentsModalQuizId(quizId);
  };

  useEffect(() => {
    if (!commentsModalQuizId) return;
    const q = query(collection(db, 'public_quizzes', commentsModalQuizId, 'comments'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [commentsModalQuizId]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      alert("Vui lòng đăng nhập để bình luận!");
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (err) {
        return;
      }
    }
    if (!auth.currentUser || !newComment.trim() || !commentsModalQuizId) return;

    try {
      await addDoc(collection(db, 'public_quizzes', commentsModalQuizId, 'comments'), {
        text: newComment.trim(),
        authorUid: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Người dùng ẩn danh',
        authorPhoto: auth.currentUser.photoURL || '',
        createdAt: Date.now()
      });
      setNewComment('');
    } catch (err) {
      console.error(err);
      alert("Lỗi khi gửi bình luận.");
    }
  };

  const handlePasteAndImport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setImportCode(text);
      if (text.length > 10) {
          handleImport(text);
      }
    } catch (err) {
      alert("Không thể truy cập bộ nhớ đệm.");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setView('HOME');
    setError(null);

    try {
      const text = await extractTextFromFile(file);
      const title = file.name.replace(/\.[^/.]+$/, "");
      const questions = await generateQuizFromText(text, title);
      
      const newQuiz: QuizSet = {
        id: `quiz-${Date.now()}`,
        title,
        description: `Từ file: ${file.name}`,
        questions,
        createdAt: Date.now(),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      };

      setQuizzes(prev => [newQuiz, ...prev]);
    } catch (err: any) {
      setError(err.message || "Lỗi xử lý file.");
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const openShareModal = async (quiz: QuizSet, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!auth.currentUser) {
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (e) {
        alert("Vui lòng đăng nhập để chia sẻ đề!");
        return;
      }
    }

    setIsSharing(true);
    try {
      // Generate short code via Firestore
      const shortCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const docRef = doc(db, 'shared_quizzes', shortCode);
      
      const quizData = {
        title: quiz.title,
        description: quiz.description || "Được chia sẻ qua mã Code",
        questions: quiz.questions.map(q => ({
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation || "Không có giải thích chi tiết."
        })),
        createdAt: Date.now()
      };
      
      await setDoc(docRef, quizData);

      const code = compressToCode(quiz);
      
      // Calculate QR Chunks
      // Zalo safe limit ~ 1500 chars per QR for quick scan
      const MAX_CHUNK_SIZE = 1200; 
      const chunks: string[] = [];

      if (code.length <= MAX_CHUNK_SIZE) {
        chunks.push(code);
      } else {
        const total = Math.ceil(code.length / MAX_CHUNK_SIZE);
        for (let i = 0; i < total; i++) {
          const chunkData = code.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
          // Format: MQR|CurrentIndex|Total|Data
          chunks.push(`MQR|${i + 1}|${total}|${chunkData}`);
        }
      }
      
      setQrChunks(chunks);
      setCurrentQrIndex(0);

      const url = `${window.location.origin}${window.location.pathname}?c=${shortCode}`;
      
      setShareData({ code, url, shortCode });
      setView('SHARE');
    } catch (e) {
      console.error(e);
      alert("Lỗi tạo mã chia sẻ trên máy chủ. Vui lòng thử lại.");
    } finally {
      setIsSharing(false);
    }
  };

  const deleteQuiz = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Xóa bộ đề này?")) {
      const updated = quizzes.filter(q => q.id !== id);
      setQuizzes(updated);
      localStorage.setItem('edu_quizzes_v2', JSON.stringify(updated));
    }
  };

  const filteredQuizzes = quizzes.filter(q => 
    q.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (q.description && q.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 relative overflow-hidden flex flex-col">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none z-0">
         <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-900/40 rounded-full blur-[100px]"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-900/40 rounded-full blur-[100px]"></div>
      </div>

      {/* Top Bar */}
      <nav className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-white/5 px-4 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg">
            E
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight leading-none">EduAI</h1>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Mobile</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-2 mr-2">
              <img src={user.photoURL || ''} alt="Avatar" className="w-6 h-6 rounded-full border border-white/20" referrerPolicy="no-referrer" />
              <button onClick={() => auth.signOut()} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded-full font-bold transition-colors">
                Đăng xuất
              </button>
            </div>
          ) : (
            <button onClick={() => signInWithPopup(auth, googleProvider)} className="text-[10px] bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded-full font-bold transition-colors shadow-lg mr-2">
              Đăng nhập
            </button>
          )}
          {isMusicPlaying && (
            <div className="flex items-center gap-1 bg-white/5 rounded-full px-2 py-1">
              <button onClick={handlePrevTrack} className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white">⏮</button>
              <span className="text-[10px] text-indigo-300 font-bold w-12 text-center">Track {currentTrackIndex + 1}</span>
              <button onClick={handleNextTrack} className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-white">⏭</button>
            </div>
          )}
          <button 
              onClick={toggleMusic}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isMusicPlaying ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-white/10 text-slate-400'}`}
            >
              {isMusicPlaying ? '🎧' : '🔇'}
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 pb-32 z-10 scroll-smooth">
        
        {/* Header Section */}
        {!activeQuiz && view === 'HOME' && (
          <div className="mb-6 mt-2">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
               <div>
                 <h2 className="text-2xl font-black mb-1">Thư viện</h2>
                 <p className="text-slate-400 text-sm">Học tập thật "Chill" với AI</p>
               </div>
               <div className="relative w-full md:w-64">
                 <input 
                   type="text" 
                   placeholder="Tìm kiếm đề..." 
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                 />
                 <svg className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
               </div>
             </div>
             
             {/* Tabs */}
             <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
               <button 
                 onClick={() => setActiveTab('LIBRARY')}
                 className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${activeTab === 'LIBRARY' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
               >
                 Thư viện của tôi
               </button>
               <button 
                 onClick={() => setActiveTab('COMMUNITY')}
                 className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${activeTab === 'COMMUNITY' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
               >
                 Cộng đồng
               </button>
               <button 
                 onClick={() => setActiveTab('LEADERBOARD')}
                 className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${activeTab === 'LEADERBOARD' ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
               >
                 Bảng xếp hạng
               </button>
             </div>
             
             {isUploading && (
                <div className="mt-4 p-4 bg-indigo-600/20 rounded-2xl border border-indigo-500/30 flex items-center gap-4 animate-pulse">
                  <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                  <span className="font-bold text-indigo-300 text-sm">Đang tạo bộ đề...</span>
                </div>
             )}

             {error && (
                <div className="mt-4 p-4 bg-rose-500/20 rounded-2xl border border-rose-500/30 text-rose-300 text-sm">
                  {error}
                </div>
             )}
          </div>
        )}

        {/* Quiz Grid */}
        {view === 'HOME' && activeTab === 'LIBRARY' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredQuizzes.map(quiz => (
              <div 
                key={quiz.id}
                onClick={() => setActiveQuiz(quiz)}
                className={`group relative p-5 rounded-3xl border border-white/5 bg-gradient-to-br from-white/5 to-white/[0.02] hover:border-indigo-500/50 transition-all cursor-pointer active:scale-95`}
              >
                <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-br ${quiz.color.replace('text-', 'from-').split(' ')[0]} to-transparent opacity-20 blur-xl rounded-full`}></div>
                
                <h3 className="text-lg font-bold mb-1 leading-tight pr-6">{quiz.title}</h3>
                <p className="text-[10px] text-slate-400 mb-4 line-clamp-1">{quiz.description}</p>
                
                <div className="flex items-center justify-between mt-auto border-t border-white/5 pt-3">
                   <span className="text-[10px] font-bold bg-white/10 px-2 py-1 rounded-md text-slate-300">
                     {quiz.questions.length} câu
                   </span>
                   <div className="flex gap-1">
                      <button onClick={(e) => publishQuiz(quiz, e)} className="p-2 bg-white/5 hover:bg-white/20 rounded-xl text-emerald-400 transition-colors" title="Đăng lên cộng đồng">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                      </button>
                      <button onClick={(e) => openShareModal(quiz, e)} disabled={isSharing} className="p-2 bg-white/5 hover:bg-white/20 rounded-xl text-indigo-400 transition-colors disabled:opacity-50">
                        {isSharing ? '...' : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>}
                      </button>
                      <button onClick={(e) => deleteQuiz(quiz.id, e)} className="p-2 bg-white/5 hover:bg-white/20 rounded-xl text-rose-400 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                   </div>
                </div>
              </div>
            ))}
            
            {filteredQuizzes.length === 0 && !isUploading && (
              <div className="col-span-full py-12 text-center opacity-50 flex flex-col items-center">
                 <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4 text-3xl">📂</div>
                 <p className="font-bold">{searchQuery ? 'Không tìm thấy kết quả' : 'Thư viện trống'}</p>
                 {!searchQuery && <p className="text-xs mt-1">Bấm nút (+) ở dưới để thêm</p>}
              </div>
            )}
          </div>
        )}

        {view === 'HOME' && activeTab === 'COMMUNITY' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoadingCommunity ? (
              <div className="col-span-full py-12 text-center flex flex-col items-center">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-400">Đang tải đề từ cộng đồng...</p>
              </div>
            ) : publicQuizzes.length === 0 ? (
              <div className="col-span-full py-12 text-center opacity-50 flex flex-col items-center">
                 <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4 text-3xl">🌍</div>
                 <p className="font-bold">Chưa có đề nào được chia sẻ</p>
              </div>
            ) : (
              publicQuizzes.map(quiz => (
                <div 
                  key={quiz.id}
                  onClick={() => setActiveQuiz(quiz)}
                  className={`group relative p-5 rounded-3xl border border-white/5 bg-gradient-to-br from-white/5 to-white/[0.02] hover:border-indigo-500/50 transition-all cursor-pointer active:scale-95`}
                >
                  <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-br ${quiz.color?.replace('text-', 'from-').split(' ')[0] || 'from-indigo-500'} to-transparent opacity-20 blur-xl rounded-full`}></div>
                  
                  <h3 className="text-lg font-bold mb-1 leading-tight pr-6">{quiz.title}</h3>
                  <p className="text-[10px] text-slate-400 mb-2 line-clamp-1">{quiz.description}</p>
                  
                  <div className="flex items-center gap-2 mb-4">
                    {quiz.authorPhoto ? (
                      <img src={quiz.authorPhoto} alt={quiz.authorName} className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-[8px] font-bold text-indigo-300">
                        {quiz.authorName?.charAt(0) || '?'}
                      </div>
                    )}
                    <span className="text-xs text-slate-300">{quiz.authorName}</span>
                  </div>

                  <div className="flex items-center justify-between mt-auto border-t border-white/5 pt-3">
                     <span className="text-[10px] font-bold bg-white/10 px-2 py-1 rounded-md text-slate-300">
                       {quiz.questions?.length || 0} câu
                     </span>
                     <div className="flex items-center gap-2">
                       <button onClick={(e) => toggleLike(quiz.id, quiz.likes, e)} className={`flex items-center gap-1 text-[10px] ${quiz.likes?.includes(auth.currentUser?.uid) ? 'text-rose-400' : 'text-slate-400 hover:text-rose-400'} transition-colors`}>
                         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill={quiz.likes?.includes(auth.currentUser?.uid) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                         {quiz.likes?.length || 0}
                       </button>
                       <button onClick={(e) => openComments(quiz.id, e)} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-400 transition-colors">
                         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                       </button>
                       <button onClick={(e) => sharePublicQuiz(quiz.id, e)} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-400 transition-colors">
                         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                       </button>
                     </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {view === 'HOME' && activeTab === 'LEADERBOARD' && (
          <div className="max-w-2xl mx-auto">
            {isLoadingLeaderboard ? (
              <div className="py-12 text-center flex flex-col items-center">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-400">Đang tải bảng xếp hạng...</p>
              </div>
            ) : leaderboardUsers.length === 0 ? (
              <div className="py-12 text-center opacity-50 flex flex-col items-center">
                 <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4 text-3xl">🏆</div>
                 <p className="font-bold">Chưa có ai trên bảng xếp hạng</p>
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden">
                {leaderboardUsers.map((user, index) => (
                  <div key={user.id} className={`flex items-center gap-4 p-4 ${index !== leaderboardUsers.length - 1 ? 'border-b border-white/5' : ''}`}>
                    <div className="w-8 text-center font-black text-xl text-slate-500">
                      {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                    </div>
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.displayName} className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center font-bold text-indigo-300">
                        {user.displayName?.charAt(0) || '?'}
                      </div>
                    )}
                    <div className="flex-1">
                      <h4 className="font-bold text-white">{user.displayName || 'Người dùng ẩn danh'}</h4>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-indigo-400 text-xl">{user.totalScore}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">Điểm</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation - Z-40 */}
      <div className="fixed bottom-0 left-0 w-full bg-[#0f172a]/95 backdrop-blur-xl border-t border-white/10 pb-safe pt-2 px-6 z-40">
         <div className="flex justify-between items-center max-w-md mx-auto h-16">
            <button 
              onClick={() => setView('HOME')}
              className={`flex flex-col items-center gap-1 w-16 ${view === 'HOME' ? 'text-indigo-400' : 'text-slate-500'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              <span className="text-[10px] font-bold">Home</span>
            </button>

            {/* Central Upload Button */}
            <div className="relative -top-6">
              <label className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white shadow-[0_0_20px_rgba(79,70,229,0.5)] cursor-pointer hover:scale-105 active:scale-95 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <input 
                  ref={fileInputRef}
                  type="file" 
                  className="hidden" 
                  accept=".pdf,.docx,.txt" 
                  onChange={handleFileUpload}
                />
              </label>
            </div>

            <button 
              onClick={() => setView('IMPORT')}
              className={`flex flex-col items-center gap-1 w-16 ${view === 'IMPORT' ? 'text-indigo-400' : 'text-slate-500'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
              <span className="text-[10px] font-bold">Nhập Mã</span>
            </button>
         </div>
      </div>

      {activeQuiz && (
        <QuizPlayer 
          quiz={activeQuiz} 
          onClose={() => setActiveQuiz(null)} 
          onComplete={(score) => handleQuizComplete(score, activeQuiz.id)}
        />
      )}

      {/* Comments Modal */}
      {commentsModalQuizId && (
        <div className="fixed inset-0 z-[70] bg-[#0f172a]/90 backdrop-blur-sm flex flex-col items-center justify-end md:justify-center p-4">
          <div className="bg-[#1e293b] w-full max-w-md rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col max-h-[80vh] animate__animated animate__slideInUp">
            <div className="flex justify-between items-center p-4 border-b border-white/10 shrink-0">
              <h2 className="text-lg font-bold text-white">Bình luận</h2>
              <button onClick={() => setCommentsModalQuizId(null)} className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full text-slate-300 hover:text-white">✕</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {comments.length === 0 ? (
                <div className="text-center text-slate-500 py-8">Chưa có bình luận nào. Hãy là người đầu tiên!</div>
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className="flex gap-3">
                    {comment.authorPhoto ? (
                      <img src={comment.authorPhoto} alt={comment.authorName} className="w-8 h-8 rounded-full shrink-0" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0">
                        {comment.authorName?.charAt(0) || '?'}
                      </div>
                    )}
                    <div className="flex-1 bg-white/5 rounded-2xl p-3">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-xs font-bold text-indigo-300">{comment.authorName}</span>
                        <span className="text-[10px] text-slate-500">{new Date(comment.createdAt).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm text-slate-200">{comment.text}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={submitComment} className="p-4 border-t border-white/10 shrink-0 flex gap-2">
              <input 
                type="text" 
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Viết bình luận..." 
                className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <button 
                type="submit" 
                disabled={!newComment.trim()}
                className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Share View (Modal) - MOVED OUTSIDE MAIN - Z-60 */}
      {view === 'SHARE' && shareData && (
           <div className="fixed inset-0 z-[60] bg-[#0f172a] flex flex-col animate__animated animate__fadeInUp">
              <div className="flex justify-between items-center p-4 border-b border-white/5 shrink-0">
                 <h2 className="text-xl font-black text-white">Chia sẻ</h2>
                 <button onClick={() => setView('HOME')} className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                 <div className="flex flex-col gap-3">
                   {shareData.shortCode && (
                     <div className="bg-indigo-900/40 border border-indigo-500/30 p-4 rounded-2xl text-center">
                       <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest mb-1">Mã Ngắn (Server)</p>
                       <p className="text-3xl font-black text-white tracking-widest">{shareData.shortCode}</p>
                       <button 
                         onClick={() => {navigator.clipboard.writeText(shareData.shortCode!); alert("Đã chép mã ngắn!");}}
                         className="mt-2 text-xs bg-indigo-600/50 hover:bg-indigo-600 text-white px-4 py-2 rounded-full transition-colors"
                       >
                         📋 Sao chép Mã Ngắn
                       </button>
                     </div>
                   )}

                   {shareData.url && (
                      <button 
                        onClick={() => {navigator.clipboard.writeText(shareData.url!); alert("Đã chép Link!");}}
                        className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
                      >
                        🔗 Sao chép Link
                      </button>
                   )}
                   
                   <button 
                     onClick={() => {navigator.clipboard.writeText(shareData.code); alert("Đã chép mã!");}}
                     className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
                   >
                     📋 Sao chép Mã Text (Offline)
                   </button>
                 </div>

                 {/* QR Code Section */}
                 <div className="bg-white p-6 rounded-3xl flex flex-col items-center shadow-2xl relative shrink-0">
                    <canvas id="qr-code" className="w-48 h-48 md:w-64 md:h-64"></canvas>
                    
                    {/* QR Navigation Controls if Multiple */}
                    {qrChunks.length > 1 && (
                      <div className="absolute inset-x-0 bottom-4 px-6 flex justify-between items-center">
                         <button 
                           onClick={() => setCurrentQrIndex(prev => Math.max(0, prev - 1))}
                           disabled={currentQrIndex === 0}
                           className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-800 disabled:opacity-30 font-bold"
                         >
                           ←
                         </button>
                         <span className="text-xs font-bold text-slate-800 bg-slate-200 px-3 py-1 rounded-full">
                           Phần {currentQrIndex + 1}/{qrChunks.length}
                         </span>
                         <button 
                           onClick={() => setCurrentQrIndex(prev => Math.min(qrChunks.length - 1, prev + 1))}
                           disabled={currentQrIndex === qrChunks.length - 1}
                           className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-800 disabled:opacity-30 font-bold"
                         >
                           →
                         </button>
                      </div>
                    )}

                    <p className="text-slate-900 font-bold mt-4 text-center">Quét Zalo</p>
                    <p className="text-slate-500 text-xs text-center">
                       {qrChunks.length > 1 
                         ? "Quét lần lượt từng mã" 
                         : "Đưa camera vào quét"}
                    </p>
                 </div>
                 
                 <div className="p-4 bg-white/5 rounded-2xl">
                    <p className="text-[10px] text-slate-400 text-center uppercase font-bold mb-2">Mã dữ liệu thô</p>
                    <textarea 
                      readOnly 
                      value={shareData.code}
                      className="w-full bg-black/30 rounded-xl p-2 text-[10px] font-mono h-20 text-slate-500 resize-none focus:outline-none"
                      onClick={(e) => e.currentTarget.select()}
                    />
                 </div>
              </div>
           </div>
      )}

      {/* Import View - MOVED OUTSIDE MAIN - Z-60 - CHANGED LAYOUT */}
      {view === 'IMPORT' && (
           <div className="fixed inset-0 z-[60] bg-[#0f172a] flex flex-col animate__animated animate__fadeInUp">
              <div className="flex justify-between items-center p-4 border-b border-white/5 shrink-0">
                 <h2 className="text-xl font-black text-white">Nhập Mã</h2>
                 <button onClick={() => setView('HOME')} className="w-8 h-8 flex items-center justify-center bg-white/10 rounded-full">✕</button>
              </div>
              
              <div className="flex-1 flex flex-col p-4 overflow-hidden relative">
                 {/* Multi-QR Progress Indicator */}
                 {totalImportParts > 0 && (
                   <div className="mb-4 bg-indigo-900/40 p-4 rounded-2xl border border-indigo-500/30 shrink-0">
                     <p className="text-sm text-indigo-200 mb-2 font-bold">Đang quét mã nhiều phần...</p>
                     <div className="flex gap-2">
                       {new Array(totalImportParts).fill(0).map((_, idx) => (
                         <div 
                           key={idx} 
                           className={`h-2 flex-1 rounded-full transition-all ${importParts[idx] ? 'bg-emerald-500' : 'bg-white/10'}`}
                         />
                       ))}
                     </div>
                     <p className="text-xs text-slate-400 mt-2 text-center">
                       Đã nhận {importParts.filter(Boolean).length}/{totalImportParts} phần
                     </p>
                   </div>
                 )}

                 <textarea 
                   value={importCode}
                   onChange={(e) => setImportCode(e.target.value)}
                   placeholder="Nhập mã ngắn (6 ký tự), dán mã offline hoặc link vào đây..."
                   className="flex-1 bg-black/20 border border-white/10 rounded-2xl p-4 text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none font-mono text-xs resize-none mb-4"
                 />
                 
                 {/* Footer Buttons - No longer absolute, now part of flex flow */}
                 <div className="shrink-0 pt-2 pb-safe">
                    <div className="grid grid-cols-2 gap-3">
                        <button 
                        onClick={handlePasteAndImport}
                        disabled={isImporting}
                        className="py-4 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-bold text-sm transition-colors disabled:opacity-50"
                        >
                        📋 Dán từ Clip
                        </button>
                        <button 
                        onClick={() => handleImport(importCode)}
                        disabled={!importCode || isImporting}
                        className="py-4 bg-indigo-600 disabled:opacity-50 text-white rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-all"
                        >
                        {isImporting ? 'Đang tải...' : '🚀 Tải Về'}
                        </button>
                    </div>
                 </div>
              </div>
           </div>
      )}

    </div>
  );
};

export default App;
