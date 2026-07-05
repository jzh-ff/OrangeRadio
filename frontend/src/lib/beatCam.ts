/**
 * BeatCam 节拍相机 ADSR 系统（对标 Mineradio index.html:3066-4988）
 *
 * 流程：
 *   1. scheduleBeatCameraFromHit(hit, audioTime) — 节拍命中时构造 BeatCamEvent 入队
 *   2. updateBeatCam(events, audioTime, dt) — 每帧按 audioTime 推进 ADSR 包络，输出 5 通道状态
 *   3. CinematicCamera 用 5 通道 + FOV punch 驱动相机
 *
 * ADSR 包络（每事件一段）：
 *   attack 段：val = easeBeatCamera(local / attack)（smoothstep 上升）
 *   hold   段：val = 1（保持）
 *   release段：val = 1 - easeBeatCamera((local - attack - hold) / release)（smoothstep 下降）
 *
 * 5 通道：
 *   punch      总冲击（驱动 FOV punch）
 *   thetaKick  水平摇（yaw）
 *   phiKick    俯仰摇（pitch）
 *   radiusKick 径向推近（沿相机前向）
 *   rollKick   滚动（roll）
 *
 * 平滑插值非对称："快上慢下"（上升 0.72 / 回落 0.38），符合冲击感。
 */

import type { BeatCamEvent, BeatCamMode, BeatCamState, BeatHit } from "../stores/playerStore";

// ===== ADSR 默认参数（对标 Mineradio 3066-3086） =====
const ATTACK_DEFAULT = 0.028;
const HOLD_DEFAULT = 0.030;
const RELEASE_DEFAULT = 0.185;

const ATTACK_MIN = 0.014;
const ATTACK_MAX = 0.038;
const HOLD_MIN = 0.014;
const HOLD_MAX = 0.052;
const RELEASE_MIN = 0.110;
const RELEASE_MAX = 0.255;

// ===== 平滑系数（非对称："快上慢下"） =====
const EASE_UP = 0.72;
const EASE_DOWN = 0.38;
const EASE_UP_SIGNED = 0.70; // 横向（thetaKick/phiKick/rollKick）
const EASE_DOWN_SIGNED = 0.36;

// ===== 工具函数 =====

