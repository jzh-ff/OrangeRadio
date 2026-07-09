import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Track } from "./libraryStore";

export type PlaybackMode =
  | "sequence"
  | "list_loop"
  | "single_loop"
  | "shuffle"
  | "understand_you";

/** 节拍角色（驱动电影运镜类型） */
export type BeatCombo = "downbeat" | "push" | "drop" | "rebound" | "accent";

/** 节拍检测结果（由 useBeatDetector 每帧更新） */
export interface BeatState {
  /** 当前帧是否为节拍命中 */
  isBeat: boolean;
  /** 低频能量 0~1（鼓点/贝斯） */
  bass: number;
  /** 中频能量 0~1（人声/吉他） */
  mid: number;
  /** 高频能量 0~1（镲片/空气感） */
  treble: number;
  /** 节拍脉冲 0~1（命中时跳到 1，随后指数衰减，用于驱动视觉） */
  intensity: number;
  /** 当前 hit 的角色（图谱驱动时设；实时检测为 null） */
  currentCombo: BeatCombo | null;
}

/** 节拍图谱单个事件（由后端 analyze_beatmap 预计算，驱动电影运镜） */
export interface BeatHit {
  /** 时间（秒） */
  time: number;
  /** 冲击强度 0~1（驱动镜头 zoom/震动幅度） */
  impact: number;
  /** 低频分量 0~1 */
  low: number;
  /** 中频分量 0~1 */
  body: number;
  /** 高频分量 0~1 */
  snap: number;
  /** 节拍角色 */
  combo: BeatCombo;
}

/** BeatCam 模式：deep=低频/kick；body=中频/人声；snap=高频/镲片（对标 Mineradio） */
export type BeatCamMode = "deep" | "body" | "snap";

/**
 * 节拍相机事件（对标 Mineradio scheduleBeatCamera 入队的事件对象，index.html 4868-4888）
 *
 * 由 scheduleBeatCamera 在节拍命中时构造，按 audio.currentTime 推进 ADSR 包络。
 * updateBeatCamera 每帧消费这些事件，输出 5 通道 beatCam 状态。
 */
export interface BeatCamEvent {
  /** 事件在 audio.currentTime 时间轴上的开始时刻（= hitTime - attack） */
  start: number;
  /** 节拍命中时刻 */
  hit: number;
  /** 整体冲击强度 0~1 */
  amp: number;
  /** ADSR 三段长度（秒） */
  attack: number;
  hold: number;
  release: number;
  /** 各方向通道幅值系数 */
  zoomAmp: number;
  thetaAmp: number;
  phiAmp: number;
  rollAmp: number;
  /** 音色模式 + 角色（驱动应用层分支） */
  mode: BeatCamMode;
  combo: BeatCombo;
  /** 相位偏移（用于决定 roll 的正负方向，制造左右摇） */
  phase: number;
  /** 归一化音色分量（应用层辅助） */
  low: number;
  body: number;
  snap: number;
  /** 综合"质量感" 0~1（低频为主） */
  mass: number;
}

/** BeatCam 当前帧输出（5 通道，updateBeatCamera 写入，CinematicCamera 读取） */
export interface BeatCamState {
  /** 总冲击（驱动 FOV punch） */
  punch: number;
  /** 水平摇（yaw） */
  thetaKick: number;
  /** 俯仰摇（pitch） */
  phiKick: number;
  /** 径向推近（沿相机前向） */
  radiusKick: number;
  /** 滚动（roll） */
  rollKick: number;
}

/** 视觉参数（可由 VisualConsole 调节，持久化到 localStorage；对标 MineRadio fx 对象） */
export type ColorTheme = "orange" | "purple" | "ocean" | "aurora" | "auto";

