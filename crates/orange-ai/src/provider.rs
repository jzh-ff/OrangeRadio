//! 大模型 Provider 抽象
//!
//! 抽象为统一接口，后端可对接 GLM / OpenAI 兼容 API 等。
//! 用户可在设置中配置自己的 API Key 与 Base URL。

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// LLM 请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    /// 系统提示词
    pub system: Option<String>,
    /// 用户输入
    pub user: String,
    /// 温度 (0.0 - 2.0)
    pub temperature: Option<f32>,
    /// 最大 token
    pub max_tokens: Option<u32>,
}

/// LLM 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub text: String,
    /// 消耗 token 数
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub prompt: u32,
    pub completion: u32,
}

/// LLM Provider trait
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// 同步对话
    async fn chat(&self, request: &LlmRequest) -> orange_core::Result<LlmResponse>;

    /// 流式对话（SSE）
    async fn chat_stream(
        &self,
        request: &LlmRequest,
        _on_token: &(dyn Fn(&str) + Send + Sync),
    ) -> orange_core::Result<LlmResponse> {
        // 默认回退到同步
        self.chat(request).await
    }
}

/// 云端 LLM Provider (OpenAI 兼容协议)
pub struct CloudLlmProvider {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
    pub client: reqwest::Client,
}

impl CloudLlmProvider {
    pub fn new(
        api_base: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            api_base: api_base.into(),
            api_key: api_key.into(),
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl LlmProvider for CloudLlmProvider {
    async fn chat(&self, _request: &LlmRequest) -> orange_core::Result<LlmResponse> {
        // v0.5 实现完整 OpenAI 兼容请求
        Err(orange_core::CoreError::AiService(
            "云端 LLM 尚未实现 (v0.5)".into(),
        ))
    }
}

/// MiniMax LLM Provider（anthropic 兼容协议 POST {base}/v1/messages）
///
/// 用户配置：api_base（如 https://api.minimaxi.com/anthropic）+ api_key + model
/// （model 推荐 MiniMax-M1 / abab，可在 minimax 官网文档核对最新可用模型名）
pub struct MinimaxProvider {
    pub api_base: String,
    pub api_key: String,
    pub model: String,
    pub client: reqwest::Client,
}

impl MinimaxProvider {
    pub fn new(
        api_base: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            api_base: api_base.into(),
            api_key: api_key.into(),
            model: model.into(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }
}

#[async_trait]
impl LlmProvider for MinimaxProvider {
    async fn chat(&self, request: &LlmRequest) -> orange_core::Result<LlmResponse> {
        let url = format!("{}/v1/messages", self.api_base.trim_end_matches('/'));
        let body = serde_json::json!({
            "model": self.model,
            "max_tokens": request.max_tokens.unwrap_or(2048),
            "system": request.system.clone().unwrap_or_default(),
            "messages": [{"role": "user", "content": request.user}],
        });
        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
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
                "MiniMax LLM HTTP {}: {}",
                status,
                &text[..text.len().min(300)]
            )));
        }
        let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            orange_core::CoreError::AiService(format!("解析 MiniMax 响应失败: {e}"))
        })?;
        // anthropic 格式：{content: [{type:"text", text:"..."}], usage:{...}}
        let out = v["content"]
            .as_array()
            .and_then(|arr| {
                arr.iter()
                    .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
                    .next()
            })
            .unwrap_or("")
            .to_string();
        if out.is_empty() {
            return Err(orange_core::CoreError::AiService(format!(
                "MiniMax 返回空内容: {}",
                &text[..text.len().min(200)]
            )));
        }
        Ok(LlmResponse {
            text: out,
            usage: None,
        })
    }
}
