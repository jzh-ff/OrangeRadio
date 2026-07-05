//! AI 歌词译注
//!
//! 实时翻译 + AI 标注歌词典故 / 彩蛋 / 创作背景，
//! 让听外语歌不再有门槛。

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::provider::{LlmProvider, LlmRequest};

/// 带注解的歌词行
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotatedLyricLine {
    /// 原文
    pub original: String,
    /// 译文
    pub translation: Option<String>,
    /// AI 注解（典故 / 彩蛋 / 创作背景）
    pub annotation: Option<String>,
    /// 时间戳（秒），同步歌词用
    pub timestamp: Option<f64>,
}

/// 带注解的完整歌词
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotatedLyrics {
    pub lines: Vec<AnnotatedLyricLine>,
    /// 歌曲整体背景介绍
    pub background: Option<String>,
}

/// 歌词译注器
pub struct LyricsTranslator {
    llm: Arc<dyn LlmProvider>,
}

impl LyricsTranslator {
    pub fn new(llm: Arc<dyn LlmProvider>) -> Self {
        Self { llm }
    }

    /// 翻译并注解歌词（调 LLM，返回译文 + 典故/背景注解）
    pub async fn translate(
        &self,
        lyrics: &str,
        source_lang: &str,
    ) -> orange_core::Result<AnnotatedLyrics> {
        let lang = if source_lang.is_empty() { "外文" } else { source_lang };
        let prompt = format!(
            "你是专业的音乐歌词译注 AI。把下面{lang}歌词逐行翻译成中文，\
             并对含有典故 / 彩蛋 / 文化背景的行加一句简短注解（没有就留空）。\
             严格只输出 JSON，格式：\n\
             {{\"background\":\"歌曲整体背景一句话\",\"lines\":[{{\"original\":\"原文行\",\"translation\":\"中文译文\",\"annotation\":\"注解或空字符串\"}}]}}\n\n\
             歌词：\n{lyrics}",
            lang = lang,
            lyrics = lyrics,
        );
        let req = LlmRequest {
            system: Some("你是专业的音乐歌词译注 AI，精通多语言与音乐文化背景。".into()),
            user: prompt,
            temperature: Some(0.3),
            max_tokens: Some(4096),
        };
        let resp = self.llm.chat(&req).await?;
        let json_str = extract_json_object(&resp.text);
        let v: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| orange_core::CoreError::AiService(format!("解析译注 JSON 失败: {e}")))?;

        let background = v
            .get("background")
            .and_then(|b| b.as_str())
            .map(String::from);
        let lines = v
            .get("lines")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|l| {
                        let original = l.get("original").and_then(|x| x.as_str())?.to_string();
                        if original.trim().is_empty() {
                            return None;
                        }
                        let translation = l
                            .get("translation")
                            .and_then(|x| x.as_str())
                            .map(String::from);
                        let annotation = l
                            .get("annotation")
                            .and_then(|x| x.as_str())
                            .filter(|s| !s.is_empty())
                            .map(String::from);
                        Some(AnnotatedLyricLine {
                            original,
                            translation,
                            annotation,
                            timestamp: None,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(AnnotatedLyrics { lines, background })
    }
}

/// 从 LLM 输出中抠出第一个 {...} JSON 对象（兼容 ```json 包裹）
fn extract_json_object(s: &str) -> String {
    if let Some(start) = s.find('{') {
        if let Some(end) = s.rfind('}') {
            return s[start..=end].to_string();
        }
    }
    s.to_string()
}