export interface VisualParams {
  /** 节拍灵敏度（越大越容易触发节拍） */
  sensitivity: number;
  /** 粒子数量 */
  particleCount: number;
  /** Bloom 发光强度 */
  bloomStrength: number;
  /** 颜色主题 */
  colorTheme: ColorTheme;
  /** 镜头晃动开关 */
  cameraShake: boolean;
  // ===== P11 DIY 控制台扩展（对标 MineRadio fxDefaults） =====
  /** 视觉预设（0 默认封面 / 1 滚筒 / 2 星河 / 3 唱片，P7 preset 切换用） */
  preset: number;
  /** 律动强度（0-1.5，整体视觉对节拍的响应幅度） */
  intensity: number;
  /** 画面景深（0-2，粒子纵深） */
  depth: number;
  /** 封面清晰度（粒子网格分辨率倍率，0.5-2） */
  coverResolution: number;
  /** 电影镜头晃动强度（0-1，cameraShake 开关时的幅度） */
  cinemaShake: number;
  /** 粒子尺寸倍率（0.3-3） */
  pointSize: number;
  /** 运动速度倍率（0-3） */
  speed: number;
  /** 粒子扭曲（0-2） */
  twist: number;
  /** 色彩张力（0-2，颜色对比度） */
  colorTension: number;
  /** 离散感（0-2，粒子分散度） */
  scatter: number;
  /** 背景压暗（0-1，主壳背景暗角强度） */
  bgFade: number;
  // 开关
  /** 电影镜头开关 */
  cinema: boolean;
  /** 粒子溢光开关 */
  bloom: boolean;
  /** 轮廓高亮开关 */
  edge: boolean;
  /** 歌词溢光开关 */
  lyricGlow: boolean;
  /** 鼓点溢光开关 */
  lyricGlowBeat: boolean;
  /** 自定义壁纸透明度（0-1） */
  wallpaperOpacity: number;
  /** 自定义壁纸模糊（px） */
  wallpaperBlur: number;
  /** 自定义壁纸缩放 */
  wallpaperScale: number;
  /** 自定义壁纸暗角（0-1） */
  wallpaperDim: number;
  // ===== 沉浸模式设置 =====
  /** 沉浸模式背景源 */
  immersiveBg: "cover" | "cover-particles" | "wallpaper" | "particles" | "solid";
  /** 沉浸模式歌词字号 */
  immersiveLyricSize: "sm" | "md" | "lg" | "xl";
  /** 沉浸模式歌词对齐 */
  immersiveLyricAlign: "center" | "left";
  /** 沉浸模式是否显示翻译 */
  immersiveShowTranslation: boolean;
  /** 沉浸模式纯色背景 */
  immersiveSolidColor: string;
  /** 沉浸模式封面是否模糊 */
  immersiveCoverBlur: boolean;
  /** 歌词自定义颜色（hex） */
  lyricColor: string;
  /** 歌词颜色是否跟随封面主色 */
  lyricColorAuto: boolean;
  // ===== 前景组件透明度（壁纸视觉重构）=====
  /** 侧栏透明度（0-1，调低让全局壁纸透出） */
  sidebarOpacity: number;
  /** 底部播放栏透明度 */
  playerBarOpacity: number;
  /** 主视图透明度 */
  mainOpacity: number;
  /** 全屏播放页透明度（非 cinema tab；略高保歌词可读） */
  fullPlayerOpacity: number;
}

/** 全屏播放页布局模式 */
export type FullLayout = "immersive" | "lyric-stream" | "triple" | "rhythmic-album" | "rhythmic-particles";

/** 视觉参数默认值（用于初始加载 & 视觉控制台「恢复默认」） */
export const DEFAULT_VISUAL_PARAMS: VisualParams = {
  sensitivity: 1.4,
  particleCount: 2200,
  bloomStrength: 1.1,
  colorTheme: "orange",
  cameraShake: true,
  preset: 0,
  intensity: 0.85,
  depth: 1.0,
  coverResolution: 1.0,
  cinemaShake: 0.5,
  pointSize: 1.0,
  speed: 1.0,
  twist: 0,
  colorTension: 1.1,
  scatter: 0,
  bgFade: 0.2,
  cinema: true,
  bloom: true,
  edge: false,
  lyricGlow: true,
  lyricGlowBeat: true,
  wallpaperOpacity: 0.6,
  wallpaperBlur: 8,
  wallpaperScale: 1.05,
  wallpaperDim: 0.3,
  sidebarOpacity: 0.6,
  playerBarOpacity: 0.6,
  mainOpacity: 0.5,
  fullPlayerOpacity: 0.5,
  // ===== 沉浸模式默认 =====
  immersiveBg: "cover-particles",
  immersiveLyricSize: "xl",
  immersiveLyricAlign: "center",
  immersiveShowTranslation: true,
  immersiveSolidColor: "#0a0a0f",
  immersiveCoverBlur: true,
  lyricColor: "#fff7e0",
  lyricColorAuto: true,
};

