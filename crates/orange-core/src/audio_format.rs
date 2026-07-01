//! 音频格式定义
//!
//! 覆盖 Hi-Res 高保真场景下所有常见格式。

use serde::{Deserialize, Serialize};

/// 音频编码格式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    /// 无损 FLAC
    Flac,
    /// WAV / PCM
    Wav,
    /// Apple 无损 ALAC
    Alac,
    /// DSD (Direct Stream Digital, Super Audio CD)
    Dsd,
    /// APE (Monkey's Audio)
    Ape,
    /// 有损 MP3
    Mp3,
    /// 有损 AAC / M4A
    Aac,
    /// 有损 OGG / Vorbis
    Ogg,
    /// Opus
    Opus,
    /// AIFF
    Aiff,
    /// 未知 / 其他
    Unknown,
}

impl AudioFormat {
    /// 是否为无损格式
    pub fn is_lossless(&self) -> bool {
        matches!(
            self,
            AudioFormat::Flac | AudioFormat::Wav | AudioFormat::Alac | AudioFormat::Ape | AudioFormat::Dsd
        )
    }

    /// 是否为 Hi-Res（高解析度）格式
    pub fn is_hires(&self) -> bool {
        matches!(self, AudioFormat::Flac | AudioFormat::Wav | AudioFormat::Dsd | AudioFormat::Alac)
    }

    /// 从文件扩展名推断
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().trim_start_matches('.') {
            "flac" => AudioFormat::Flac,
            "wav" | "wave" => AudioFormat::Wav,
            "alac" | "m4a" => AudioFormat::Alac,
            "dsf" | "dff" | "dsd" => AudioFormat::Dsd,
            "ape" => AudioFormat::Ape,
            "mp3" => AudioFormat::Mp3,
            "aac" => AudioFormat::Aac,
            "ogg" | "oga" => AudioFormat::Ogg,
            "opus" => AudioFormat::Opus,
            "aif" | "aiff" => AudioFormat::Aiff,
            _ => AudioFormat::Unknown,
        }
    }
}

/// 音频质量等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Quality {
    /// 标准音质 (128 kbps)
    Standard,
    /// 高品质 (320 kbps MP3)
    High,
    /// 无损 (CD 16bit/44.1kHz)
    Lossless,
    /// Hi-Res (24bit/96kHz+)
    HiRes,
    /// 母带级 (24bit/192kHz+ / DSD)
    Master,
}

/// 采样位深
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BitDepth(pub u16);

/// 采样率 (Hz)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SampleRate(pub u32);
