//! 音频解码器
//!
//! v0.1 骨架：定义解码 trait，v0.2 将接入 symphonia 实现完整 Hi-Res 解码。

use orange_core::audio_format::AudioFormat;
use orange_core::Result;
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// 解码后的 PCM 音频数据
pub struct DecodedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_secs: f64,
}

/// 解码器 trait
pub trait Decoder: Send + Sync {
    /// 支持的格式
    fn supports(&self, format: AudioFormat) -> bool;

    /// 从字节流解码
    fn decode(&self, data: &[u8]) -> Result<DecodedAudio>;
}

/// 占位解码器（v0.1）
pub struct StubDecoder;

impl Decoder for StubDecoder {
    fn supports(&self, _format: AudioFormat) -> bool {
        false
    }
    fn decode(&self, _data: &[u8]) -> Result<DecodedAudio> {
        Err(orange_core::CoreError::Unsupported(
            "解码器尚未实现 (v0.1 骨架)".into(),
        ))
    }
}

/// 解码整个音频文件到 **mono f32 PCM**（用于节拍图谱预计算）。
///
/// 多声道混缩为单声道，方便后续 DSP 处理。symphonia 自动嗅探格式
/// （mp3/flac/wav/aac/ogg/m4a 等都已启用 feature）。
pub fn decode_file(path: &Path) -> Result<DecodedAudio> {
    let file = File::open(path)
        .map_err(|e| orange_core::CoreError::Internal(format!("打开音频文件失败: {e}")))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // 用扩展名辅助嗅探（无扩展名也能靠内容探测）
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| orange_core::CoreError::Internal(format!("探测音频格式失败: {e}")))?;
    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| orange_core::CoreError::Unsupported("音频流无可解码轨道".into()))?;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| orange_core::CoreError::Unsupported("音频流缺少采样率".into()))?;
    let nch = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(2);
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| orange_core::CoreError::Internal(format!("创建解码器失败: {e}")))?;

    let mut samples: Vec<f32> = Vec::new();

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => break,
        };
        let ch = decoded.spec().channels.count().max(1);
        // SampleBuffer 每包重建（需要 SignalSpec）；单位是 frames
        let mut sample_buf =
            SampleBuffer::<i16>::new(decoded.capacity() as u64, *decoded.spec());
        sample_buf.copy_interleaved_ref(decoded);
        let raw = sample_buf.samples(); // &[i16] interleaved
        let n_frames = raw.len() / ch;
        for f in 0..n_frames {
            let mut sum = 0i32;
            for c in 0..ch {
                sum += raw[f * ch + c] as i32;
            }
            samples.push(sum as f32 / (ch as f32 * 32768.0));
        }
    }

    let duration_secs = samples.len() as f64 / sample_rate as f64;
    Ok(DecodedAudio {
        samples,
        sample_rate,
        channels: nch as u16,
        duration_secs,
    })
}
