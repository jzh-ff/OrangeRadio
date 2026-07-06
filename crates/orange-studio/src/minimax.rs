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
//! MiniMax music_generation 是**同步**接口：一次 POST 直接返回生成的音频
//! （耗时约 30-90 秒）。因此 `query()` 保留 trait 形状但返回 `Unsupported`。
//!
//! ## 返回格式（重要，曾踩坑）
//! MiniMax 通过请求体的 `stream` 字段控制返回方式：
//! - `stream: false`（本项目默认）→ `data.audio_url` 是一个 24h 内有效的下载 URL。
//! - `stream: true` → 走 SSE 分片，`data.audio` 是 hex 编码的字节流（仅此模式可用）。
//!
//! 实测中即便我们传 `stream: false`，个别账号/网关也会把 hex 字节直接塞进
//! `data.audio` 字段返回（而非走 URL）。因此本实现的响应解析做**双模兼容**：
//! 先按 URL 解析 `data.audio_url`/`data.url`/`data.audio`；若 `data.audio` 不是
//! 合法 URL 而是一串 hex，则就地解码落盘（不经过 download_audio）。
//! 这样无论 MiniMax 返回哪种格式都能正确产出本地音频文件。

use std::time::Duration;

use crate::provider::*;
use async_trait::async_trait;

/// 判断 MiniMax 返回的字符串是「URL 或路径」还是「hex 字节流」。
///
/// 判定准则（保守，宁可误判为 URL 走 normalize 再失败，也不要把真 URL 当 hex 解码）：
/// - 以 `http://` / `https://` / `file://` 开头 → URL
/// - 以 `/` 开头（绝对路径或相对路径）→ 路径
/// - 其他 → 视为 hex，交给 hex 解码处理
///
/// 注意：MiniMax 的 hex 字节流通常极长（几十 KB 起步）且只含 0-9a-f，
/// 不会以 http(s):// 或 / 开头，所以这个判据在实践中是可靠的。
fn looks_like_url_or_path(s: &str) -> bool {
    let t = s.trim();
    t.starts_with("http://")
        || t.starts_with("https://")
        || t.starts_with("file://")
        || t.starts_with('/')
}

/// 把 MiniMax 返回的音频 URL 规范化为合法的绝对 http(s) URL。
///
/// 处理三种异常情况（否则会漏到下载阶段，被 reqwest 报成无意义的
/// "builder error"）：
/// - 空字符串 / 仅空白 → Err("audio_url 为空")
/// - 合法绝对 http(s) URL → 原样返回
/// - 相对路径（如第三方代理返回 `/files/xxx.mp3`）→ 拼接到 `api_base`
/// - 非 http(s) scheme 或无法解析 → Err
fn normalize_audio_url(raw: &str, api_base: &str) -> Result<String, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("audio_url 为空字符串");
    }
    // 已经是合法绝对 URL 且 http(s)
    if let Ok(u) = url::Url::parse(trimmed) {
        if matches!(u.scheme(), "http" | "https") {
            return Ok(trimmed.to_string());
        }
        return Err("audio_url 非 http(s) scheme");
    }
    // 否则当作相对路径，拼到 api_base（去掉多余斜杠）
    if trimmed.starts_with('/') {
        let base = api_base.trim_end_matches('/');
        return Ok(format!("{base}{trimmed}"));
    }
    Err("audio_url 既非绝对 URL 也非以 / 开头的相对路径")
}

