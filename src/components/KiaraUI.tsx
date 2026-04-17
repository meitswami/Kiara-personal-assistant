/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Power, Globe, Zap, Heart, Sparkles, Shield, X, Send, MessageSquare, Coins, Settings, Bell, Smartphone, Volume2, ChevronDown, ClosedCaption, Database, Search, Pin } from 'lucide-react';
import { AudioStreamer } from '../lib/audio-streamer';
import { VideoStreamer } from '../lib/video-streamer';
import { LiveSession, SessionState } from '../lib/live-session';
import { AIService } from '../services/ai-service';
import { auth, signInWithGoogle } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { RegistrationForm } from './RegistrationForm';
import { LoginForm } from './LoginForm';
import { AdminPanel } from './AdminPanel';
import { TalkingAvatar } from './TalkingAvatar';
import { collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { assistantCore } from '../lib/assistant-core';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { WifiOff } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'kiara';
  timestamp: Date;
}

export const KiaraUI: React.FC = () => {
  const [state, setState] = useState<SessionState>("disconnected");
  const stateRef = useRef<SessionState>("disconnected");

  // Update ref whenever state changes
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [isPowerOn, setIsPowerOn] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log(`[Kiara Debug] ${msg}`);
    setDebugLogs(prev => [...prev.slice(-4), msg]);
  };
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'none'>('none');
  const [showAdmin, setShowAdmin] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ phone: string; transcript: string } | null>(null);
  const [analyzingCall, setAnalyzingCall] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [pinnedMemories, setPinnedMemories] = useState<string[]>([]);
  const [memories, setMemories] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [reminders, setReminders] = useState<any[]>([]);

  const handleSearchMemory = async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await AIService.searchMemory(query);
      setSearchResults(results);
      console.log("Memory search results:", results);
    } catch (err) {
      console.error("Memory search failed:", err);
    }
  };

  const handleMemorize = async (text: string) => {
    addLog("Kiara is memorizing this for you...");
    try {
      await AIService.memorizeStructured(text);
      addLog("Memory stored successfully in JSON and Database.");
    } catch (err) {
      console.error("Memorization failed:", err);
      addLog("Failed to memorize. Please try again.");
    }
  };
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [tokens, setTokens] = useState({ used: 1240, total: 50000 }); // Mock token data
  const [insights, setInsights] = useState<any[]>([]);
  const [showInsights, setShowInsights] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isVisionOn, setIsVisionOn] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [visualization, setVisualization] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [audioLevel, setAudioLevel] = useState(0);
  const [selectedModel, setSelectedModel] = useState("gemini-2.0-flash-exp");
  const lastSavedMessageRef = useRef<string | null>(null);
  const [settings, setSettings] = useState({
    wakeWord: false,
    mobileWake: false,
    hinglish: true
  });
  
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const videoStreamerRef = useRef<VideoStreamer | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const liveSessionRef = useRef<LiveSession | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      
      // Save/Update the message in Firestore
      AIService.saveMessage(lastMsg.id, lastMsg.text, lastMsg.sender);
      
      // If it's a new message ID, check if we should trigger knowledge extraction
      if (lastMsg.id !== lastSavedMessageRef.current) {
        lastSavedMessageRef.current = lastMsg.id;
        
        // Every 5 messages, try to extract knowledge
        if (messages.length % 5 === 0) {
          AIService.extractKnowledgeFromRecent();
        }
      }
    }
  }, [messages]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleVisualize = (e: any) => {
      setVisualization(e.detail);
      setShowChat(false);
      setShowMemory(false);
      setShowInsights(false);
    };

    window.addEventListener('kiara-visualize', handleVisualize);
    return () => window.removeEventListener('kiara-visualize', handleVisualize);
  }, []);

  useEffect(() => {
    // Initialize Speech Recognition for Wake Word
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
        if (transcript.includes('hey kiara') || transcript.includes('kiara')) {
          if (!isPowerOn) {
            handleConnect();
          }
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech Recognition Error:", event.error);
        if (event.error === 'not-allowed') {
          setSettings(prev => ({ ...prev, wakeWord: false }));
        }
      };
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const docRef = doc(db, 'users', u.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setUserProfile(docSnap.data());
        } else {
          // Create initial profile if it doesn't exist
          const initialProfile = {
            email: u.email,
            firstName: u.displayName?.split(' ')[0] || 'User',
            lastName: u.displayName?.split(' ').slice(1).join(' ') || '',
            role: 'user',
            aiPersonality: 'sassy',
            createdAt: new Date().toISOString()
          };
          await setDoc(docRef, initialProfile);
          setUserProfile(initialProfile);
        }
        AIService.testConnection();

        // Listen for memories
        const memoriesQuery = query(
          collection(db, 'memories'),
          where('userId', '==', u.uid),
          orderBy('createdAt', 'desc'),
          limit(20)
        );
        const unsubMemories = onSnapshot(memoriesQuery, (snapshot) => {
          setMemories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        // Listen for reminders
        const remindersQuery = query(
          collection(db, 'reminders'),
          where('userId', '==', u.uid),
          orderBy('dueDate', 'asc')
        );
        const unsubReminders = onSnapshot(remindersQuery, (snapshot) => {
          setReminders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        setAuthMode('none');
        
        // Initial ERP Sync
        assistantCore.syncWithERP();
        AIService.syncOfflineData();

        return () => {
          unsubMemories();
          unsubReminders();
        };
      } else {
        setUserProfile(null);
      }
      setIsAuthReady(true);
    });

    audioStreamerRef.current = assistantCore.audioEngine;
    videoStreamerRef.current = new VideoStreamer();
    
    const handleSummarize = async (e: any) => {
      const { transcript } = e.detail;
      try {
        const analysis = await AIService.analyzeConversation(transcript);
        await AIService.storeMemory({
          type: "meeting",
          content: analysis.summary,
          entities: { items: analysis.entities },
          actionItems: analysis.actionItems,
          priority: analysis.opportunityScore > 7 ? "high" : "medium"
        });
        console.log("Conversation analyzed and stored:", analysis);
      } catch (err) {
        console.error("Summarization failed:", err);
      }
    };

    const handleCreateTasks = async () => {
      console.log("Task generation triggered");
    };

    const onSearchMemory = (e: any) => handleSearchMemory(e.detail.query);
    const onMemorize = (e: any) => handleMemorize(e.detail.text);
    const onToggleFocus = () => setIsFocusMode(prev => !prev);
    const onToggleVision = (e: any) => setIsVisionOn(e.detail.enabled);
    const onToggleChat = (e: any) => setShowChat(e.detail.enabled);
    const onToggleMemory = (e: any) => setShowMemory(e.detail.enabled);

    window.addEventListener("kiara-summarize", handleSummarize);
    window.addEventListener("kiara-create-tasks", handleCreateTasks);
    window.addEventListener("kiara-search-memory", onSearchMemory);
    window.addEventListener("kiara-memorize", onMemorize);
    window.addEventListener("kiara-toggle-focus", onToggleFocus);
    window.addEventListener("kiara-toggle-vision", onToggleVision);
    window.addEventListener("kiara-toggle-chat", onToggleChat);
    window.addEventListener("kiara-toggle-memory", onToggleMemory);
    window.addEventListener("online", () => AIService.syncOfflineData());

    // Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'c':
          setShowChat(prev => !prev);
          break;
        case 'm':
          setShowMemory(prev => !prev);
          break;
        case 'v':
          setIsVisionOn(prev => !prev);
          break;
        case 'p':
          togglePower();
          break;
        case 'f':
          setIsFocusMode(prev => !prev);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      handleDisconnect();
      unsubscribe();
      window.removeEventListener("kiara-summarize", handleSummarize);
      window.removeEventListener("kiara-create-tasks", handleCreateTasks);
      window.removeEventListener("kiara-search-memory", onSearchMemory);
      window.removeEventListener("kiara-memorize", onMemorize);
      window.removeEventListener("kiara-toggle-focus", onToggleFocus);
      window.removeEventListener("kiara-toggle-vision", onToggleVision);
      window.removeEventListener("kiara-toggle-chat", onToggleChat);
      window.removeEventListener("kiara-toggle-memory", onToggleMemory);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (settings.wakeWord && !isPowerOn) {
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.warn("Recognition already started");
      }
    } else {
      recognitionRef.current?.stop();
    }
  }, [settings.wakeWord, isPowerOn]);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Sign in failed:", error);
    }
  };

  const handleConnect = async () => {
    if (!user) {
      setAuthMode('login');
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    addLog(`Starting connection (Online: ${navigator.onLine})...`);
    
    // Check for both undefined and the literal string "undefined" (common Vite build issue)
    if (!apiKey || apiKey === "undefined" || apiKey === "") {
      addLog("ERROR: API Key is missing or invalid in build");
      alert("Kiara's brain (API Key) is missing! Please ensure GEMINI_API_KEY is set in the environment and rebuild the app.");
      return;
    }

    addLog(`API Key detected (starts with: ${apiKey.substring(0, 4)}...)`);

    try {
      // Stop wake word recognition before starting full recording
      if (recognitionRef.current) {
        addLog("Stopping wake word listener...");
        try {
          recognitionRef.current.stop();
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          addLog("Wake word stop warning: " + e);
        }
      }

      addLog("Initializing Live Session...");
      liveSessionRef.current = await assistantCore.initializeLiveSession(apiKey);
      
      addLog("Starting Microphone...");
      try {
        // Request microphone access BEFORE connecting to the Live API
        // This ensures permissions are granted and the user gesture is fresh
        await audioStreamerRef.current?.startRecording((base64) => {
          if (liveSessionRef.current) {
            liveSessionRef.current.sendAudio(base64);
          }
        });
        addLog("Microphone Active");
      } catch (micError: any) {
        addLog(`MICROPHONE ERROR: ${micError.message}`);
        throw micError; // Rethrow to be caught by the main catch block
      }

      addLog("Connecting to Intelligence Engine...");
      await liveSessionRef.current.connect({
        addLog,
        onStateChange: (newState) => {
          addLog(`State changed to: ${newState}`);
          setState(newState);
          if (newState === "disconnected") {
            setIsPowerOn(false);
          }
        },
        onAudioData: (base64) => {
          audioStreamerRef.current?.playAudioChunk(base64);
          setAudioLevel(Math.random() * 0.5 + 0.5);
        },
        onInterrupted: () => {
          addLog("Interrupted by user");
          audioStreamerRef.current?.stopPlayback();
          setAudioLevel(0);
        },
        onTranscription: (text, isModel) => {
          if (isModel) setAudioLevel(0.2);
          console.log(`Transcription (${isModel ? 'Kiara' : 'User'}):`, text);
          
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            const sender = isModel ? 'kiara' : 'user';
            
            // Increase merge window for better streaming display
            const mergeWindow = isModel ? 5000 : 3000;
            
            if (lastMsg && lastMsg.sender === sender && (new Date().getTime() - lastMsg.timestamp.getTime() < mergeWindow)) {
              const newMessages = [...prev];
              newMessages[newMessages.length - 1] = {
                ...lastMsg,
                text: text,
                timestamp: new Date()
              };
              return newMessages;
            }
            
            return [...prev, {
              id: Math.random().toString(36).substring(7),
              text,
              sender,
              timestamp: new Date()
            }];
          });

          if (userProfile?.role === 'admin') {
            setTokens(prev => ({ ...prev, used: prev.used + Math.floor(text.length / 4) }));
          }
        },
        onError: (err) => {
          const errMsg = err.message || JSON.stringify(err);
          addLog(`API ERROR: ${errMsg}`);
          console.error("Live API Error:", err);
          setIsPowerOn(false);
          
          // Provide more helpful error message for Code 1006
          if (errMsg.includes("1006")) {
            alert(`Kiara Connection Error: The connection was closed unexpectedly (1006). This usually means the API key is invalid or the server proxy is misconfigured. Please check your GEMINI_API_KEY.`);
          } else {
            alert(`Kiara Connection Error: ${errMsg}`);
          }
        }
      }, {
        gender: userProfile?.gender,
        personality: isFocusMode ? 'professional' : userProfile?.aiPersonality,
        userName: userProfile?.firstName,
        model: selectedModel
      });

      // Final check if we are still connected before going live
      // Increase timeout to 3 seconds for slower connections in production
      addLog("Verifying connection stability...");
      let attempts = 0;
      while (attempts < 30) { // 3 seconds total
        if (stateRef.current === "connected" || stateRef.current === "speaking" || stateRef.current === "listening") {
          break;
        }
        if (stateRef.current === "disconnected") {
          throw new Error("Connection lost during initialization. Please check your internet connection.");
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (stateRef.current === "disconnected" || stateRef.current === "connecting") {
        throw new Error("Connection timed out. The Intelligence Engine is taking too long to respond.");
      }

      addLog("System Live!");
      setIsPowerOn(true);
    } catch (error: any) {
      const errMsg = error.message || "Unknown connection error";
      addLog(`CRITICAL ERROR: ${errMsg}`);
      console.error("Failed to connect:", error);
      setIsPowerOn(false);
      alert(`Failed to connect to Kiara: ${errMsg}\n\nPlease check your microphone and internet connection.`);
    }
  };

  useEffect(() => {
    const startVision = async () => {
      if (isVisionOn) {
        addLog("Requesting Camera Permission...");
        try {
          await videoStreamerRef.current?.start((base64) => {
            if (liveSessionRef.current && stateRef.current !== "disconnected") {
              liveSessionRef.current.sendVideo(base64);
            }
          }, videoPreviewRef.current || undefined);
          addLog("Vision Started Successfully");
        } catch (err) {
          addLog(`Vision Error: ${err}`);
          setIsVisionOn(false);
        }
      } else {
        videoStreamerRef.current?.stop();
      }
    };
    
    startVision();
  }, [isVisionOn]);

  const handleDisconnect = () => {
    audioStreamerRef.current?.stopRecording();
    videoStreamerRef.current?.stop();
    audioStreamerRef.current?.stopPlayback();
    liveSessionRef.current?.disconnect();
    setIsPowerOn(false);
    setState("disconnected");
    
    // Final knowledge extraction when session ends
    AIService.extractKnowledgeFromRecent();
  };

  const togglePower = () => {
    if (isPowerOn) {
      handleDisconnect();
    } else {
      handleConnect();
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim() || !liveSessionRef.current) return;
    
    const text = chatInput.trim();
    liveSessionRef.current.sendText(text);
    
    setMessages(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      text,
      sender: 'user',
      timestamp: new Date()
    }]);
    
    setChatInput("");
    if (userProfile?.role === 'admin') {
      setTokens(prev => ({ ...prev, used: prev.used + Math.floor(text.length / 4) }));
    }
  };

  const handleGetInsights = async () => {
    setShowInsights(true);
    try {
      const ideas = await assistantCore.getInsights();
      setInsights(ideas);
    } catch (err) {
      console.error("Failed to get insights:", err);
    }
  };

  const getStatusColor = () => {
    switch (state) {
      case "connecting": return "text-yellow-400";
      case "connected": return "text-green-400";
      case "listening": return "text-blue-400";
      case "speaking": return "text-pink-400";
      default: return "text-gray-500";
    }
  };

  const getStatusText = () => {
    switch (state) {
      case "connecting": return "Waking up...";
      case "connected": return "Ready for you";
      case "listening": return "Listening, babe";
      case "speaking": return "Kiara is talking";
      default: return "Offline";
    }
  };

  return (
    <div className="fixed inset-0 bg-[#050505] text-white flex flex-col items-center justify-between p-8 font-sans overflow-hidden">
      {/* Call Notification Simulation */}
      <AnimatePresence>
        {incomingCall && (
          <motion.div
            initial={{ opacity: 0, y: -100, scale: 0.9 }}
            animate={{ opacity: 1, y: 20, scale: 1 }}
            exit={{ opacity: 0, y: -100, scale: 0.9 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm bg-black/80 backdrop-blur-2xl border border-white/20 rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-pink-500 flex items-center justify-center animate-pulse">
                <Smartphone className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Call Ended</h3>
                <p className="text-sm text-gray-400">{incomingCall.phone}</p>
              </div>
            </div>
            <p className="text-sm text-gray-300 mb-6 italic">
              "Kiara detected a call recording. Should I analyze it for tasks and reminders?"
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  setAnalyzingCall(true);
                  try {
                    await AIService.analyzeCall(incomingCall.phone, incomingCall.transcript);
                    addLog("Call analyzed. Reminders added to your calendar.");
                  } catch (err) {
                    console.error("Call analysis failed:", err);
                  } finally {
                    setAnalyzingCall(false);
                    setIncomingCall(null);
                  }
                }}
                disabled={analyzingCall}
                className="flex-1 bg-pink-500 hover:bg-pink-600 text-white font-bold py-3 rounded-2xl transition-all disabled:opacity-50"
              >
                {analyzingCall ? "Analyzing..." : "Yes, Analyze"}
              </button>
              <button
                onClick={() => setIncomingCall(null)}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-2xl transition-all"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Live Captions Overlay */}
      <AnimatePresence>
        {showCaptions && messages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[90] w-full max-w-xl px-4 pointer-events-none"
          >
            <div className="bg-black/90 backdrop-blur-3xl border border-white/20 rounded-2xl p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)] text-center">
              <div className="flex items-center justify-center gap-4 mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${messages[messages.length - 1].sender === 'kiara' ? 'bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.8)]' : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]'} animate-pulse`} />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-black">
                    {messages[messages.length - 1].sender === 'kiara' ? 'KIARA' : 'YOU'}
                  </span>
                </div>
                {isVisionOn && (
                  <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 rounded-full">
                    <Smartphone className="w-2 h-2 text-blue-400" />
                    <span className="text-[8px] text-blue-400 font-bold uppercase tracking-widest">Vision Active</span>
                  </div>
                )}
              </div>
              <p className="text-xl md:text-2xl font-medium leading-tight text-white drop-shadow-md">
                {messages[messages.length - 1].text}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Debug Overlay */}
      {showDebug && debugLogs.length > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-xs pointer-events-none">
          <div className="bg-black/80 backdrop-blur-md border border-white/10 rounded-xl p-3 space-y-1">
            <div className="text-[8px] uppercase tracking-widest text-gray-500 mb-1">Debug Logs</div>
            {debugLogs.map((log, i) => (
              <div key={i} className="text-[10px] font-mono text-blue-400 truncate">
                {`> ${log}`}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Vision Preview */}
      <AnimatePresence>
        {isVisionOn && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 20 }}
            className="fixed top-24 right-6 z-[80] w-48 h-36 bg-black rounded-2xl border-2 border-blue-500/50 overflow-hidden shadow-2xl"
          >
            <video 
              ref={videoPreviewRef}
              autoPlay 
              muted 
              playsInline 
              className="w-full h-full object-cover mirror"
            />
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-blue-500/80 rounded text-[8px] font-bold uppercase tracking-widest">
              Live Vision {isPowerOn ? '(Active)' : '(Preview)'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Atmosphere */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-pink-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-blue-500/10 rounded-full blur-[120px]" />
      </div>

      {/* Header */}
      <motion.div 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="z-10 text-center w-full flex flex-col items-center"
      >
        <div className="flex items-center justify-between w-full max-w-md mb-4 px-4">
          <div className="flex items-center gap-2">
            {userProfile?.role === 'admin' && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                <Coins className="w-3 h-3 text-yellow-500" />
                <span className="text-[9px] font-mono text-gray-400">
                  {tokens.used.toLocaleString()} / {tokens.total.toLocaleString()}
                </span>
              </div>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tighter flex items-center justify-center gap-2">
            KIARA <Sparkles className="text-pink-500 w-5 h-5" />
          </h1>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowMemory(!showMemory)}
              className={`p-2 rounded-lg transition-all duration-300 ${showMemory ? 'bg-pink-500/20 text-pink-400 shadow-[0_0_15px_rgba(236,72,153,0.3)]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              title="Memory & Calendar"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setIsVisionOn(!isVisionOn)}
              className={`p-2 rounded-lg transition-all duration-300 ${isVisionOn ? 'bg-blue-500/20 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              title={isVisionOn ? "Vision Enabled" : "Enable Vision"}
            >
              <Smartphone className={`w-4 h-4 ${isVisionOn ? 'animate-pulse' : ''}`} />
            </button>
            <button 
              onClick={() => setShowCaptions(!showCaptions)}
              className={`p-2 rounded-lg transition-all duration-300 ${showCaptions ? 'bg-pink-500/20 text-pink-400 shadow-[0_0_15px_rgba(236,72,153,0.3)]' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              title="Live Captions"
            >
              <ClosedCaption className="w-4 h-4" />
            </button>
            {user ? (
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button 
                onClick={handleGetInsights}
                className={`p-2 rounded-lg transition-colors ${showInsights ? 'bg-yellow-500/20 text-yellow-500' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              >
                <Zap className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setShowChat(!showChat)}
                className={`p-2 rounded-lg transition-colors ${showChat ? 'bg-pink-500/20 text-pink-500' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              {(userProfile?.role === 'admin' || user?.email === 'meit2swami@gmail.com') && (
                <button 
                  onClick={() => setShowAdmin(true)}
                  className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                >
                  <Shield className="w-4 h-4" />
                </button>
              )}
              <img 
                src={user.photoURL || `https://ui-avatars.com/api/?name=${userProfile?.firstName}+${userProfile?.lastName}&background=random`} 
                alt="Profile" 
                className="w-8 h-8 rounded-full border border-white/20"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <button 
              onClick={() => setAuthMode('login')}
              className="text-[10px] uppercase tracking-widest font-bold text-pink-500 hover:text-pink-400 transition-colors"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500 mt-1">Personal Intelligence System</p>
      </motion.div>

      {/* Auth Modals */}
      <AnimatePresence>
        {authMode !== 'none' && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            {authMode === 'login' ? (
              <LoginForm 
                onSuccess={() => setAuthMode('none')} 
                onSwitchToRegister={() => setAuthMode('register')} 
              />
            ) : (
              <RegistrationForm 
                onSuccess={() => setAuthMode('none')} 
                onSwitchToLogin={() => setAuthMode('login')} 
              />
            )}
            <button 
              onClick={() => setAuthMode('none')}
              className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Panel */}
      <AnimatePresence>
        {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-[#111] border border-white/10 rounded-3xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Settings className="w-5 h-5 text-gray-400" />
                  System Settings
                </h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                {/* Wake Word */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <Volume2 className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">Wake Word Detection</h3>
                      <p className="text-[10px] text-gray-500">Say "Hey Kiara" to activate in background</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSettings(prev => ({ ...prev, wakeWord: !prev.wakeWord }))}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.wakeWord ? 'bg-blue-500' : 'bg-white/10'}`}
                  >
                    <motion.div 
                      animate={{ x: settings.wakeWord ? 24 : 4 }}
                      className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>

                {/* Mobile Wake */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-pink-500/10">
                      <Smartphone className="w-5 h-5 text-pink-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">Mobile Background Wake</h3>
                      <p className="text-[10px] text-gray-500">Enable long-press wake up for APK</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSettings(prev => ({ ...prev, mobileWake: !prev.mobileWake }))}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.mobileWake ? 'bg-pink-500' : 'bg-white/10'}`}
                  >
                    <motion.div 
                      animate={{ x: settings.mobileWake ? 24 : 4 }}
                      className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>

                {/* Hinglish */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-yellow-500/10">
                      <Globe className="w-5 h-5 text-yellow-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">Adaptive Hinglish</h3>
                      <p className="text-[10px] text-gray-500">Auto-switch between Hindi and English</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSettings(prev => ({ ...prev, hinglish: !prev.hinglish }))}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.hinglish ? 'bg-yellow-500' : 'bg-white/10'}`}
                  >
                    <motion.div 
                      animate={{ x: settings.hinglish ? 24 : 4 }}
                      className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>

                {/* Model Selection */}
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">AI Intelligence Model</label>
                  <div className="relative">
                    <select 
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm appearance-none focus:outline-none focus:border-pink-500/50 transition-colors"
                    >
                      <option value="gemini-2.0-flash-exp" className="bg-[#111]">Gemini 2.0 Flash (Live)</option>
                      <option value="gemini-1.5-flash" className="bg-[#111]">Gemini 1.5 Flash (Stable)</option>
                      <option value="gemini-1.5-pro" className="bg-[#111]">Gemini 1.5 Pro (Deep)</option>
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {/* Personality Selection */}
                <div className="space-y-3 pt-4 border-t border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-pink-500/10">
                      <Heart className="w-5 h-5 text-pink-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">AI Personality</h3>
                      <p className="text-[10px] text-gray-500">Choose how Kiara speaks to you</p>
                    </div>
                  </div>
                  <div className="relative">
                    <select
                      value={userProfile?.aiPersonality || 'sassy'}
                      onChange={async (e) => {
                        const p = e.target.value;
                        if (user) {
                          await setDoc(doc(db, 'users', user.uid), { aiPersonality: p }, { merge: true });
                          setUserProfile((prev: any) => ({ ...prev, aiPersonality: p }));
                          addLog(`Personality changed to ${p}. Restart session to apply.`);
                        }
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white focus:outline-none focus:border-pink-500/50 transition-colors appearance-none cursor-pointer"
                    >
                      <option value="sassy" className="bg-[#111]">Sassy (Default)</option>
                      <option value="romantic" className="bg-[#111]">Romantic</option>
                      <option value="cool" className="bg-[#111]">Cool</option>
                      <option value="professional" className="bg-[#111]">Professional</option>
                      <option value="father" className="bg-[#111]">Father</option>
                      <option value="guide" className="bg-[#111]">Guide & Mentor</option>
                      <option value="brotherhood" className="bg-[#111]">Brotherhood</option>
                      <option value="sisterhood" className="bg-[#111]">Sisterhood</option>
                      <option value="normal" className="bg-[#111]">Normal</option>
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-white/[0.02] border-t border-white/10">
                <p className="text-[10px] text-gray-500 text-center">
                  Mobile settings require native APK bridge to function.
                </p>
                
                {/* Focus Mode Toggle */}
                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isFocusMode ? 'bg-purple-500/10 text-purple-500' : 'bg-gray-500/10 text-gray-500'}`}>
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">Focus Mode</h3>
                      <p className="text-[10px] text-gray-500">Minimize chit-chat & direct responses</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsFocusMode(!isFocusMode)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${isFocusMode ? 'bg-purple-500' : 'bg-white/10'}`}
                  >
                    <motion.div 
                      animate={{ x: isFocusMode ? 24 : 4 }}
                      className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg"
                    />
                  </button>
                </div>

                {/* Debug Mode */}
                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <Shield className="w-5 h-5 text-blue-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold">Debug Mode</h3>
                        <p className="text-[10px] text-gray-500">Show system logs for troubleshooting</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowDebug(!showDebug)}
                      className={`w-12 h-6 rounded-full transition-colors relative ${showDebug ? 'bg-blue-500' : 'bg-white/10'}`}
                    >
                      <motion.div 
                        animate={{ x: showDebug ? 24 : 4 }}
                        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-lg"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Insights Panel */}
      <AnimatePresence>
        {showInsights && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed right-4 top-24 bottom-24 w-80 bg-black/80 backdrop-blur-xl border border-white/10 rounded-3xl p-6 z-40 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Insights
              </h3>
              <button onClick={() => setShowInsights(false)}>
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-6">
              {insights.length > 0 ? insights.map((idea, i) => (
                <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5">
                  <h4 className="font-bold text-sm text-pink-400 mb-2">{idea.title}</h4>
                  <p className="text-xs text-gray-400 mb-3">{idea.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {idea.missingSkills.map((skill: string, j: number) => (
                      <span key={j} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )) : (
                <p className="text-xs text-gray-500 text-center py-10">No insights yet. Talk to me more, darling!</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Central Visualizer */}
      <div className="relative flex flex-col items-center justify-center w-full max-w-md flex-1">
        <AnimatePresence mode="wait">
          {visualization ? (
            <motion.div
              key="visualization"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full bg-black/80 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 flex flex-col relative z-20"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold text-white">{visualization.title}</h3>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">{visualization.type} Chart</p>
                </div>
                <button 
                  onClick={() => setVisualization(null)}
                  className="p-2 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {visualization.type === 'bar' ? (
                    <BarChart data={visualization.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="name" stroke="#666" fontSize={10} />
                      <YAxis stroke="#666" fontSize={10} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px', fontSize: '10px' }}
                        itemStyle={{ color: '#ec4899' }}
                      />
                      <Bar dataKey="value" fill="#ec4899" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  ) : visualization.type === 'line' ? (
                    <LineChart data={visualization.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="name" stroke="#666" fontSize={10} />
                      <YAxis stroke="#666" fontSize={10} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px', fontSize: '10px' }}
                      />
                      <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                    </LineChart>
                  ) : visualization.type === 'area' ? (
                    <AreaChart data={visualization.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="name" stroke="#666" fontSize={10} />
                      <YAxis stroke="#666" fontSize={10} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px', fontSize: '10px' }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#ec4899" fill="#ec4899" fillOpacity={0.2} />
                    </AreaChart>
                  ) : (
                    <PieChart>
                      <Pie
                        data={visualization.data}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {visualization.data.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#ec4899' : '#3b82f6'} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px', fontSize: '10px' }}
                      />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>

              {visualization.description && (
                <div className="mt-6 p-4 rounded-2xl bg-white/5 border border-white/5">
                  <p className="text-xs text-gray-400 leading-relaxed italic">
                    "{visualization.description}"
                  </p>
                </div>
              )}
            </motion.div>
          ) : showChat ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full bg-[#0b141a] border border-white/10 rounded-3xl p-0 flex flex-col overflow-hidden relative"
            >
              {/* WhatsApp Background Pattern */}
              <div className="absolute inset-0 chat-bg pointer-events-none" />
              
              <div className="p-3 border-b border-white/10 bg-[#202c33] flex items-center justify-between relative z-10">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-pink-500 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold">Kiara Chat</h4>
                    <p className="text-[8px] text-green-500">Online</p>
                  </div>
                </div>
                <button 
                  onClick={() => setMessages([])}
                  className="text-[10px] text-gray-400 hover:text-white transition-colors"
                >
                  Clear
                </button>
              </div>
              
              <div className="flex-1 min-h-[350px] max-h-[450px] overflow-y-auto p-4 flex flex-col gap-2 scrollbar-hide relative z-10">
                {messages.length > 0 ? (
                  messages.map((msg) => (
                    <div 
                      key={msg.id}
                      className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
                    >
                      <div className={`px-3 py-1.5 rounded-xl relative shadow-sm ${
                        msg.sender === 'user' 
                          ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' 
                          : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
                      }`}>
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        <div className="flex justify-end items-center gap-1 mt-0.5">
                          <span className="text-[9px] text-gray-400">
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {msg.sender === 'user' && (
                            <div className="flex -space-x-0.5">
                              <Zap className="w-2.5 h-2.5 text-blue-400" />
                              <Zap className="w-2.5 h-2.5 text-blue-400" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full opacity-30">
                    <MessageSquare className="w-12 h-12 mb-2 text-gray-400" />
                    <p className="text-[10px] uppercase tracking-widest text-gray-400">No messages yet, darling</p>
                  </div>
                )}
                <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
              </div>
              
              <div className="p-3 bg-[#202c33]/50 backdrop-blur-md relative z-10">
                <div className="relative flex items-end gap-2">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 bg-[#2a3942] border-none rounded-xl py-2.5 px-4 text-sm text-[#e9edef] placeholder:text-gray-500 focus:ring-0 transition-colors resize-none h-11 max-h-32 scrollbar-hide"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <button 
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim()}
                    className={`p-2.5 rounded-full transition-all ${
                      chatInput.trim() 
                        ? 'bg-[#00a884] text-white scale-100' 
                        : 'bg-gray-600 text-gray-400 scale-90 opacity-50'
                    }`}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="visualizer"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative flex items-center justify-center w-full aspect-square"
            >
              {/* Real AI Talking Avatar */}
              <div className="absolute inset-0 z-10 overflow-hidden rounded-full border-4 border-white/10 shadow-2xl">
                <TalkingAvatar isSpeaking={state === "speaking"} audioLevel={audioLevel} />
              </div>

              {/* Outer Rings */}
              <AnimatePresence>
                {isPowerOn && (
                  <>
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="absolute inset-0 border border-white/5 rounded-full"
                    />
                    <motion.div 
                      animate={{ 
                        scale: state === "speaking" ? [1, 1.1, 1] : 1,
                        rotate: 360 
                      }}
                      transition={{ 
                        scale: { duration: 1, repeat: Infinity },
                        rotate: { duration: 20, repeat: Infinity, ease: "linear" }
                      }}
                      className="absolute inset-4 border border-dashed border-white/10 rounded-full"
                    />
                  </>
                )}
              </AnimatePresence>

              {/* Core Button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={togglePower}
                className={`relative z-20 w-full h-full rounded-full flex flex-col items-center justify-center transition-all duration-500 ${
                  isPowerOn 
                    ? 'bg-transparent' 
                    : 'bg-black/60 backdrop-blur-sm border border-white/10'
                }`}
              >
                {!isPowerOn && (
                  <>
                    <Power className="w-16 h-16 text-white mb-4" />
                    <span className="text-sm font-bold tracking-widest uppercase">Power On</span>
                  </>
                )}
              </motion.button>


              {/* Waveform */}
              <AnimatePresence>
                {state === "speaking" && (
                  <div className="absolute bottom-[-40px] flex items-center gap-1 h-8">
                    {[...Array(8)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ height: [4, 24, 4] }}
                        transition={{ 
                          duration: 0.5, 
                          repeat: Infinity, 
                          delay: i * 0.05 
                        }}
                        className="w-1 bg-pink-500 rounded-full"
                      />
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer Info */}
      <div className="z-10 w-full max-w-xs flex flex-col gap-6">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isPowerOn ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span>System {isPowerOn ? 'Live' : 'Standby'}</span>
            {!isOnline && (
              <div className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20">
                <WifiOff className="w-2 h-2 text-red-400" />
                <span className="text-[8px] text-red-400 font-black">OFFLINE</span>
              </div>
            )}
            <button 
              onClick={async () => {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const mics = devices.filter(d => d.kind === 'audioinput');
                alert(`Detected Microphones: ${mics.length}\n${mics.map(m => m.label || 'Unnamed Mic').join('\n') || 'None detected'}`);
              }}
              className="ml-2 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[8px] border border-white/10"
            >
              Check Mic
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Globe className="w-3 h-3" />
            <span>Voice Only</span>
          </div>
        </div>

        <div className="text-center">
          <motion.p 
            key={state}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-lg font-medium ${getStatusColor()}`}
          >
            {getStatusText()}
          </motion.p>
          <p className="text-xs text-gray-600 mt-2 italic">
            {isPowerOn 
              ? "Don't keep me waiting, I'm expensive." 
              : "Tap the button to wake me up, darling."}
          </p>
        </div>

        <div className="flex justify-center gap-4">
          <div className="p-3 rounded-2xl bg-white/5 border border-white/5">
            <Heart className="w-5 h-5 text-pink-500/50" />
          </div>
          <div className="p-3 rounded-2xl bg-white/5 border border-white/5">
            <Zap className="w-5 h-5 text-blue-500/50" />
          </div>
        </div>
      </div>

      {/* Memory & Calendar Modal */}
      <AnimatePresence>
        {showMemory && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <div className="bg-[#0a0a0a] border border-white/10 w-full max-w-4xl max-h-[80vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-pink-500/20">
                    <Zap className="w-5 h-5 text-pink-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Intelligence Hub</h2>
                    <p className="text-xs text-gray-500">Structured Memories & Calendar Events</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowMemory(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Reminders / Calendar */}
                <section>
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Bell className="w-4 h-4" /> Upcoming Alerts
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {reminders.length === 0 ? (
                      <p className="text-sm text-gray-600 italic">No upcoming reminders.</p>
                    ) : (
                      reminders.map((r) => (
                        <div key={r.id} className="bg-white/5 border border-white/10 p-4 rounded-2xl flex items-start gap-4">
                          <div className={`mt-1 w-2 h-2 rounded-full ${r.status === 'pending' ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
                          <div className="flex-1">
                            <h4 className="text-sm font-bold">{r.title}</h4>
                            <p className="text-xs text-gray-400 mt-1">{r.description}</p>
                            <div className="flex items-center gap-2 mt-3 text-[10px] text-pink-500 font-mono">
                              <Settings className="w-3 h-3" />
                              {new Date(r.dueDate).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                {/* Structured Memories Knowledge Base */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <Database className="w-4 h-4" /> Intelligence Hub
                    </h3>
                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                      <input 
                        type="text"
                        placeholder="Search memories..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearchMemory(searchQuery)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-pink-500/50 transition-colors"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(searchResults || memories).length === 0 ? (
                      <p className="text-sm text-gray-600 italic">No memories found.</p>
                    ) : (
                      (searchResults || memories).map((m) => (
                        <div key={m.id} className="bg-white/5 border border-white/10 p-4 rounded-2xl hover:border-pink-500/30 transition-all group">
                          <div className="flex items-start justify-between mb-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest ${
                              m.type === 'idea' ? 'bg-yellow-500/20 text-yellow-400' :
                              m.type === 'task' ? 'bg-green-500/20 text-green-400' :
                              'bg-blue-500/20 text-blue-400'
                            }`}>
                              {m.type}
                            </span>
                            <button 
                              onClick={() => {
                                setPinnedMemories(prev => 
                                  prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id]
                                );
                              }}
                              className={`p-1 rounded-lg transition-colors ${pinnedMemories.includes(m.id) ? 'text-yellow-500 bg-yellow-500/10' : 'text-gray-600 hover:text-gray-400'}`}
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-xs text-gray-300 leading-relaxed">{m.content}</p>
                          {m.structuredData && Object.keys(m.structuredData).length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
                              {Object.entries(m.structuredData).map(([k, v]: [string, any]) => (
                                <div key={k} className="text-[10px]">
                                  <span className="text-gray-500 block uppercase tracking-tighter">{k}</span>
                                  <span className="text-gray-300 truncate block">{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
              
              <div className="p-6 bg-white/[0.02] border-t border-white/10 flex justify-between items-center">
                <button 
                  onClick={() => {
                    setIncomingCall({
                      phone: "+91 98765 43210",
                      transcript: "Hey, let's meet tomorrow at 5 PM to discuss the portfolio. Also, remind me to call the client on Monday morning."
                    });
                    setShowMemory(false);
                  }}
                  className="text-[10px] text-pink-500 hover:underline flex items-center gap-1"
                >
                  <Smartphone className="w-3 h-3" /> Simulate Incoming Call
                </button>
                <p className="text-[10px] text-gray-500">
                  KIARA - Personal Assistant Intelligent System v2.1
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
