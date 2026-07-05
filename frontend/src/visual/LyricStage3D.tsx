import { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 歌词 3D 舞台 shader 化（对标 MineRadio stageLyrics，index.html 8469-8944）
 *
 * Canvas 2D 把整行歌词渲成 alpha mask → Three.js PlaneGeometry + 自定义 ShaderMaterial
 * fragment shader 按 uProgress smoothstep 边界变色（已唱=高亮色，未唱=基色）+ 前沿 glow。
 *
 * 替代 DOM 逐字 span，视觉更"电影级"：文字本身是 3D 平面 + shader 扫光 + 发光前沿。
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uProgress;
  uniform float uFeather;
  uniform vec3 uBaseColor;
  uniform vec3 uHiColor;
  uniform vec3 uGlowColor;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float alpha = tex.a;
    if (alpha < 0.01) discard;
    float p = vUv.x;
    // smoothstep 平滑边界（对标 MineRadio makeLyricShaderMaterial）
    float filled = 1.0 - smoothstep(uProgress, uProgress + uFeather, p);
    vec3 col = mix(uBaseColor, uHiColor, filled * 0.88);
    // 前沿 glow（已唱/未唱交界处发光）
    float edge = smoothstep(uProgress - uFeather, uProgress, p)
               * (1.0 - smoothstep(uProgress, uProgress + uFeather * 2.0, p));
    col += uGlowColor * edge * 0.6;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** 把歌词文字渲成 alpha mask CanvasTexture（对标 MineRadio makeLyricMask） */
function makeLyricMask(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048; canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 2048, 256);
  // 文字：白色 + 透明背景（alpha mask）
  ctx.fillStyle = "#fff";
  ctx.font = "bold 120px 'Cormorant Garamond', 'Noto Sans SC', serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // 长文字自适应缩放
  let textToDraw = text;
  let scale = 1;
  const maxW = 1900;
  while (ctx.measureText(textToDraw).width > maxW && scale > 0.4) {
    scale -= 0.05;
    ctx.font = `bold ${Math.round(120 * scale)}px 'Cormorant Garamond', 'Noto Sans SC', serif`;
  }
  ctx.fillText(textToDraw, 1024, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function LyricPlane({ text, progress }: { text: string; progress: number }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => makeLyricMask(text), [text]);

  const uniforms = useMemo(
    () => ({
      uMap: { value: tex },
      uProgress: { value: 0 },
      uFeather: { value: 0.03 },
      uBaseColor: { value: new THREE.Color("#ffffff") },
      uHiColor: { value: new THREE.Color("#f4d28a") },     // 已唱：香槟金
      uGlowColor: { value: new THREE.Color("#00f5d4") },   // 前沿：薄荷绿 glow
    }),
    [tex]
  );

  // text 变化时更新 texture
  useEffect(() => {
    if (matRef.current) {
      matRef.current.uniforms.uMap.value = tex;
    }
  }, [tex]);

  useFrame((state) => {
    if (matRef.current) {
      matRef.current.uniforms.uProgress.value = progress;
    }
    // 轻微浮动 + 朝向相机
    if (meshRef.current) {
      meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.08;
      meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.3) * 0.01;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <planeGeometry args={[16, 2, 1, 1]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

interface LyricStage3DProps {
  text: string;
  progress: number;
}

/** 歌词 3D 舞台（FullPlayer cinema 模式用，叠加在粒子背景之上） */
export function LyricStage3D({ text, progress }: LyricStage3DProps) {
  if (!text) return null;
  return (
    <div className="lyric-stage-3d">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 1.8]}
      >
        <LyricPlane text={text} progress={progress} />
      </Canvas>
    </div>
  );
}
