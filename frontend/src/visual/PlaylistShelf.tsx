import { useRef, useMemo, useState, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";

/**
 * 3D 歌单架（对标 MineRadio makeShelfManager，index.html 12964-13210）
 *
 * Three.js Group + PlaneGeometry mesh + CanvasTexture（canvas 2D 绘制歌单卡片）。
 * 右键唤起，PSP 式弧形横滚（centerIdx），滚轮/←→ 切换，点击打开歌单。
 *
 * MVP：~250 行，弧形排列 6-8 张卡片，CanvasTexture 绘制封面占位 + 名字 + 曲目数。
 */

interface ShelfCard {
  id: string;
  name: string;
  sub: string;
  cover?: string | null;
  onClick: () => void;
}

/** 把一张卡片绘制成 CanvasTexture（720×360，对标 MineRadio） */
function makeCardTexture(card: ShelfCard): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 720; canvas.height = 360;
  const ctx = canvas.getContext("2d")!;
  // 渐变背景（橙色品牌 + 冷色辅助）
  const grad = ctx.createLinearGradient(0, 0, 720, 360);
  grad.addColorStop(0, "#1a1018");
  grad.addColorStop(1, "#0a0a14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 720, 360);
  // 封面占位（左侧黑胶圆盘）
  ctx.fillStyle = "#2a1a0a";
  ctx.beginPath(); ctx.arc(120, 180, 90, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255, 107, 26, 0.4)";
  ctx.lineWidth = 2;
  for (let r = 30; r < 90; r += 8) { ctx.beginPath(); ctx.arc(120, 180, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = "#ff6b1a";
  ctx.beginPath(); ctx.arc(120, 180, 12, 0, Math.PI * 2); ctx.fill();
  // 标题
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px 'Noto Sans SC', sans-serif";
  ctx.textBaseline = "middle";
  const title = card.name.length > 12 ? card.name.slice(0, 12) + "…" : card.name;
  ctx.fillText(title, 240, 150);
  // 副标题
  ctx.fillStyle = "#aaa7b8";
  ctx.font = "20px 'Noto Sans SC', sans-serif";
  ctx.fillText(card.sub, 240, 200);
  // 底部细线
  ctx.fillStyle = "#ff6b1a";
  ctx.fillRect(240, 260, 60, 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function CardMesh({ card, index, centerIdx, count, onSelect }: {
  card: ShelfCard; index: number; centerIdx: number; count: number; onSelect: (i: number) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => makeCardTexture(card), [card]);
  // 弧形排列：相对 centerIdx 的偏移 → 弧形位置
  const offset = index - centerIdx;
  useFrame(() => {
    if (!meshRef.current) return;
    // 平滑插值到目标位置（间距 5.5 > 卡片宽 4.2，侧卡片完全露出 + 留白，PSP 风格）
    const targetX = offset * 5.5;
    const targetZ = -Math.abs(offset) * 2.8; // 远离时后退更多（增强纵深）
    const targetRotY = -offset * 0.5; // 朝向中心（更明显弧形）
    meshRef.current.position.x += (targetX - meshRef.current.position.x) * 0.12;
    meshRef.current.position.z += (targetZ - meshRef.current.position.z) * 0.12;
    meshRef.current.rotation.y += (targetRotY - meshRef.current.rotation.y) * 0.12;
    // 中心卡片放大，侧卡片缩小更明显（突出焦点）
    const targetScale = offset === 0 ? 1.15 : 0.78;
    meshRef.current.scale.x += (targetScale - meshRef.current.scale.x) * 0.12;
    meshRef.current.scale.y += (targetScale - meshRef.current.scale.y) * 0.12;
  });
  return (
    <mesh
      ref={meshRef}
      onClick={(e) => { e.stopPropagation(); if (offset === 0) onSelect(index); }}
    >
      <planeGeometry args={[4.2, 2.1]} />
      <meshBasicMaterial map={tex} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

function ShelfScene({ cards, centerIdx, setCenterIdx, onSelect }: {
  cards: ShelfCard[]; centerIdx: number; setCenterIdx: (i: number) => void; onSelect: (i: number) => void;
}) {
  const { camera } = useThree();
  useFrame((state) => {
    camera.position.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.3;
    camera.lookAt(0, 0, 0);
  });
  // 键盘 ←→ 切换
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setCenterIdx(Math.max(0, centerIdx - 1));
      if (e.key === "ArrowRight") setCenterIdx(Math.min(cards.length - 1, centerIdx + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [centerIdx, cards.length, setCenterIdx]);
  return (
    <group>
      {cards.map((c, i) => (
        <CardMesh key={c.id} card={c} index={i} centerIdx={centerIdx} count={cards.length} onSelect={onSelect} />
      ))}
    </group>
  );
}

export function PlaylistShelf({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<ShelfCard[]>([]);
  const [centerIdx, setCenterIdx] = useState(0);
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const setSubView = usePlayerStore((s) => s.setSubView);

  useEffect(() => {
    // 数据源：用户歌单 + 收藏 + 本地曲库
    const fixed: ShelfCard[] = [
      { id: "liked", name: "我喜欢的音乐", sub: `${libraryTracks.filter((t) => t.liked).length} 首`, onClick: () => { setSubView("library"); onClose(); } },
      { id: "library", name: "本地音乐库", sub: `${libraryTracks.length} 首`, onClick: () => { setSubView("library"); onClose(); } },
    ];
    invoke<{ id: string; name: string; track_count: number }[]>("all_playlists")
      .then((pls) => {
        const userCards: ShelfCard[] = pls.map((p) => ({
          id: p.id,
          name: p.name,
          sub: `${p.track_count} 首`,
          onClick: () => { usePlayerStore.setState({ currentPlaylistId: p.id }); setSubView("user_playlist"); onClose(); },
        }));
        setCards([...fixed, ...userCards]);
      })
      .catch(() => setCards(fixed));
  }, [libraryTracks, setSubView, onClose]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onSelect = (i: number) => { cards[i]?.onClick(); };

  return (
    <div className="shelf-overlay" onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="shelf-hint">滚轮 / ←→ 切换 · 点击打开 · 右键/ESC 关闭</div>
      <Canvas
        camera={{ position: [0, 0, 11], fov: 55 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 1.6]}
        onWheel={(e) => setCenterIdx(Math.max(0, Math.min(cards.length - 1, centerIdx + (e.deltaY > 0 ? 1 : -1))))}
      >
        <ShelfScene cards={cards} centerIdx={centerIdx} setCenterIdx={setCenterIdx} onSelect={onSelect} />
      </Canvas>
    </div>
  );
}
