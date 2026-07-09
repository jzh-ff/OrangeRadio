import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { usePlayerStore } from "../stores/playerStore";
import { useLibraryStore } from "../stores/libraryStore";
import "../styles/library.css";

/**
 * 3D 歌单架（对标 MineRadio makeShelfManager，index.html 12964-13210）
 *
 * 增强版（v2）：
 *   1. 真实封面贴图：makeCardTexture 支持 cover URL，drawImage 绘到左侧（替换黑胶占位）；加载失败回退
 *   2. 可交互相机：抄 BeatParticles 的 orbit ref 模式，鼠标拖拽旋转 + 滚轮缩放
 *   3. hover 高亮：onPointerOver/Out 驱动 scale + 光标
 *   4. 打开/关闭动画：closing 态 + CSS keyframes（global.css）
 *
 * 右键唤起，PSP 式弧形横滚（centerIdx），滚轮/←→ 切换，点击打开歌单。
 */

interface ShelfCard {
  id: string;
  name: string;
  sub: string;
  cover?: string | null;
  onClick: () => void;
}

/** 异步加载封面图片 → THREE.Texture（失败回退 null） */
function loadCoverTexture(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        resolve(tex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 把一张卡片绘制成 CanvasTexture（720×360，含封面/黑胶占位） */
function makeCardTexture(card: ShelfCard, coverTex?: THREE.Texture | null): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 720; canvas.height = 360;
  const ctx = canvas.getContext("2d")!;
  // 渐变背景
  const grad = ctx.createLinearGradient(0, 0, 720, 360);
  grad.addColorStop(0, "#1a1018");
  grad.addColorStop(1, "#0a0a14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 720, 360);
  // 左侧封面区（180×180 居中于 y=180）
  if (coverTex?.image) {
    try {
      ctx.save();
      ctx.beginPath();
      ctx.arc(120, 180, 90, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(coverTex.image as HTMLImageElement, 30, 90, 180, 180);
      ctx.restore();
    } catch {
      drawVinylPlaceholder(ctx);
    }
  } else {
    drawVinylPlaceholder(ctx);
  }
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

/** 黑胶圆盘占位（无封面时） */
function drawVinylPlaceholder(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#2a1a0a";
  ctx.beginPath(); ctx.arc(120, 180, 90, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255, 107, 26, 0.4)";
  ctx.lineWidth = 2;
  for (let r = 30; r < 90; r += 8) { ctx.beginPath(); ctx.arc(120, 180, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = "#ff6b1a";
  ctx.beginPath(); ctx.arc(120, 180, 12, 0, Math.PI * 2); ctx.fill();
}

function CardMesh({ card, index, centerIdx, onSelect }: {
  card: ShelfCard; index: number; centerIdx: number; onSelect: (i: number) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [coverTex, setCoverTex] = useState<THREE.Texture | null>(null);
  const [hovered, setHovered] = useState(false);
  // 占位贴图（立即可用，封面加载后重建）
  const placeholderTex = useMemo(() => makeCardTexture(card, null), [card]);
  const tex = useMemo(() => makeCardTexture(card, coverTex), [card, coverTex]);

  // 显存清理：CanvasTexture 在 memo 重建 / 组件卸载时必须 dispose，
  // 否则每张卡片切换封面都会泄漏一个 canvas 纹理（GPU 显存累积）。
  useEffect(() => () => { placeholderTex.dispose(); }, [placeholderTex]);
  useEffect(() => () => { tex.dispose(); }, [tex]);
  // loadCoverTexture 加载的真实封面贴图存进 coverTex state，卸载时也要释放
  useEffect(() => () => { if (coverTex) coverTex.dispose(); }, [coverTex]);

  // 异步加载真实封面
  useEffect(() => {
    if (!card.cover) return;
    let active = true;
    loadCoverTexture(card.cover).then((t) => { if (active) setCoverTex(t); });
    return () => { active = false; };
  }, [card.cover]);

  const offset = index - centerIdx;
  useFrame(() => {
    if (!meshRef.current) return;
    const targetX = offset * 5.5;
    const targetZ = -Math.abs(offset) * 2.8;
    const targetRotY = -offset * 0.5;
    meshRef.current.position.x += (targetX - meshRef.current.position.x) * 0.12;
    meshRef.current.position.z += (targetZ - meshRef.current.position.z) * 0.12;
    meshRef.current.rotation.y += (targetRotY - meshRef.current.rotation.y) * 0.12;
    // 中心卡片放大，hover 再加 0.08
    const baseScale = offset === 0 ? 1.15 : 0.78;
    const targetScale = baseScale + (hovered ? 0.08 : 0);
    meshRef.current.scale.x += (targetScale - meshRef.current.scale.x) * 0.15;
    meshRef.current.scale.y += (targetScale - meshRef.current.scale.y) * 0.15;
  });

  // hover 光标
  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "default";
    return () => { document.body.style.cursor = "default"; };
  }, [hovered]);

  return (
    <mesh
      ref={meshRef}
      onClick={(e) => { e.stopPropagation(); if (offset === 0) onSelect(index); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <planeGeometry args={[4.2, 2.1]} />
      <meshBasicMaterial map={coverTex ? tex : placeholderTex} transparent side={THREE.DoubleSide} />
    </mesh>
  );
}

/** DIY 运镜：用户拖拽旋转 + 滚轮缩放（抄 BeatParticles orbit ref 模式） */
const orbit = {
  userTheta: 0,    // 方位角偏移（左右拖拽）
  userPhi: 0,      // 俯仰角偏移（上下拖拽）
  userRadius: 0,   // 缩放偏移（滚轮）
  dragging: false,
  lastX: 0,
  lastY: 0,
};

function ShelfScene({ cards, centerIdx, setCenterIdx, onSelect }: {
  cards: ShelfCard[]; centerIdx: number; setCenterIdx: (i: number) => void; onSelect: (i: number) => void;
}) {
  const { camera, gl } = useThree();
  useFrame(() => {
    // 基础位置 + 用户拖拽偏移（球坐标）
    const r = 11 + orbit.userRadius;
    const theta = orbit.userTheta;
    const phi = orbit.userPhi;
    camera.position.x = r * Math.sin(phi) * Math.sin(theta);
    camera.position.y = r * Math.cos(phi);
    camera.position.z = r * Math.sin(phi) * Math.cos(theta);
    camera.lookAt(0, 0, 0);
  });

  // 绑定拖拽 + 缩放事件到 canvas DOM
  useEffect(() => {
    const dom = gl.domElement;
    const onDown = (e: PointerEvent) => {
      orbit.dragging = true;
      orbit.lastX = e.clientX;
      orbit.lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!orbit.dragging) return;
      const dx = e.clientX - orbit.lastX;
      const dy = e.clientY - orbit.lastY;
      orbit.userTheta -= dx * 0.005;
      orbit.userPhi = Math.max(-0.6, Math.min(0.6, orbit.userPhi + dy * 0.005)); // 限幅避免翻转
      orbit.lastX = e.clientX;
      orbit.lastY = e.clientY;
    };
    const onUp = () => { orbit.dragging = false; };
    // 滚轮缩放（与切换 centerIdx 区分：Shift+滚轮缩放，普通滚轮切换）
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        orbit.userRadius = Math.max(-6, Math.min(4, orbit.userRadius + (e.deltaY > 0 ? 0.5 : -0.5)));
      } else {
        setCenterIdx(Math.max(0, Math.min(cards.length - 1, centerIdx + (e.deltaY > 0 ? 1 : -1))));
      }
    };
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
    };
  }, [gl, centerIdx, cards.length, setCenterIdx]);

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
        <CardMesh key={c.id} card={c} index={i} centerIdx={centerIdx} onSelect={onSelect} />
      ))}
    </group>
  );
}

