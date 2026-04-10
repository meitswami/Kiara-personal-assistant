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
  const meshRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    
    const time = state.clock.getElapsedTime();
    
    // Gentle floating motion
    meshRef.current.position.y = Math.sin(time * 0.5) * 0.1;
    
    // Lip sync animation
    if (mouthRef.current) {
      const targetScale = isSpeaking ? 1 + audioLevel * 2 : 1;
      mouthRef.current.scale.y = THREE.MathUtils.lerp(mouthRef.current.scale.y, targetScale, 0.2);
    }
  });

  return (
    <group>
      {/* Main Head */}
      <Sphere ref={meshRef} args={[1, 64, 64]}>
        <MeshDistortMaterial
          color="#ec4899"
          speed={isSpeaking ? 3 : 1}
          distort={isSpeaking ? 0.4 : 0.2}
          radius={1}
        />
      </Sphere>

      {/* Eyes */}
      <group position={[0, 0.2, 0.8]}>
        <Sphere args={[0.1, 16, 16]} position={[-0.3, 0, 0]}>
          <meshStandardMaterial color="white" />
        </Sphere>
        <Sphere args={[0.1, 16, 16]} position={[0.3, 0, 0]}>
          <meshStandardMaterial color="white" />
        </Sphere>
      </group>

      {/* Mouth */}
      <mesh ref={mouthRef} position={[0, -0.4, 0.9]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.05, 32]} />
        <meshStandardMaterial color="#831843" />
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
