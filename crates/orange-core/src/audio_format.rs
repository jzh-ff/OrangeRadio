//! 音频格式定义
//!
//! 覆盖 Hi-Res 高保真场景下所有常见格式。

use serde::{Deserialize, Serialize};

/// 音频编码格式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
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
    #[default]
    Unknown,
}

impl AudioFormat {
    /// 是否为无损格式
    pub fn is_lossless(&self) -> bool {
        matches!(
            self,
            AudioFormat::Flac
                | AudioFormat::Wav
                | AudioFormat::Alac
                | AudioFormat::Ape
                | AudioFormat::Dsd
        )
    }

    /// 是否为 Hi-Res（高解析度）格式
    pub fn is_hires(&self) -> bool {
        matches!(
            self,
            AudioFormat::Flac | AudioFormat::Wav | AudioFormat::Dsd | AudioFormat::Alac
        )
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
/// 音频质量等级
///
/// serde 兼容 PascalCase（`"Standard"`，后端序列化默认格式）和小写 snake_case
/// （`"standard"`，前端部分代码使用），避免跨端反序列化失败。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Quality {
    /// 标准音质 (128 kbps)
    #[default]
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

impl Quality {
    /// 从字符串宽松解析（兼容 PascalCase / lowercase / 中文描述）
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "standard" | "std" => Quality::Standard,
            "high" | "hq" => Quality::High,
            "lossless" | "sq" => Quality::Lossless,
            "hires" | "hi-res" => Quality::HiRes,
            "master" => Quality::Master,
            _ => Quality::Standard,
        }
    }
}

// 自定义 Deserialize：兼容 PascalCase（后端序列化默认）和 lowercase（前端部分代码）
impl<'de> serde::Deserialize<'de> for Quality {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(Quality::from_str_loose(&s))
    }
}

impl serde::Serialize for Quality {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(match self {
            Quality::Standard => "Standard",
            Quality::High => "High",
            Quality::Lossless => "Lossless",
            Quality::HiRes => "HiRes",
            Quality::Master => "Master",
        })
    }
}

/// 采样位深
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BitDepth(pub u16);

/// 采样率 (Hz)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SampleRate(pub u32);