/** 从 localStorage 读取视觉参数，合并默认值（对标 MineRadio fxDefaults） */
function loadVisualParams(): VisualParams {
  try {
    const raw = localStorage.getItem("orangeradio_visual_params");
    if (raw) return { ...DEFAULT_VISUAL_PARAMS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_VISUAL_PARAMS;
}

/** 触发"重新登录"的音源 key（toast 按钮设值，view listen 后自动切到扫码 UI） */
export type ReloginSource = "netease" | "qqmusic" | "spotify" | null;

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  mode: PlaybackMode;
  view: "player" | "studio";
  /** 播放器内子页面 */
  subView: "home" | "library" | "radio" | "netease" | "podcast" | "qqmusic" | "spotify" | "gequbao" | "kugou" | "kuwo" | "qishui" | "user_playlist" | "search" | "wallpaper";
  /** 当前查看的用户歌单 ID */
  currentPlaylistId: string | null;
  /**
   * @deprecated 高频实时频谱已迁移到 spectrumBus（见 stores/spectrumBus.ts），
   * 此字段仅作兼容保留，不再由 useAudioEngine 写入；新代码请用 `readSpectrum()`。
   */
  spectrum: number[];
  /**
   * @deprecated 节拍实时结果已迁移到 spectrumBus（见 stores/spectrumBus.ts），
   * 此字段仅作兼容保留，不再由 useBeatDetector 写入；新代码请用 `readBeat()`。
   * 注意：beatmap（图谱）仍是 store 字段，低频写入，未迁移。
   */
  beat: BeatState;
  /** 节拍图谱（本地文件预计算，null 表示用实时检测退化） */
  beatmap: BeatHit[] | null;
  /** 图谱游标：当前已触发的 hit 索引 */
  beatmapIndex: number;
  /** BeatCam 事件队列（scheduleBeatCamera 入队 → updateBeatCamera 消费） */
  beatCamEvents: BeatCamEvent[];
  /** BeatCam 当前帧 5 通道状态（punch + 4 个方向 kick），驱动 CinematicCamera */
  beatCam: BeatCamState;
  /** 视觉参数（cinema 模式用） */
  visualParams: VisualParams;
  /** 当前封面主色 [r,g,b] 0~255，null 表示未提取/失败（auto 主题退回橙色默认） */
  dominantColor: [number, number, number] | null;
  /** 全屏播放页是否打开 */
  fullPlayerOpen: boolean;
  /** 全屏播放页布局模式 */
  fullLayout: FullLayout;
  /** 播放队列面板是否打开 */
  queueOpen: boolean;
  /** 当前播放队列 + 索引（用于上/下一首） */
  tracks: Track[];
  currentIndex: number;
  /** 电台队列（与单曲队列隔离，互不干扰） */
  radioTracks: Track[];
  radioIndex: number;
  /** 当前活跃的队列类型（驱动 next/prev 路由到 tracks 或 radioTracks） */
  activeQueue: "tracks" | "radio";
  /** 请求重新登录的音源：view 监听变化后切到扫码 UI */
  pendingLoginSource: ReloginSource;
  /** 设置弹窗是否打开 */
  settingsOpen: boolean;
  /** 听歌画像面板是否打开（首页 profile 卡点击触发） */
  profileOpen: boolean;
  /** 主页沉浸模式：仅展示壁纸 + 歌词（隐藏侧栏/顶栏/底栏/导航） */
  immersiveMode: boolean;
  /** 热键设置弹窗是否打开 */
  hotkeysModalOpen: boolean;
  /** 侧栏智能动作激活态（"AI 推荐" / "懂你模式" 等动作项的高亮标记,与 subView 解耦) */
  smartAction: "recommend" | "understand_you" | null;
  /** 侧边栏是否收起（VS Code 风格右上角开关） */
  sidebarHidden: boolean;
  /** 底部播放栏是否手动收起（VS Code 风格右上角开关） */
  playerBarHidden: boolean;

  setView: (v: "player" | "studio") => void;
  setSubView: (v: "home" | "library" | "wallpaper" | "radio" | "netease" | "podcast" | "qqmusic" | "spotify" | "gequbao" | "kugou" | "kuwo" | "qishui" | "user_playlist" | "search") => void;
  setMode: (m: PlaybackMode) => void;
  setCurrent: (t: Track, index: number) => void;
  setQueue: (tracks: Track[]) => void;
  /** 设置电台队列并切到电台活跃队列（与单曲队列隔离） */
  setRadioQueue: (tracks: Track[]) => void;
  /** 追加单曲到队尾 */
  addToQueue: (track: Track) => void;
  /** 批量追加到队尾 */
  addManyToQueue: (tracks: Track[]) => void;
  /** 插入到当前位置之后（"下一首播放"） */
  insertNext: (track: Track) => void;
  /** 删除指定位置的单曲 */
  removeAt: (index: number) => void;
  /** 清空单曲队列 */
  clearQueue: () => void;
  setBeat: (b: Partial<BeatState>) => void;
  /** 设置节拍图谱（null 清空 → 退化用实时检测） */
  setBeatmap: (hits: BeatHit[] | null) => void;
  /** BeatCam 入队一条事件（scheduleBeatCamera 调用） */
  pushBeatCamEvent: (ev: BeatCamEvent) => void;
  /** 清空 BeatCam 事件队列（切歌/暂停时调） */
  clearBeatCamEvents: () => void;
  /** 写入 BeatCam 5 通道当前帧（updateBeatCamera 每帧调用） */
  setBeatCamState: (s: BeatCamState) => void;
  setVisualParams: (p: Partial<VisualParams>) => void;
  setDominantColor: (c: [number, number, number] | null) => void;
  setFullPlayer: (b: boolean) => void;
  setFullLayout: (l: FullLayout) => void;
  setSettingsOpen: (open: boolean) => void;
  setProfileOpen: (open: boolean) => void;
  setImmersiveMode: (b: boolean) => void;
  setHotkeysModalOpen: (open: boolean) => void;
  setSmartAction: (a: "recommend" | "understand_you" | null) => void;
  setSidebarHidden: (b: boolean) => void;
  setPlayerBarHidden: (b: boolean) => void;
  /** 请求某个 source 触发重新登录（toast / settings 用） */
  requestRelogin: (source: Exclude<ReloginSource, null>) => void;
  /** 清掉重新登录请求（view 处理完后调） */
  clearRelogin: () => void;
  patch: (s: Partial<PlayerState>) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
  currentTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 0.7,
  mode: "sequence",
  view: "player",
  subView: "home",
  currentPlaylistId: null,
  spectrum: new Array(64).fill(0),
  beat: { isBeat: false, bass: 0, mid: 0, treble: 0, intensity: 0, currentCombo: null },
  beatmap: null,
  beatmapIndex: 0,
  beatCamEvents: [],
  beatCam: { punch: 0, thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0 },
  visualParams: loadVisualParams(),
  dominantColor: null,
  fullPlayerOpen: false,
  fullLayout: "rhythmic-album",
  queueOpen: false,
  tracks: [],
  currentIndex: -1,
  radioTracks: [],
  radioIndex: -1,
  activeQueue: "tracks",
  pendingLoginSource: null,
  settingsOpen: false,
  hotkeysModalOpen: false,
  profileOpen: false,
  immersiveMode: false,
  smartAction: null,
  sidebarHidden: false,
  playerBarHidden: false,

  setView: (view) => set({ view }),
  setSubView: (subView) => set({ view: "player", subView }),
  setMode: (mode) => set({ mode }),
  setCurrent: (currentTrack, currentIndex) => set({ currentTrack, currentIndex }),
  setQueue: (tracks) => set({ tracks, activeQueue: "tracks" }),
  setRadioQueue: (radioTracks) => set({ radioTracks, activeQueue: "radio" }),
  addToQueue: (track) => set((s) => ({ tracks: [...s.tracks, track] })),
  addManyToQueue: (tracks) => set((s) => ({ tracks: [...s.tracks, ...tracks] })),
  insertNext: (track) => set((s) => {
    const at = Math.max(0, s.currentIndex + 1);
    const tracks = [...s.tracks];
    tracks.splice(at, 0, track);
    // 插入点在 currentIndex 之前或等于时，currentIndex 后移（保持指向原曲）
    const currentIndex = s.currentIndex >= 0 && at <= s.currentIndex ? s.currentIndex + 1 : s.currentIndex;
    return { tracks, currentIndex };
  }),
  removeAt: (index) => set((s) => {
    const tracks = s.tracks.filter((_, i) => i !== index);
    let currentIndex = s.currentIndex;
    if (index < currentIndex) currentIndex -= 1;
    else if (index === currentIndex) currentIndex = -1; // 删的是当前播放
    return { tracks, currentIndex };
  }),
  clearQueue: () => set({ tracks: [], currentIndex: -1 }),
  setBeat: (b) => set({ beat: { ...get().beat, ...b } }),
  setBeatmap: (beatmap) =>
    set({
      beatmap,
      beatmapIndex: 0,
      beat: { isBeat: false, bass: 0, mid: 0, treble: 0, intensity: 0, currentCombo: null },
      beatCamEvents: [],           // 切图谱时清队列
      beatCam: { punch: 0, thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0 },
    }),
  pushBeatCamEvent: (ev) => set((s) => {
    // 队列上限 12（对标 Mineradio maxEvents = 12，4890 行）
    const next = [...s.beatCamEvents, ev];
    if (next.length > 12) next.splice(0, next.length - 12);
    return { beatCamEvents: next };
  }),
  clearBeatCamEvents: () => set({ beatCamEvents: [], beatCam: { punch: 0, thetaKick: 0, phiKick: 0, radiusKick: 0, rollKick: 0 } }),
  setBeatCamState: (beatCam) => set({ beatCam }),
  setVisualParams: (p) => {
    const next = { ...get().visualParams, ...p };
    set({ visualParams: next });
    try { localStorage.setItem("orangeradio_visual_params", JSON.stringify(next)); } catch { /* ignore */ }
  },
  setDominantColor: (dominantColor) => set({ dominantColor }),
  setFullPlayer: (fullPlayerOpen: boolean) => set({ fullPlayerOpen }),
  setFullLayout: (fullLayout: FullLayout) => set({ fullLayout }),
  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
  setProfileOpen: (profileOpen: boolean) => set({ profileOpen }),
  setImmersiveMode: (immersiveMode: boolean) => set({ immersiveMode }),
  setHotkeysModalOpen: (hotkeysModalOpen: boolean) => set({ hotkeysModalOpen }),
  setSmartAction: (smartAction) => set({ smartAction }),
  setSidebarHidden: (sidebarHidden: boolean) => set({ sidebarHidden }),
  setPlayerBarHidden: (playerBarHidden: boolean) => set({ playerBarHidden }),
  requestRelogin: (source) => set({ pendingLoginSource: source }),
  clearRelogin: () => set({ pendingLoginSource: null }),
  patch: (s) => set(s),
    }),
    {
      name: "orangeradio_player",
      storage: createJSONStorage(() => localStorage),
      // 只持久化队列与播放偏好，排除 spectrum/beat/beatmap 等高频瞬时态
      partialize: (s) => ({
        tracks: s.tracks,
        currentIndex: s.currentIndex,
        radioTracks: s.radioTracks,
        radioIndex: s.radioIndex,
        activeQueue: s.activeQueue,
        mode: s.mode,
        volume: s.volume,
        currentTrack: s.currentTrack,
        sidebarHidden: s.sidebarHidden,
        playerBarHidden: s.playerBarHidden,
      }),
    }
  )
);
