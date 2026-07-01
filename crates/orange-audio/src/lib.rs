//! # OrangeRadio Audio
//!
//! Hi-Res 音频解码 + DSP 处理引擎。
//!
//! ## 职责
//! - 无损 / Hi-Res 解码 (FLAC / WAV / ALAC / DSD / MP3 / AAC / OGG)
//! - 实时 DSP：EQ / 空间音频 / 响度归一化 / 重采样
//! - AI DJ 无缝混音（BPM 对齐、节拍匹配、crossfade）
//! - 音频可视化数据输出（FFT 频谱 → 传给前端 Three.js）

pub mod decoder;
pub mod dsp;
pub mod mixer;
pub mod spectrum;

pub use decoder::{Decoder, DecodedAudio};
pub use dsp::{DspChain, Equalizer, SpatialAudio, LoudnessNormalizer};
pub use mixer::{DjMixer, CrossfadeConfig};
pub use spectrum::{SpectrumAnalyzer, SpectrumData};
