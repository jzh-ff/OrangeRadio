//! AI 歌词译注
//!
//! 实时翻译 + AI 标注歌词典故 / 彩蛋 / 创作背景，
//! 让听外语歌不再有门槛。

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::provider::LlmProvider;

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

    /// 翻译并注解歌词
    /// v0.5 实现：构造 prompt 调 LLM
    pub async fn translate(&self, _lyrics: &str, _source_lang: &str) -> orange_core::Result<AnnotatedLyrics> {
        Err(orange_core::CoreError::AiService("歌词译注尚未实现 (v0.5)".into()))
    }
}
