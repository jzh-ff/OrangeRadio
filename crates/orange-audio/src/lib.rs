//! # OrangeRadio Audio
//!
//! Hi-Res 音频解码 + DSP 处理引擎。
//!
//! ## 职责
//! - 无损 / Hi-Res 解码 (FLAC / WAV / ALAC / DSD / MP3 / AAC / OGG)
//! - 实时 DSP：EQ / 空间音频 / 响度归一化 / 重采样
//! - AI DJ 无缝混音（BPM 对齐、节拍匹配、crossfade）
//! - 音频可视化数据输出（FFT 频谱 → 传给前端 Three.js）

pub mod beatmap;
pub mod decoder;
pub mod dsp;
pub mod mixer;
pub mod spectrum;

pub use beatmap::{analyze as analyze_beatmap, BeatCombo, BeatHit, Beatmap};
pub use decoder::{decode_file, DecodedAudio, Decoder};
pub use dsp::{DspChain, Equalizer, LoudnessNormalizer, SpatialAudio};
pub use mixer::{CrossfadeConfig, DjMixer};
pub use spectrum::{SpectrumAnalyzer, SpectrumData};

#[cfg(test)]
mod tests {
    use super::*;
    use decoder::DecodedAudio;

    #[test]
    fn spectrum_data_default_has_64_bands() {
        let d = SpectrumData::default();
        assert_eq!(d.bands.len(), 64);
        assert_eq!(d.loudness, 0.0);
        assert!(d.bpm.is_none());
    }

    #[test]
    fn spectrum_analyzer_defaults() {
        let a = SpectrumAnalyzer::default();
        assert_eq!(a.band_count, 64);
        let a2 = SpectrumAnalyzer::new(32);
        assert_eq!(a2.band_count, 32);
    }

    #[test]
    fn equalizer_default_10_bands() {
        let eq = dsp::Equalizer::default();
        assert_eq!(eq.bands.len(), 10);
        assert!(!eq.enabled);
        assert_eq!(eq.bands[0].freq, 31.0);
        assert_eq!(eq.bands[9].freq, 16000.0);
    }

    #[test]
    fn dsp_chain_defaults() {
        let chain = dsp::DspChain::default();
        assert!(!chain.eq.enabled);
        assert!(!chain.spatial.enabled);
        assert!(chain.loudness.enabled);
        assert_eq!(chain.loudness.target_lufs, -14.0);
    }

    #[test]
    fn beatmap_empty_audio_returns_default() {
        let audio = DecodedAudio {
            samples: vec![],
            sample_rate: 44100,
            channels: 2,
            duration_secs: 0.0,
        };
        let bm = beatmap::analyze(&audio);
        assert!(bm.hits.is_empty());
        assert_eq!(bm.bpm, 120.0);
        assert_eq!(bm.duration, 0.0);
    }

    #[test]
    fn beatmap_silence_returns_no_hits() {
        let audio = DecodedAudio {
            samples: vec![0.0f32; 44100],
            sample_rate: 44100,
            channels: 2,
            duration_secs: 1.0,
        };
        let bm = beatmap::analyze(&audio);
        assert!(bm.hits.is_empty());
    }

    #[test]
    fn beatmap_impulse_train_has_hits() {
        // 构造 2 秒 2Hz 的冲击信号（每 0.5s 一个脉冲），期望被 onset 检测捕获
        let sr = 44100u32;
        let total = (sr * 2) as usize;
        let mut samples = vec![0.0f32; total];
        for i in 0..4 {
            let center = (i * (sr as usize) / 2) + (sr as usize) / 4;
            for j in 0..2000 {
                let idx = center + j;
                if idx < samples.len() {
                    samples[idx] = 0.9;
                }
            }
        }
        let audio = DecodedAudio {
            samples,
            sample_rate: sr,
            channels: 2,
            duration_secs: 2.0,
        };
        let bm = beatmap::analyze(&audio);
        // 不要求精确数量，但应有命中且 BPM 落在合理范围
        assert!(!bm.hits.is_empty());
        assert!(bm.bpm >= 70.0 && bm.bpm <= 188.0);
    }

    #[test]
    fn stub_decoder_rejects_all_formats() {
        use decoder::{Decoder, StubDecoder};
        use orange_core::audio_format::AudioFormat;
        let d = StubDecoder;
        assert!(!d.supports(AudioFormat::Flac));
        assert!(d.decode(b"").is_err());
    }
}