export function PlaylistShelf({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<ShelfCard[]>([]);
  const [centerIdx, setCenterIdx] = useState(0);
  const [closing, setClosing] = useState(false);
  const libraryTracks = useLibraryStore((s) => s.tracks);
  const setSubView = usePlayerStore((s) => s.setSubView);

  useEffect(() => {
    // 数据源：用户歌单 + 收藏 + 本地曲库
    // liked/library 卡片用本地库首张网络封面（本地文件封面在 3D Canvas 受 CORS 限制，保持黑胶占位）
    const firstUrlCover = libraryTracks.find(
      (t) => t.meta.artwork?.source?.kind === "url"
    )?.meta.artwork?.source;
    const coverUrl = firstUrlCover?.kind === "url" ? firstUrlCover.url : null;
    const likedTracks = libraryTracks.filter((t) => t.liked);
    const localTracks = libraryTracks.filter((t) => (t.source_kind ?? "local") === "local");
    const fixed: ShelfCard[] = [
      { id: "liked", name: "我的收藏", sub: `${likedTracks.length} 首`, cover: coverUrl, onClick: () => { setSubView("library"); close(); } },
      { id: "library", name: "本地音乐库", sub: `${localTracks.length} 首`, cover: coverUrl, onClick: () => { setSubView("local_library"); close(); } },
    ];
    invoke<{ id: string; name: string; track_count: number; cover?: string | null }[]>("all_playlists")
      .then((pls) => {
        const userCards: ShelfCard[] = pls.map((p) => ({
          id: p.id,
          name: p.name,
          sub: `${p.track_count} 首`,
          cover: p.cover || null,  // 后端返回歌单首曲网络封面（网易云/QQ 歌曲）；无则黑胶占位
          onClick: () => { usePlayerStore.setState({ currentPlaylistId: p.id }); setSubView("user_playlist"); close(); },
        }));
        setCards([...fixed, ...userCards]);
      })
      .catch(() => setCards(fixed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryTracks, setSubView]);

  // 关闭动画：先 setClosing(true)，动画结束后再 onClose
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 250);
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // 卸载时重置 orbit（避免下次打开残留偏移）
  useEffect(() => {
    return () => {
      orbit.userTheta = 0;
      orbit.userPhi = 0;
      orbit.userRadius = 0;
    };
  }, []);

  const onSelect = (i: number) => { cards[i]?.onClick(); };

  return (
    <div
      className={`shelf-overlay ${closing ? "closing" : ""}`}
      onContextMenu={(e) => { e.preventDefault(); close(); }}
    >
      <div className="shelf-hint">滚轮切换 · Shift+滚轮缩放 · 拖拽旋转 · 点击打开 · 右键/ESC 关闭</div>
      <Canvas
        camera={{ position: [0, 0, 11], fov: 55 }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 1.6]}
      >
        <ShelfScene cards={cards} centerIdx={centerIdx} setCenterIdx={setCenterIdx} onSelect={onSelect} />
      </Canvas>
    </div>
  );
}
