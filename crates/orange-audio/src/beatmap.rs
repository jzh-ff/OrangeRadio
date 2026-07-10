//! 节拍图谱预计算（对标 Mineradio dj-analyzer）
//!
//! 流程：lowpass biquad（取 kick/bass 低频）→ 10ms 帧化 RMS → onset 检测
//! （滑动窗口 mean + 1.66*std + 局部峰值）→ 网格量化估 BPM → 输出 BeatHit。
//!
//! MVP：只分析低频段（low=impact），中/高频 body/snap 留 0，后续可加带通分频。
//! combo 按拍位 + 强度启发式判定，驱动前端镜头运动。

use crate::decoder::DecodedAudio;
use serde::{Deserialize, Serialize};

/// 单个节拍事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeatHit {
    /// 时间（秒）
    pub time: f32,
    /// 冲击强度 0~1（驱动镜头 zoom / 震动幅度）
    pub impact: f32,
    /// 低频能量分量 0~1
    pub low: f32,
    /// 中频能量分量 0~1（MVP 留 0）
    pub body: f32,
    /// 高频能量分量 0~1（MVP 留 0）
    pub snap: f32,
    /// 节拍角色
    pub combo: BeatCombo,
}

/// 节拍角色（驱动镜头运动类型）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BeatCombo {
    Downbeat,
    Push,
    Drop,
    Rebound,
    Accent,
}

/// 整曲节拍图谱
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Beatmap {
    pub hits: Vec<BeatHit>,
    pub bpm: f32,
    pub duration: f32,
}

/// 分析解码后的音频，生成节拍图谱
///
/// 接收 `&mut` 以原地滤波（避免克隆整曲 PCM）。调用方 `decode_file` 后立即分析，
/// audio 用完即弃，原地安全。
pub fn analyze(audio: &mut DecodedAudio) -> Beatmap {
    let sr = audio.sample_rate as f32;
    if audio.samples.is_empty() {
        return Beatmap {
            hits: vec![],
            bpm: 120.0,
            duration: 0.0,
        };
    }

    // 1. lowpass biquad（200Hz，Q=0.707 近 Butterworth，取 kick/bass）原地滤波，省一份等长 Vec
    biquad_lowpass_in_place(&mut audio.samples, 200.0, sr);

    // 1.5 下采样：200Hz 低通后奈奎斯特频率=400Hz，降到 ~1000Hz 足以保留节拍信息，
    //    数据量降 ~44x（44100→1000），后续帧化/onset 内存与 CPU 大幅下降。
    let ds_sr = 1000.0_f32;
    let step = (sr / ds_sr).round().max(1.0) as usize;
    let down: Vec<f32> = audio.samples.iter().step_by(step).copied().collect();
    let down_sr = sr / step as f32;

    // 2. 帧化 10ms RMS（基于下采样后的数据）
    let frame_size = (0.01 * down_sr).round().max(1.0) as usize;
    let frames = frame_rms(&down, frame_size);
    let frame_dt = frame_size as f32 / down_sr;

    // 3. onset（滑动 82 帧 ≈ 0.82s，mean + 1.66*std + 局部峰值）
    let onsets = detect_onsets(&frames, 82, frame_dt);

    // 4. 网格量化：onset 间隔直方图估 BPM（clamp 70~188）
    let bpm = estimate_bpm(&onsets);
    let beat_period = 60.0 / bpm;

    // 5. 输出 hits（impact 归一化；combo 按拍位 + 强度启发式）
    let max_rms = frames.iter().cloned().fold(0.0f32, f32::max).max(1e-6);
    let mut hits = Vec::with_capacity(onsets.len());
    for (i, &(t, rms)) in onsets.iter().enumerate() {
        let impact = (rms / max_rms).clamp(0.0, 1.0);
        let beat_pos = (t / beat_period).round();
        let phase_err = (t - beat_pos * beat_period).abs();
        let is_downbeat = phase_err < frame_dt * 2.0;
        let combo = if is_downbeat && i % 4 == 0 {
            BeatCombo::Downbeat
        } else if impact > 0.7 {
            BeatCombo::Accent
        } else if i % 2 == 0 {
            BeatCombo::Push
        } else {
            BeatCombo::Rebound
        };
        hits.push(BeatHit {
            time: t,
            impact,
            low: impact,
            body: 0.0,
            snap: 0.0,
            combo,
        });
    }

    Beatmap {
        hits,
        bpm,
        duration: audio.duration_secs as f32,
    }
}