/** smoothstep 曲线（对标 Mineradio easeBeatCamera 4111-4114） */
export function easeBeatCamera(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** clamp */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 按音色分模式（对标 Mineradio 4647-4654）
 * - snap: 高频镲片主导
 * - body: 中频人声/吉他主导
 * - deep: 低频 kick/底鼓主导
 */
function classifyMode(low: number, body: number, snap: number): BeatCamMode {
  if (snap > 0.42 && snap > low * 1.18 && snap > body * 1.08) return "snap";
  if (body > 0.46 && body > low * 1.12) return "body";
  return "deep";
}

/** 按 combo 调整 amp/zoomAmp/phiAmp/rollAmp（对标 Mineradio 4797-4817） */
function applyCombo(ev: {
  amp: number;
  zoomAmp: number;
  phiAmp: number;
  rollAmp: number;
  combo: BeatCamEvent["combo"];
}): void {
  switch (ev.combo) {
    case "downbeat":
      ev.amp *= 1.10;
      ev.zoomAmp *= 1.18;
      ev.phiAmp *= 0.72;
      break;
    case "push":
      ev.amp *= 0.84;
      ev.zoomAmp *= 0.88;
      ev.phiAmp *= 0.62;
      break;
    case "drop":
      ev.amp *= 0.96;
      ev.zoomAmp *= 0.72;
      ev.phiAmp *= 1.22;
      break;
    case "rebound":
      ev.amp *= 0.74;
      ev.zoomAmp *= 0.62;
      ev.phiAmp *= 0.78;
      break;
    case "accent":
      ev.amp *= 1.14;
      ev.zoomAmp *= 1.08;
      ev.rollAmp *= 1.35;
      break;
    default:
      break;
  }
}

/**
 * 从 BeatHit 构造 BeatCamEvent（对标 Mineradio scheduleBeatCamera 4615-4891 段）
 *
 * @param hit 后端预计算的节拍
 * @param audioTime 当前 audio.currentTime（用于把事件 start 锚到当前时间轴）
 */
export function scheduleBeatCameraFromHit(
  hit: BeatHit,
  audioTime: number
): BeatCamEvent {
  const impact = hit.impact ?? 0.72;

  // 音色归一化（对标 4640-4643）
  const toneSum = Math.max(0.001, hit.low + hit.body + hit.snap);
  const lowTone = hit.low / toneSum;
  const bodyTone = hit.body / toneSum;
  const snapTone = hit.snap / toneSum;

  const mode = classifyMode(lowTone, bodyTone, snapTone);

  // amp（对标 4664 + 4671）
  let amp = clamp(0.15 + impact * 0.34 + lowTone * 0.13 + snapTone * 0.04, 0.18, 0.72);
  // map-driven modulation（对标 4666：map source 加权 visualImpact）
  amp *= 0.68 + impact * 0.46;
  // 峰值限幅
  amp = clamp(amp, 0.08, 0.68);

  // 4 个通道幅值（对标 4688-4694）
  let zoomAmp = 0.070 + lowTone * 0.190 + (mode === "deep" ? 0.095 : 0.018) + impact * 0.045;
  let thetaAmp = 0.00035;
  let phiAmp = 0.002 + (mode === "body" ? 0.012 : mode === "snap" ? 0.005 : 0.002);
  let rollAmp = mode === "snap" ? 0.003 + snapTone * 0.004 : 0.0008;
  zoomAmp *= 0.76 + impact * 0.12;
  phiAmp *= 0.82 + impact * 0.08;
  rollAmp *= 0.78 + impact * 0.12;

  // combo 加权（对标 4797-4817）
  const ev: { amp: number; zoomAmp: number; phiAmp: number; rollAmp: number; combo: BeatCamEvent["combo"] } = {
    amp,
    zoomAmp,
    phiAmp,
    rollAmp,
    combo: hit.combo,
  };
  applyCombo(ev);

  // ADSR 三段长度（对标 4673-4681；mode + sharpness 调）
  const sharpness = snapTone;
  const attack = clamp(
    ATTACK_DEFAULT * (1.18 - sharpness * 0.55),
    ATTACK_MIN,
    ATTACK_MAX
  );
  const hold = clamp(
    HOLD_DEFAULT * (0.62 + lowTone * 0.55 + bodyTone * 0.25),
    HOLD_MIN,
    HOLD_MAX
  );
  const release = clamp(
    RELEASE_DEFAULT * (0.76 + lowTone * 0.56 + bodyTone * 0.18 - sharpness * 0.18),
    RELEASE_MIN,
    RELEASE_MAX
  );

  // 综合质量感（低频为主）
  const mass = clamp(lowTone * 0.72 + bodyTone * 0.36 + impact * 0.20, 0, 1);

  // 入队：start 在 audioTime + (hit.time - audioTime) - attack，即 hit 时刻前 attack 秒开始
  // （对标 Mineradio 4869 行；live 时用 audioTime - attack*0.42 缩短 lookahead）
  const start = audioTime + (hit.time - audioTime) - attack;

  return {
    start,
    hit: hit.time,
    amp: ev.amp,
    attack,
    hold,
    release,
    zoomAmp: ev.zoomAmp,
    thetaAmp,
    phiAmp: ev.phiAmp,
    rollAmp: ev.rollAmp,
    mode,
    combo: hit.combo,
    phase: (hit.time * 2.399963) % (Math.PI * 2),
    low: lowTone,
    body: bodyTone,
    snap: snapTone,
    mass,
  };
}

/**
 * 按 combo 应用 5 通道输出方向（对标 Mineradio updateBeatCamera 4947-4970）
 */
function applyComboOutputs(
  ev: BeatCamEvent,
  leadPunch: number,
  leadVal: number
): { thetaKick: number; phiKick: number; radiusKick: number; rollKick: number } {
  const sign = Math.sin(ev.phase) >= 0 ? 1 : -1;
  const snapFlick = 1 - clamp((leadVal - 0.25) / 0.75, 0, 1);

  switch (ev.combo) {
    case "downbeat":
      return {
        radiusKick: leadPunch * ev.zoomAmp,
        phiKick: -leadPunch * 0.0032,
        thetaKick: 0,
        rollKick: 0,
      };
    case "push":
      return {
        radiusKick: leadPunch * ev.zoomAmp * 0.72,
        phiKick: -leadPunch * 0.0014,
        thetaKick: 0,
        rollKick: 0,
      };
    case "drop":
      return {
        radiusKick: leadPunch * ev.zoomAmp * 0.46,
        phiKick: leadPunch * ev.phiAmp * 0.92,
        thetaKick: 0,
        rollKick: 0,
      };
    case "rebound":
      return {
        radiusKick: leadPunch * ev.zoomAmp * 0.30,
        phiKick: -leadPunch * ev.phiAmp * 0.22,
        thetaKick: 0,
        rollKick: 0,
      };
    case "accent": {
      const roll = sign * leadPunch * (ev.rollAmp || 0) * (0.45 + snapFlick * 0.30);
      return {
        radiusKick: leadPunch * ev.zoomAmp * 0.90,
        phiKick: -leadPunch * 0.0022,
        thetaKick: 0,
        rollKick: roll,
      };
    }
    default:
      // 未识别 combo：按"deep 风格"处理（径向推近 + 微微低头）
      return {
        radiusKick: leadPunch * ev.zoomAmp,
        phiKick: -leadPunch * 0.003,
        thetaKick: 0,
        rollKick: 0,
      };
  }
}

/**
 * 推进 BeatCam：每帧遍历事件队列，按 audioTime 算 ADSR 当前值，输出 5 通道状态。
 *
 * @param events  事件队列（会被 splice 删除过期事件，返回新队列）
 * @param audioTime 当前 audio.currentTime
 * @returns { newEvents, state } — state 是当前帧 5 通道值
 */
export function updateBeatCam(
  events: BeatCamEvent[],
  audioTime: number
): { newEvents: BeatCamEvent[]; state: BeatCamState } {
  let punch = 0;
  let thetaKick = 0;
  let phiKick = 0;
  let radiusKick = 0;
  let rollKick = 0;
  let leadEvent: BeatCamEvent | null = null;
  let leadPunch = 0;
  let leadVal = 0;

  const next: BeatCamEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const local = audioTime - ev.start;
    let val = 0;
    if (local < 0) {
      val = 0;
    } else if (local < ev.attack) {
      val = easeBeatCamera(local / ev.attack);
    } else if (local < ev.attack + ev.hold) {
      val = 1;
    } else if (local < ev.attack + ev.hold + ev.release) {
      val = 1 - easeBeatCamera((local - ev.attack - ev.hold) / ev.release);
    } else {
      continue; // 过期丢弃（不入新队列）
    }

    next.push(ev);
    const evPunch = val * ev.amp;
    if (evPunch > punch) punch = evPunch;
    if (evPunch > leadPunch) {
      leadEvent = ev;
      leadPunch = evPunch;
      leadVal = val;
    }
  }

  if (leadEvent) {
    const out = applyComboOutputs(leadEvent, leadPunch, leadVal);
    thetaKick = out.thetaKick;
    phiKick = out.phiKick;
    radiusKick = out.radiusKick;
    rollKick = out.rollKick;
  }

  return {
    newEvents: next,
    state: { punch, thetaKick, phiKick, radiusKick, rollKick },
  };
}