/// 脱敏 URL 用于日志：保留 scheme://host/path，剥离 query（可能含签名 token）。
/// 解析失败则只保留前 64 个字符。
fn sanitize_url_for_log(url: &str) -> String {
    match url::Url::parse(url.trim()) {
        Ok(mut u) => {
            u.set_query(None);
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => {
            let max = url.len().min(64);
            format!("{}...(无法解析)", &url[..max])
        }
    }
}

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

    /// 下载远程音频到本地缓存目录，返回本地路径。
    ///
    /// 支持三种来源：
    /// - `http(s)://` —— 走 reqwest 下载（MiniMax URL 模式返回的 24h 有效链接）。
    /// - `file://` —— 本地文件，直接复制到 `dest`（hex 模式下 generate() 已先把
    ///   字节解码到系统 temp 目录，再以 file:// 形式回传给下游；这样下游调用链
    ///   stems.rs / commands.rs 完全无需感知 hex 模式）。
    pub async fn download_audio(
        &self,
        url: &str,
        dest: &std::path::Path,
    ) -> orange_core::Result<String> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| orange_core::CoreError::AiService(format!("创建缓存目录失败: {e}")))?;
        }
        // 入口防御：空 / 无法解析的 URL 会触发 reqwest "builder error"，
        // 这里拦截并报出有意义的错误（generate() 已校验，此处为二次保险，
        // 也能保护调用方直接传相对路径的场景）。
        let parsed = url::Url::parse(url).map_err(|e| {
            orange_core::CoreError::AiService(format!(
                "下载 URL 非法（无法解析）: {}（原因: {e}）",
                sanitize_url_for_log(url)
            ))
        })?;
        match parsed.scheme() {
            "http" | "https" => {}
            "file" => {
                let src = parsed.to_file_path().map_err(|()| {
                    orange_core::CoreError::AiService(format!(
                        "file:// 路径转换失败: {}",
                        sanitize_url_for_log(url)
                    ))
                })?;
                std::fs::copy(&src, dest).map_err(|e| {
                    orange_core::CoreError::AiService(format!(
                        "复制本地音频失败（{} → {}）: {e}",
                        src.display(),
                        dest.display()
                    ))
                })?;
                return Ok(dest.to_string_lossy().into_owned());
            }
            other => {
                return Err(orange_core::CoreError::AiService(format!(
                    "下载 URL 协议不支持（{other}）: {}",
                    sanitize_url_for_log(url)
                )));
            }
        }
        let url_for_err = sanitize_url_for_log(url);
        let bytes = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| {
                orange_core::CoreError::Network(format!("下载音频请求失败（{url_for_err}）: {e}"))
            })?
            .bytes()
            .await
            .map_err(|e| {
                orange_core::CoreError::Network(format!("读取音频数据失败（{url_for_err}）: {e}"))
            })?;
        std::fs::write(dest, &bytes)
            .map_err(|e| orange_core::CoreError::AiService(format!("写入音频文件失败: {e}")))?;
        Ok(dest.to_string_lossy().into_owned())
    }

    /// 把 MiniMax hex 模式返回的音频字节流解码后写到系统 temp 目录，
    /// 返回该 temp 文件的 `file://` URL。
    ///
    /// 当 MiniMax 在非流式请求里返回 `data.audio` 为 hex 字符串时（部分账号/网关
    /// 实际行为），不能走 `download_audio` 的网络分支 —— 直接解码写入 temp，
    /// 再由下游 `download_audio` 识别 file:// 协议复制到最终缓存目录。
    fn save_hex_to_temp(hex_str: &str, task_id: &str) -> orange_core::Result<String> {
        let bytes = hex::decode(hex_str.trim()).map_err(|e| {
            orange_core::CoreError::AiService(format!(
                "MiniMax data.audio 既不是合法 URL，hex 解码也失败: {e}"
            ))
        })?;
        if bytes.is_empty() {
            return Err(orange_core::CoreError::AiService(
                "MiniMax 返回的 hex 音频数据为空".into(),
            ));
        }
        let mut tmp = std::env::temp_dir();
        tmp.push(format!("orangeradio-minimax-{task_id}.mp3"));
        if let Some(parent) = tmp.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                orange_core::CoreError::AiService(format!("创建 temp 目录失败: {e}"))
            })?;
        }
        std::fs::write(&tmp, &bytes).map_err(|e| {
            orange_core::CoreError::AiService(format!("写入 temp 音频文件失败: {e}"))
        })?;
        // to_file_path 反过来用 Path → file:// URL：手工拼装，避免跨平台 URL 解析差异
        let path_str = tmp.to_string_lossy().replace('\\', "/");
        let prefixed = if path_str.starts_with('/') {
            format!("file://{path_str}")
        } else {
            format!("file:///{path_str}")
        };
        Ok(prefixed)
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
            // stream: false → 明确请求 MiniMax 返回 URL 形式（data.audio_url），
            // URL 在 24 小时内有效。stream:true 才会返回 hex 字节流。
            // （即便如此，部分网关仍可能把 hex 塞进 data.audio，下方响应解析做双模兼容。）
            "stream": false,
            // format 是「音频编码格式」(mp3/wav/pcm/flac)，**不是**「返回方式」。
            // 控制返回方式的是上面的 stream 字段。
            // 早期误把 format 当返回方式传 "url" 会触发服务端
            //   2013: invalid params, audio format: url is not allowed
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

        // 提取音频：MiniMax 有两种返回形态，本实现做双模兼容 ——
        //   (1) URL 模式（stream:false 的预期形态）：data.audio_url（或 data.url）
        //       是一个 http(s) 绝对 URL，24h 内可下载。
        //   (2) hex 模式（stream:true 的预期形态，但部分网关即便 stream:false
        //       也会返回）：data.audio 是一串 hex 编码的音频字节流。
        // 因此先按字段优先级取候选字符串，再根据内容形态分发处理。
        // 注意：data.audio 既可能是 URL（少见），也可能是 hex（实测踩坑），
        // 必须先看内容而不是字段名。
        let audio_raw = v
            .get("data")
            .and_then(|d| {
                d.get("audio_url")
                    .or_else(|| d.get("audio"))
                    .or_else(|| d.get("url"))
            })
            .and_then(|u| u.as_str())
            .ok_or_else(|| {
                orange_core::CoreError::AiService(format!(
                    "MiniMax 响应缺少音频字段（data.audio_url / data.audio / data.url 均无）: {}",
                    &text[..text.len().min(300)]
                ))
            })?;

        // 生成任务 ID（同步接口无 task_id，用本地标识）—— 提前算，hex 落盘要用
        let task_id = v
            .get("data")
            .and_then(|d| d.get("task_id"))
            .and_then(|t| t.as_str())
            .map(String::from)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // 双模分发：能解析为 http(s)/file 绝对 URL，或以 / 开头的相对路径 → URL 模式；
        // 否则一律当作 hex 字节流处理（先 hex 解码校验，失败再报「既不是 URL 也不是 hex」）。
        let audio_url = if looks_like_url_or_path(audio_raw) {
            normalize_audio_url(audio_raw, &self.api_base).map_err(|reason| {
                orange_core::CoreError::AiService(format!(
                    "MiniMax 返回的音频 URL 非法（{reason}），原始响应片段: {}",
                    &text[..text.len().min(300)]
                ))
            })?
        } else {
            // hex 模式：解码后落 temp，回传 file:// URL，由下游 download_audio 复制到缓存目录
            let hex_len = audio_raw.trim().len();
            let saved = Self::save_hex_to_temp(audio_raw, &task_id)?;
            tracing::info!(
                "MiniMax 返回 hex 模式音频（hex_len={hex_len}），已解码到 temp: {}",
                sanitize_url_for_log(&saved)
            );
            saved
        };

        // 从 extra_info 提取时长（秒）
        let duration_secs = v
            .get("extra_info")
            .and_then(|e| e.get("audio_length"))
            .and_then(|a| a.as_f64())
            .map(|s| s as f32);

        if let Some(d) = duration_secs {
            tracing::info!(
                "MiniMax 生成成功: task={}, 时长约 {:.0}s, audio_url={} (len={})",
                task_id,
                d,
                sanitize_url_for_log(&audio_url),
                audio_url.len()
            );
        } else {
            tracing::info!(
                "MiniMax 生成成功: task={}, audio_url={} (len={})",
                task_id,
                sanitize_url_for_log(&audio_url),
                audio_url.len()
            );
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
