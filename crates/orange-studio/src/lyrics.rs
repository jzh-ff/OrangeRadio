//! AI 写词
//!
//! 主题 / 情绪 / 风格 → 结构化歌词（主歌 / 副歌 / Bridge），
//! 支持押韵、段落控制、多语言。

use serde::{Deserialize, Serialize};

/// 歌曲段落类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SongSection {
    Intro,
    Verse,      // 主歌
    PreChorus,  // 预副歌
    Chorus,     // 副歌
    Bridge,     // 桥段
    Outro,
    Hook,
}

/// 歌词草稿
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsDraft {
    pub title: String,
    pub sections: Vec<(SongSection, Vec<String>)>,
    /// 整体主题
    pub theme: String,
    /// 押韵方案
    pub rhyme_scheme: Option<String>,
}

/// 写词参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsRequest {
    pub theme: String,
    pub mood: String,
    pub style: String,
    pub language: String,
    /// 段落结构，如 ["verse", "chorus", "verse", "chorus", "bridge", "chorus"]
    pub structure: Vec<SongSection>,
}

impl Default for LyricsRequest {
    fn default() -> Self {
        Self {
            theme: String::new(),
            mood: "温暖".into(),
            style: "流行".into(),
            language: "中文".into(),
            structure: vec![
                SongSection::Verse,
                SongSection::Chorus,
                SongSection::Verse,
                SongSection::Chorus,
                SongSection::Bridge,
                SongSection::Chorus,
            ],
        }
    }
}

/// AI 写词器
pub struct LyricsGenerator {
    llm_api_base: String,
    llm_api_key: String,
    llm_model: String,
}

impl LyricsGenerator {
    pub fn new(api_base: impl Into<String>, api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            llm_api_base: api_base.into(),
            llm_api_key: api_key.into(),
            llm_model: model.into(),
        }
    }

    /// 生成歌词
    /// v0.6 实现：构造结构化 prompt 调 MiniMax LLM
    pub async fn generate(&self, _request: &LyricsRequest) -> orange_core::Result<LyricsDraft> {
        Err(orange_core::CoreError::AiService("AI写词尚未实现 (v0.6)".into()))
    }
}
