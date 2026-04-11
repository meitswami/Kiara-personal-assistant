/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, MeshDistortMaterial, Float, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

interface AvatarProps {
  isSpeaking: boolean;
  audioLevel?: number;
}

const KiaraHead: React.FC<AvatarProps> = ({ isSpeaking, audioLevel = 0 }) => {
  const groupRef = useRef<THREE.Group>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftEyeRef = useRef<THREE.Group>(null);
  const rightEyeRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;
    
    const time = state.clock.getElapsedTime();
    
    // Gentle floating and rotation
    groupRef.current.position.y = Math.sin(time * 0.5) * 0.1;
    groupRef.current.rotation.y = Math.sin(time * 0.2) * 0.1;
    groupRef.current.rotation.x = Math.cos(time * 0.3) * 0.05;
    
    // Lip sync animation
    if (mouthRef.current) {
      // Scale mouth based on audio level
      const targetScaleY = isSpeaking ? 0.1 + audioLevel * 1.5 : 0.1;
      const targetScaleX = isSpeaking ? 1 + audioLevel * 0.5 : 1;
      mouthRef.current.scale.y = THREE.MathUtils.lerp(mouthRef.current.scale.y, targetScaleY, 0.3);
      mouthRef.current.scale.x = THREE.MathUtils.lerp(mouthRef.current.scale.x, targetScaleX, 0.3);
    }

    // Eye blinking and following
    if (leftEyeRef.current && rightEyeRef.current) {
      const blink = Math.sin(time * 4) > 0.98 ? 0.1 : 1;
      leftEyeRef.current.scale.y = THREE.MathUtils.lerp(leftEyeRef.current.scale.y, blink, 0.5);
      rightEyeRef.current.scale.y = THREE.MathUtils.lerp(rightEyeRef.current.scale.y, blink, 0.5);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Main Head - Stylized Egg Shape */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial 
          color="#1e1b4b" 
          emissive="#ec4899" 
          emissiveIntensity={isSpeaking ? 0.5 + audioLevel : 0.2}
          roughness={0.1}
          metalness={0.8}
        />
      </mesh>

      {/* Face Plate */}
      <mesh position={[0, 0, 0.1]} scale={[0.9, 1, 0.9]}>
        <sphereGeometry args={[0.95, 64, 64]} />
        <meshStandardMaterial 
          color="#0f172a" 
          roughness={0.2}
          metalness={0.9}
        />
      </mesh>

      {/* Eyes */}
      <group position={[-0.35, 0.2, 0.85]} ref={leftEyeRef}>
        <mesh>
          <sphereGeometry args={[0.12, 32, 32]} />
          <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={2} />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshStandardMaterial color="white" />
        </mesh>
      </group>

      <group position={[0.35, 0.2, 0.85]} ref={rightEyeRef}>
        <mesh>
          <sphereGeometry args={[0.12, 32, 32]} />
          <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={2} />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshStandardMaterial color="white" />
        </mesh>
      </group>

      {/* Mouth - Dynamic Lipsync */}
      <mesh ref={mouthRef} position={[0, -0.35, 0.9]} rotation={[0, 0, 0]}>
        <capsuleGeometry args={[0.15, 0.05, 4, 16]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={1} />
      </mesh>

      {/* "Hair" / Tech Accents */}
      <mesh position={[0, 0.8, -0.2]} rotation={[0.2, 0, 0]}>
        <torusGeometry args={[0.6, 0.05, 16, 100]} />
        <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
};

export const Avatar: React.FC<AvatarProps> = (props) => {
  return (
    <div className="w-full h-full min-h-[300px]">
      <Canvas shadows dpr={[1, 2]}>
        <PerspectiveCamera makeDefault position={[0, 0, 5]} />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <spotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} />
        
        <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
          <KiaraHead {...props} />
        </Float>
      </Canvas>
    </div>
  );
};