/// RBJ cookbook lowpass biquad（Q=0.707 近 Butterworth），原地写回输入 buffer，省一份等长 Vec
fn biquad_lowpass_in_place(samples: &mut [f32], cutoff: f32, sr: f32) {
    let w0 = 2.0 * std::f32::consts::PI * cutoff / sr;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let q = 0.707;
    let alpha = sinw / (2.0 * q);
    let b0 = (1.0 - cosw) / 2.0;
    let b1 = 1.0 - cosw;
    let b2 = (1.0 - cosw) / 2.0;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cosw;
    let a2 = 1.0 - alpha;
    // 归一化
    let (b0, b1, b2, a1, a2) = (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);

    let (mut x1, mut x2, mut y1, mut y2) = (0.0f32, 0.0, 0.0, 0.0);
    for s in samples.iter_mut() {
        let x = *s;
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        *s = y;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
    }
}

/// 帧化 RMS
fn frame_rms(samples: &[f32], frame: usize) -> Vec<f32> {
    let n = samples.len() / frame;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let start = i * frame;
        let end = (start + frame).min(samples.len());
        let mut sum = 0.0f32;
        for s in &samples[start..end] {
            sum += s * s;
        }
        out.push((sum / (end - start) as f32).sqrt());
    }
    out
}

/// onset 检测：滑动窗口 mean+1.66*std + 局部峰值 + 220ms 冷却
fn detect_onsets(frames: &[f32], window: usize, frame_dt: f32) -> Vec<(f32, f32)> {
    if frames.len() <= window + 1 {
        return vec![];
    }
    let mut onsets = Vec::new();
    let mut cooldown = 0usize;
    for i in window..frames.len() - 1 {
        if cooldown > 0 {
            cooldown -= 1;
            continue;
        }
        let w = &frames[i - window..i];
        let mean = w.iter().sum::<f32>() / window as f32;
        let var = w.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / window as f32;
        let std = var.sqrt();
        let thr = mean + 1.66 * std;
        let cur = frames[i];
        if cur > thr && cur > frames[i - 1] && cur >= frames[i + 1] && cur > 0.02 {
            onsets.push((i as f32 * frame_dt, cur));
            cooldown = 22; // ~220ms
        }
    }
    onsets
}

/// onset 间隔直方图估 BPM（clamp 70~188 → 0.32~0.86 s/拍）
fn estimate_bpm(onsets: &[(f32, f32)]) -> f32 {
    if onsets.len() < 2 {
        return 120.0;
    }
    let mut ivs: Vec<f32> = Vec::new();
    for w in onsets.windows(2) {
        let d = w[1].0 - w[0].0;
        if d > 0.05 && d < 2.0 {
            ivs.push(d);
        }
    }
    if ivs.is_empty() {
        return 120.0;
    }
    // 直方图：0.32~0.86s，bin 0.01s（共 54 个 bin）
    let mut hist = [0u32; 55];
    for d in &ivs {
        let bin = ((d - 0.32) / 0.01).round() as i64;
        if bin >= 0 && (bin as usize) < hist.len() {
            hist[bin as usize] += 1;
        }
    }
    let best = hist
        .iter()
        .enumerate()
        .max_by_key(|(_, v)| *v)
        .map(|(i, _)| i)
        .unwrap_or(27);
    let period = 0.32 + best as f32 * 0.01;
    let mut bpm = 60.0 / period;
    if bpm < 70.0 {
        bpm *= 2.0;
    }
    if bpm > 188.0 {
        bpm /= 2.0;
    }
    bpm.clamp(70.0, 188.0)
}
