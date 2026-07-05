//! MiniMax 官方对接
//!
//! 国内音乐 AIGC 最强之一，提供：
//! - LLM（写词、创作意图理解、指令式编辑）
//! - 音乐生成（风格化生成 + 人声演唱，music-2.6 模型）
//! - 纯伴奏模式（is_instrumental=true）→ 用于「人声/伴奏分轨」
//!
//! 实现 AudioAIProvider trait，未来可被其他厂商替代。
//!
//! ## 接口语义
//! MiniMax music_generation 是**同步**接口：一次 POST 直接返回生成的音频 URL
//! （耗时约 30-90 秒）。因此 `query()` 保留 trait 形状但返回 `Unsupported`。

use std::time::Duration;

use crate::provider::*;
use async_trait::async_trait;

/// MiniMax Provider（音乐生成）
///
/// 配置：
/// - `api_base`：如 `https://api.minimaxi.com`（不带尾斜杠）
/// - `api_key`：用户在 MiniMax 开放平台获取的 API Key
/// - `model`：模型名，推荐 `music-2.6-free`（限免）/ `music-2.6`（正式）
pub struct MiniMaxProvider {
    pub api_key: String,
    pub api_base: String,
    pub model: String,
    pub client: reqwest::Client,
}

impl MiniMaxProvider {
    pub fn new(
        api_key: impl Into<String>,
        api_base: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            api_key: api_key.into(),
            api_base: api_base.into(),
            model: model.into(),
            // 音乐生成耗时较长（30-90s），timeout 放宽到 3 分钟
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(180))
                .build()
                .unwrap_or_default(),
        }
    }

    /// 下载远程音频到本地缓存目录，返回本地路径
    pub async fn download_audio(
        &self,
        url: &str,
        dest: &std::path::Path,
    ) -> orange_core::Result<String> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| orange_core::CoreError::AiService(format!("创建缓存目录失败: {e}")))?;
        }
        let bytes = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?
            .bytes()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;
        std::fs::write(dest, &bytes)
            .map_err(|e| orange_core::CoreError::AiService(format!("写入音频文件失败: {e}")))?;
        Ok(dest.to_string_lossy().into_owned())
    }
}

#[async_trait]
impl AudioAIProvider for MiniMaxProvider {
    fn name(&self) -> &str {
        "MiniMax"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            music_generation: true,
            // 写词走独立 LLM 路径（orange-ai 的 MinimaxProvider），不在本 provider
            lyrics_writing: false,
            // 5 轨 STEM 分离 MiniMax 暂无独立端点，本 provider 通过双调用提供人声/伴奏
            stem_separation: true,
            // 独立 TTS 演唱留给后续；音乐生成已含人声
            vocal_synthesis: false,
            voice_cloning: false,
        }
    }

    async fn generate(&self, request: &GenerationRequest) -> orange_core::Result<GenerationResult> {
        let url = format!(
            "{}/v1/music_generation",
            self.api_base.trim_end_matches('/')
        );

        // is_instrumental：从 params 取，默认 false（带人声演唱）
        let is_instrumental = request
            .params
            .get("is_instrumental")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // 歌词：为空时让 MiniMax 自动生成（传空字符串会触发 lyrics_optimizer 自动写词）
        let lyrics = request.lyrics.clone().unwrap_or_default();

        let body = serde_json::json!({
            "model": self.model,
            "prompt": request.style_prompt,
            "lyrics": lyrics,
            "is_instrumental": is_instrumental,
            "lyrics_optimizer": true,
            // format 是「音频编码格式」(mp3/wav/pcm/flac)，不是返回方式。
            // MiniMax 始终通过 data.audio_url 返回 URL，与此字段无关。
            // 之前传 "url" 会触发服务端 2013: invalid params, audio format: url is not allowed
            "audio_setting": {
                "sample_rate": 44100,
                "bitrate": 256000,
                "format": "mp3",
                "channel": 2
            }
        });

        tracing::info!(
            "MiniMax music_generation: model={}, instrumental={}, prompt_len={}",
            self.model,
            is_instrumental,
            request.style_prompt.len()
        );

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| orange_core::CoreError::Network(e.to_string()))?;

        if !status.is_success() {
            return Err(orange_core::CoreError::AiService(format!(
                "MiniMax music_generation HTTP {}: {}",
                status,
                &text[..text.len().min(400)]
            )));
        }

        let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            orange_core::CoreError::AiService(format!("解析 MiniMax 响应失败: {e}"))
        })?;

        // base_resp 校验（MiniMax 错误码格式）
        if let Some(status_code) = v
            .get("base_resp")
            .and_then(|b| b.get("status_code"))
            .and_then(|s| s.as_i64())
        {
            if status_code != 0 {
                let msg = v
                    .get("base_resp")
                    .and_then(|b| b.get("status_msg"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("未知错误");
                return Err(orange_core::CoreError::AiService(format!(
                    "MiniMax 错误 [{status_code}]: {msg}"
                )));
            }
        }

        // 提取音频 URL：兼容 data.audio / data.audio_url / data.url
        let audio_url = v
            .get("data")
            .and_then(|d| {
                d.get("audio_url")
                    .or_else(|| d.get("audio"))
                    .or_else(|| d.get("url"))
            })
            .and_then(|u| u.as_str())
            .ok_or_else(|| {
                orange_core::CoreError::AiService(format!(
                    "MiniMax 响应缺少音频 URL: {}",
                    &text[..text.len().min(300)]
                ))
            })?
            .to_string();

        // 从 extra_info 提取时长（秒）
        let duration_secs = v
            .get("extra_info")
            .and_then(|e| e.get("audio_length"))
            .and_then(|a| a.as_f64())
            .map(|s| s as f32);

        // 生成任务 ID（同步接口无 task_id，用本地标识）
        let task_id = v
            .get("data")
            .and_then(|d| d.get("task_id"))
            .and_then(|t| t.as_str())
            .map(String::from)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        if let Some(d) = duration_secs {
            tracing::info!("MiniMax 生成成功: task={}, 时长约 {:.0}s", task_id, d);
        } else {
            tracing::info!("MiniMax 生成成功: task={}", task_id);
        }

        Ok(GenerationResult {
            task_id,
            audio_url: Some(audio_url),
            stems: None,
            status: GenerationStatus::Succeeded,
            error: None,
        })
    }

    async fn query(&self, _task_id: &str) -> orange_core::Result<GenerationResult> {
        // music_generation 是同步接口，无独立查询端点
        Err(orange_core::CoreError::Unsupported(
            "MiniMax music_generation 是同步接口，无需查询任务状态".into(),
        ))
    }
}
