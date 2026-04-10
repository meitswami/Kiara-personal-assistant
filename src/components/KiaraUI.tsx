/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Power, Globe, Zap, Heart, Sparkles, Shield, X, Send, MessageSquare, Coins, Settings, Bell, Smartphone, Volume2 } from 'lucide-react';
import { AudioStreamer } from '../lib/audio-streamer';
import { LiveSession, SessionState } from '../lib/live-session';
import { AIService } from '../services/ai-service';
import { auth, signInWithGoogle } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { RegistrationForm } from './RegistrationForm';
import { LoginForm } from './LoginForm';
import { AdminPanel } from './AdminPanel';
import { Avatar } from './Avatar';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { assistantCore } from '../lib/assistant-core';

export const KiaraUI: React.FC = () => {
  const [state, setState] = useState<SessionState>("disconnected");
  const [isPowerOn, setIsPowerOn] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'none'>('none');
  const [showAdmin, setShowAdmin] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [tokens, setTokens] = useState({ used: 1240, total: 50000 }); // Mock token data
  const [insights, setInsights] = useState<any[]>([]);
  const [showInsights, setShowInsights] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [settings, setSettings] = useState({
    wakeWord: false,
    mobileWake: false,
    hinglish: true
  });
  
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
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
        setAuthMode('none');
        
        // Initial ERP Sync
        assistantCore.syncWithERP();
      } else {
        setUserProfile(null);
      }
      setIsAuthReady(true);
    });

    audioStreamerRef.current = assistantCore.audioEngine;
    
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

    window.addEventListener("kiara-summarize", handleSummarize);
    window.addEventListener("kiara-create-tasks", handleCreateTasks);
    window.addEventListener("kiara-search-memory", handleSearchMemory);

    return () => {
      handleDisconnect();
      unsubscribe();
      window.removeEventListener("kiara-summarize", handleSummarize);
      window.removeEventListener("kiara-create-tasks", handleCreateTasks);
      window.removeEventListener("kiara-search-memory", handleSearchMemory);
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
    if (!apiKey) {
      alert("Gemini API Key is missing. Please check your environment variables.");
      return;
    }

    try {
      // Stop wake word recognition before starting full recording
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
          // Give the browser/OS a moment to release the microphone hardware
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          // Ignore if already stopped
        }
      }

      liveSessionRef.current = await assistantCore.initializeLiveSession(apiKey);
      await liveSessionRef.current.connect({
        onStateChange: (newState) => setState(newState),
        onAudioData: (base64) => {
          audioStreamerRef.current?.playAudioChunk(base64);
          // Simulate audio level for lip sync
          setAudioLevel(Math.random() * 0.5 + 0.5);
        },
        onInterrupted: () => {
          audioStreamerRef.current?.stopPlayback();
          setAudioLevel(0);
        },
        onTranscription: (text, isModel) => {
          if (!isModel) setLastTranscript(text);
          if (isModel) setAudioLevel(0.2); // Small movement for model turn
          
          // Update mock tokens on interaction
          if (userProfile?.role === 'admin') {
            setTokens(prev => ({ ...prev, used: prev.used + Math.floor(text.length / 4) }));
          }
        },
        onError: (err) => {
          console.error(err);
          setIsPowerOn(false);
        }
      });

      await audioStreamerRef.current?.startRecording((base64) => {
        liveSessionRef.current?.sendAudio(base64);
      });

      setIsPowerOn(true);
    } catch (error: any) {
      console.error("Failed to connect:", error);
      setIsPowerOn(false);
      alert(error.message || "Failed to connect to Kiara. Please check your microphone and internet connection.");
    }
  };

  const handleDisconnect = () => {
    audioStreamerRef.current?.stopRecording();
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
    liveSessionRef.current.sendText(chatInput);
    setChatInput("");
    if (userProfile?.role === 'admin') {
      setTokens(prev => ({ ...prev, used: prev.used + Math.floor(chatInput.length / 4) }));
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
          <h1 className="text-4xl font-bold tracking-tighter flex items-center justify-center gap-2">
            KIARA <Sparkles className="text-pink-500 w-6 h-6" />
          </h1>
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
              className="w-full bg-white/5 border border-white/10 rounded-3xl p-4 flex flex-col gap-4"
            >
              <div className="flex-1 min-h-[200px] max-h-[300px] overflow-y-auto p-2 text-sm text-gray-300">
                {lastTranscript && (
                  <div className="bg-white/5 p-3 rounded-2xl border border-white/5 mb-2">
                    {lastTranscript}
                  </div>
                )}
                <p className="text-[10px] uppercase tracking-widest text-gray-500 text-center mt-4">
                  Type your long message below
                </p>
              </div>
              <div className="relative">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Tell me everything, darling..."
                  className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-pink-500/50 transition-colors resize-none h-24"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <button 
                  onClick={handleSendMessage}
                  className="absolute right-3 bottom-3 p-2 bg-pink-500 rounded-xl hover:bg-pink-600 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
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
    </div>
  );
};
