/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, useAnimation } from 'motion/react';

interface TalkingAvatarProps {
  isSpeaking: boolean;
  audioLevel?: number;
  imageUrl?: string;
}

export const TalkingAvatar: React.FC<TalkingAvatarProps> = ({ 
  isSpeaking, 
  audioLevel = 0,
  imageUrl = "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=1000&auto=format&fit=crop" // Professional woman avatar
}) => {
  const mouthControls = useAnimation();
  const headControls = useAnimation();
  const eyesControls = useAnimation();
  
  // Smooth the audio level for more natural movement
  const [smoothedLevel, setSmoothedLevel] = useState(0);
  
  useEffect(() => {
    if (isSpeaking) {
      setSmoothedLevel(prev => prev * 0.7 + audioLevel * 0.3);
    } else {
      setSmoothedLevel(prev => prev * 0.8);
    }
  }, [audioLevel, isSpeaking]);

  useEffect(() => {
    if (isSpeaking) {
      mouthControls.start({
        scaleY: 1 + smoothedLevel * 1.5,
        scaleX: 1 + smoothedLevel * 0.2,
        transition: { type: 'spring', stiffness: 300, damping: 20 }
      });
      
      headControls.start({
        y: smoothedLevel * -5,
        rotateX: smoothedLevel * 2,
        transition: { duration: 0.1 }
      });
    } else {
      mouthControls.start({ scaleY: 1, scaleX: 1 });
      headControls.start({ y: 0, rotateX: 0 });
    }
  }, [smoothedLevel, isSpeaking, mouthControls, headControls]);

  // Random blinking
  useEffect(() => {
    const blink = async () => {
      await eyesControls.start({ scaleY: 0.1, transition: { duration: 0.1 } });
      await eyesControls.start({ scaleY: 1, transition: { duration: 0.1 } });
      
      const nextBlink = Math.random() * 4000 + 2000;
      setTimeout(blink, nextBlink);
    };
    
    const timer = setTimeout(blink, 3000);
    return () => clearTimeout(timer);
  }, [eyesControls]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-3xl bg-black/20 backdrop-blur-sm border border-white/10 shadow-2xl">
      {/* Background Glow */}
      <div className={`absolute inset-0 transition-opacity duration-1000 ${isSpeaking ? 'opacity-30' : 'opacity-10'}`}>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-blue-500/20 animate-spin-slow blur-3xl" />
      </div>

      <motion.div 
        animate={headControls}
        className="relative w-full h-full flex items-center justify-center"
      >
        {/* Main Avatar Image */}
        <img 
          src={imageUrl} 
          alt="Kiara" 
          className="w-full h-full object-cover object-center"
          referrerPolicy="no-referrer"
        />

        {/* Animated Mouth Overlay */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <motion.div 
            animate={mouthControls}
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              // Clip to mouth area (approximate for the provided image)
              clipPath: 'ellipse(8% 4% at 50% 58%)',
              // Add a slight shadow to make the mouth opening look deeper
              filter: `brightness(${1 - smoothedLevel * 0.5}) contrast(${1 + smoothedLevel * 0.2})`,
            }}
          />
        </div>

        {/* Animated Eyes (Blinking) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {/* Left Eye */}
          <motion.div 
            animate={eyesControls}
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              clipPath: 'ellipse(3% 2% at 43% 38%)',
              backgroundColor: '#1a1a1a', // Dark color for closed eye
              backgroundBlendMode: 'multiply'
            }}
          />
          {/* Right Eye */}
          <motion.div 
            animate={eyesControls}
            style={{
              width: '100%',
              height: '100%',
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              clipPath: 'ellipse(3% 2% at 57% 38%)',
              backgroundColor: '#1a1a1a',
              backgroundBlendMode: 'multiply'
            }}
          />
        </div>
      </motion.div>

      {/* Status Overlay */}
      <div className="absolute bottom-6 left-6 flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
        <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-pink-500 animate-pulse' : 'bg-green-500'}`} />
        <span className="text-xs font-medium tracking-wider uppercase opacity-80">
          {isSpeaking ? 'Kiara Speaking' : 'Kiara Active'}
        </span>
      </div>
    </div>
  );
};