/**
 * 把 5 通道目标值平滑到当前值（上升快 / 回落慢），
 * 写入返回新的 state。prev 是上一帧 state。
 */
export function smoothBeatCam(prev: BeatCamState, target: BeatCamState): BeatCamState {
  const ratio = (targetVal: number, prevVal: number, up: number, down: number): number => {
    if (targetVal === prevVal) return prevVal;
    return prevVal + (targetVal - prevVal) * (targetVal > prevVal ? up : down);
  };
  return {
    punch:      ratio(target.punch,      prev.punch,      EASE_UP, EASE_DOWN),
    thetaKick:  ratio(Math.abs(target.thetaKick), Math.abs(prev.thetaKick), EASE_UP_SIGNED, EASE_DOWN_SIGNED) * Math.sign(target.thetaKick || prev.thetaKick || 1),
    phiKick:    ratio(Math.abs(target.phiKick),   Math.abs(prev.phiKick),   EASE_UP_SIGNED, EASE_DOWN_SIGNED) * Math.sign(target.phiKick || prev.phiKick || 1),
    radiusKick: ratio(target.radiusKick, prev.radiusKick, EASE_UP, EASE_DOWN),
    rollKick:   ratio(Math.abs(target.rollKick), Math.abs(prev.rollKick), EASE_UP_SIGNED, EASE_DOWN_SIGNED) * Math.sign(target.rollKick || prev.rollKick || 1),
  };
}