import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { readSpectrum } from "../stores/spectrumBus";

/**
 * 粒子流动背景 —— 随音频频谱律动。
 */
function ParticleField() {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const count = 2000;

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 8 + Math.random() * 12;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, []);

  useFrame((state) => {
    if (pointsRef.current) {
      const t = state.clock.elapsedTime;
      pointsRef.current.rotation.y = t * 0.05;
      pointsRef.current.rotation.x = Math.sin(t * 0.1) * 0.1;
    }
    // 频谱驱动：取低频能量放大粒子
    const spectrum = readSpectrum();
    const bass = (spectrum[0] || 0) / 255;
    if (matRef.current) {
      const base = 0.05;
      matRef.current.size = base + bass * 0.15;
      matRef.current.opacity = 0.4 + bass * 0.5;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.05}
        color="#ff6b1a"
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** 漂浮的橙色光晕，随低频脉动 */
function GlowOrbs() {
  const orbA = useRef<THREE.Mesh>(null);
  const orbB = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const spectrum = readSpectrum();
    const bass = (spectrum[0] || 0) / 255;
    const mid = (spectrum[8] || 0) / 255;
    if (orbA.current) {
      const s = 3 + bass * 1.5;
      orbA.current.scale.setScalar(s);
      orbA.current.rotation.z = state.clock.elapsedTime * 0.03;
    }
    if (orbB.current) {
      const s = 4 + mid * 1.2;
      orbB.current.scale.setScalar(s);
    }
  });

  return (
    <group>
      <mesh ref={orbA} position={[-6, 2, -8]}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#ff6b1a" transparent opacity={0.08} />
      </mesh>
      <mesh ref={orbB} position={[7, -3, -10]}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#ff8c42" transparent opacity={0.06} />
      </mesh>
    </group>
  );
}

export function VisualBackground() {
  return (
    <div className="visual-bg">
      <Canvas
        camera={{ position: [0, 0, 15], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.5} />
        <ParticleField />
        <GlowOrbs />
      </Canvas>
    </div>
  );
}
