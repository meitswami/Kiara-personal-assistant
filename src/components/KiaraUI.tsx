/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Power, Globe, Zap, Heart, Sparkles, Shield, X, Send, MessageSquare, Coins, Settings, Bell, Smartphone, Volume2, ChevronDown } from 'lucide-react';
import { AudioStreamer } from '../lib/audio-streamer';
import { VideoStreamer } from '../lib/video-streamer';
import { LiveSession, SessionState } from '../lib/live-session';
import { AIService } from '../services/ai-service';
import { auth, signInWithGoogle } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { RegistrationForm } from './RegistrationForm';
import { LoginForm } from './LoginForm';
import { AdminPanel } from './AdminPanel';
import { Avatar } from './Avatar';
import { collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { assistantCore } from '../lib/assistant-core';

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
  const [memories, setMemories] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [tokens, setTokens] = useState({ used: 1240, total: 50000 }); // Mock token data
  const [insights, setInsights] = useState<any[]>([]);
  const [showInsights, setShowInsights] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isVisionOn, setIsVisionOn] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [settings, setSettings] = useState({
    wakeWord: false,
    mobileWake: false,
    hinglish: true
  });
  
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const videoStreamerRef = useRef<VideoStreamer | null>(null);
  const liveSessionRef = useRef<LiveSession | null>(null);
  const recognitionRef = useRef<any>(null);

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

    const handleSearchMemory = async (e: any) => {
      const { query } = e.detail;
      try {
        const results = await AIService.searchMemory(query);
        console.log("Memory search results:", results);
      } catch (err) {
        console.error("Memory search failed:", err);
      }
    };

    const handleMemorize = async (e: any) => {
      const { text } = e.detail;
      addLog("Kiara is memorizing this for you...");
      try {
        await AIService.memorizeStructured(text);
        addLog("Memory stored successfully in JSON and Database.");
      } catch (err) {
        console.error("Memorization failed:", err);
        addLog("Failed to memorize. Please try again.");
      }
    };

    window.addEventListener("kiara-summarize", handleSummarize);
    window.addEventListener("kiara-create-tasks", handleCreateTasks);
    window.addEventListener("kiara-search-memory", handleSearchMemory);
    window.addEventListener("kiara-memorize", handleMemorize);

    return () => {
      handleDisconnect();
      unsubscribe();
      window.removeEventListener("kiara-summarize", handleSummarize);
      window.removeEventListener("kiara-create-tasks", handleCreateTasks);
      window.removeEventListener("kiara-search-memory", handleSearchMemory);
      window.removeEventListener("kiara-memorize", handleMemorize);
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
          
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            const sender = isModel ? 'kiara' : 'user';
            
            // If the last message is from the same sender and was within the last 2 seconds, update it
            // This handles the streaming nature of transcriptions
            if (lastMsg && lastMsg.sender === sender && (new Date().getTime() - lastMsg.timestamp.getTime() < 2000)) {
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
          alert(`Kiara Connection Error: ${errMsg}`);
        }
      }, {
        gender: userProfile?.gender,
        personality: userProfile?.aiPersonality,
        userName: userProfile?.firstName
      });

      addLog("Starting Microphone...");
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' as any });
        addLog(`Mic Permission: ${permissionStatus.state}`);
      } catch (e) {
        addLog("Permission check skipped (not supported)");
      }
      
      await audioStreamerRef.current?.startRecording((base64) => {
        if (liveSessionRef.current) {
          liveSessionRef.current.sendAudio(base64);
        }
      });

      if (isVisionOn) {
        addLog("Starting Vision...");
        await videoStreamerRef.current?.start((base64) => {
          if (liveSessionRef.current) {
            liveSessionRef.current.sendVideo(base64);
          }
        });
      }

      // Final check if we are still connected before going live
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (stateRef.current === "disconnected") {
        throw new Error("Connection lost during initialization");
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

  const handleDisconnect = () => {
    audioStreamerRef.current?.stopRecording();
    videoStreamerRef.current?.stop();
    audioStreamerRef.current?.stopPlayback();
    liveSessionRef.current?.disconnect();
    setIsPowerOn(false);
    setState("disconnected");
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
      {/* Debug Overlay */}
      {debugLogs.length > 0 && (
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
                          await updateDoc(doc(db, 'users', user.uid), { aiPersonality: p });
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
          {showChat ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full bg-[#0b141a] border border-white/10 rounded-3xl p-0 flex flex-col overflow-hidden relative"
            >
              {/* WhatsApp Background Pattern */}
              <div className="absolute inset-0 chat-bg pointer-events-none" />
              
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
              {/* 3D Avatar */}
              <div className="absolute inset-0 z-10">
                <Avatar isSpeaking={state === "speaking"} audioLevel={audioLevel} />
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
                className={`relative z-20 w-48 h-48 rounded-full flex flex-col items-center justify-center transition-all duration-500 ${
                  isPowerOn 
                    ? 'bg-white/5 shadow-[0_0_50px_rgba(255,255,255,0.1)] border border-white/20' 
                    : 'bg-white/10 border border-white/10'
                }`}
              >
                <div className={`absolute inset-0 rounded-full transition-opacity duration-500 ${
                  isPowerOn ? 'opacity-100' : 'opacity-0'
                }`}>
                  <div className={`absolute inset-0 rounded-full blur-2xl opacity-20 ${
                    state === "speaking" ? 'bg-pink-500' : 'bg-blue-500'
                  }`} />
                </div>

                {isPowerOn ? (
                  state === "speaking" ? (
                    <motion.div 
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                    >
                      <Zap className="w-12 h-12 text-pink-500" />
                    </motion.div>
                  ) : (
                    <Mic className={`w-12 h-12 ${state === "listening" ? 'text-blue-400' : 'text-white'}`} />
                  )
                ) : (
                  <Power className="w-12 h-12 text-gray-400" />
                )}
                
                <span className="mt-4 text-[10px] uppercase tracking-widest font-bold">
                  {isPowerOn ? (state === "disconnected" ? "Connecting" : "Active") : "Power On"}
                </span>
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
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Heart className="w-4 h-4" /> Knowledge Base
                  </h3>
                  <div className="overflow-x-auto rounded-2xl border border-white/10">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/5 text-gray-400 text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3 font-medium">Type</th>
                          <th className="px-4 py-3 font-medium">Content</th>
                          <th className="px-4 py-3 font-medium">Structured Data</th>
                          <th className="px-4 py-3 font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {memories.map((m) => (
                          <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-4">
                              <span className="px-2 py-1 rounded-md bg-pink-500/10 text-pink-500 text-[10px] font-bold uppercase">
                                {m.type}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-gray-300 max-w-xs truncate">
                              {m.content}
                            </td>
                            <td className="px-4 py-4">
                              <pre className="text-[10px] font-mono text-blue-400 bg-black/40 p-2 rounded-lg max-h-24 overflow-y-auto">
                                {JSON.stringify(m.structuredData, null, 2)}
                              </pre>
                            </td>
                            <td className="px-4 py-4 text-[10px] text-gray-500 font-mono">
                              {m.createdAt?.toDate ? m.createdAt.toDate().toLocaleDateString() : 'Recent'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
