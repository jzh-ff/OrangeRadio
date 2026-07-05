//! AI 写词
//!
//! 主题 / 情绪 / 风格 → 结构化歌词（主歌 / 副歌 / Bridge），
//! 支持押韵、段落控制、多语言。
//!
//! 通过 Anthropic 兼容协议（POST {base}/v1/messages）调用 LLM。

use serde::{Deserialize, Serialize};

/// 歌曲段落类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SongSection {
    Intro,
    Verse,     // 主歌
    PreChorus, // 预副歌
    Chorus,    // 副歌
    Bridge,    // 桥段
    Outro,
    Hook,
}

impl SongSection {
    /// MiniMax music_generation 期望的段落标签（如 [Verse]、[Chorus]）
    fn minimax_tag(self) -> &'static str {
        match self {
            SongSection::Intro => "[Intro]",
            SongSection::Verse => "[Verse]",
            SongSection::PreChorus => "[Pre-Chorus]",
            SongSection::Chorus => "[Chorus]",
            SongSection::Bridge => "[Bridge]",
            SongSection::Outro => "[Outro]",
            SongSection::Hook => "[Hook]",
        }
    }

    /// 从字符串解析段落类型（兼容 LLM 输出的各种格式）
    fn from_str_loose(s: &str) -> SongSection {
        let lower = s.to_lowercase();
        if lower.contains("intro") {
            SongSection::Intro
        } else if lower.contains("pre") {
            SongSection::PreChorus
        } else if lower.contains("chorus") {
            SongSection::Chorus
        } else if lower.contains("bridge") {
            SongSection::Bridge
        } else if lower.contains("outro") {
            SongSection::Outro
        } else if lower.contains("hook") {
            SongSection::Hook
        } else {
            SongSection::Verse
        }
    }
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

impl LyricsDraft {
    /// 渲染为 MiniMax music_generation 期望的歌词格式
    ///
    /// 格式：`[Verse]\n第一行\n第二行\n\n[Chorus]\n...`
    /// 每段用标签开头，行内换行，段落间空行分隔。
    pub fn to_minimax_lyrics(&self) -> String {
        let mut out = String::new();
        for (kind, lines) in &self.sections {
            out.push_str(kind.minimax_tag());
            out.push('\n');
            for line in lines {
                if !line.trim().is_empty() {
                    out.push_str(line.trim());
                    out.push('\n');
                }
            }
            out.push('\n');
        }
        out.trim_end().to_string()
    }
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
///
/// 通过 Anthropic 兼容协议调用 LLM（与 orange-ai/lyrics.rs 同样的接入方式）。
pub struct LyricsGenerator {
    llm_api_base: String,
    llm_api_key: String,
    llm_model: String,
    client: reqwest::Client,
}

impl LyricsGenerator {
    pub fn new(
        api_base: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            llm_api_base: api_base.into(),
            llm_api_key: api_key.into(),
            llm_model: model.into(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }

    /// 生成歌词（调 LLM，返回结构化歌词草稿）
    pub async fn generate(&self, request: &LyricsRequest) -> orange_core::Result<LyricsDraft> {
        let structure_hint = request
            .structure
            .iter()
            .map(|s| s.minimax_tag())
            .collect::<Vec<_>>()
            .join(" ");

        let prompt = format!(
            "你是专业作词人。请根据以下要求创作一首歌词：\n\
             - 主题：{theme}\n\
             - 情绪：{mood}\n\
             - 风格：{style}\n\
             - 语言：{language}\n\
             - 段落结构：{structure}\n\n\
             要求：每段 2-4 句，副歌要有记忆点和重复性，注意押韵。\n\
             严格只输出 JSON，格式如下（sections 是数组，每项是 [段落类型字符串, 歌词行数组]）：\n\
             {{\n\
               \"title\": \"歌曲标题\",\n\
               \"theme\": \"一句话主题\",\n\
               \"rhyme_scheme\": \"押韵方案如 AABB 或 ABAB，可为 null\",\n\
               \"sections\": [\n\
                 [\"verse\", [\"第一句\", \"第二句\"]],\n\
                 [\"chorus\", [\"副歌第一句\", \"副歌第二句\"]]\n\
               ]\n\
             }}",
            theme = if request.theme.is_empty() { "自由发挥" } else { &request.theme },
            mood = request.mood,
            style = request.style,
            language = request.language,
            structure = structure_hint,
        );

        let url = format!(
            "{}/v1/messages",
            self.llm_api_base.trim_end_matches('/')
        );
        let body = serde_json::json!({
            "model": self.llm_model,
            "max_tokens": 4096,
            "system": "你是专业音乐作词人，精通多语言歌词创作，擅长押韵与结构设计。",
            "messages": [{"role": "user", "content": prompt}],
        });

        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.llm_api_key)
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
                "AI 写词 HTTP {}: {}",
                status,
                &text[..text.len().min(300)]
            )));
        }

        let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            orange_core::CoreError::AiService(format!("解析 AI 写词响应失败: {e}"))
        })?;

        // Anthropic content 数组 → 文本
        let content = v
            .get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| {
                arr.iter()
                    .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
                    .next()
            })
            .unwrap_or("");

        let json_str = extract_json_object(content);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| {
            orange_core::CoreError::AiService(format!("解析歌词 JSON 失败: {e}"))
        })?;

        let title = parsed
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("无题")
            .to_string();
        let theme = parsed
            .get("theme")
            .and_then(|t| t.as_str())
            .unwrap_or(&request.theme)
            .to_string();
        let rhyme_scheme = parsed
            .get("rhyme_scheme")
            .and_then(|r| r.as_str())
            .map(String::from);

        let mut sections: Vec<(SongSection, Vec<String>)> = Vec::new();
        if let Some(arr) = parsed.get("sections").and_then(|s| s.as_array()) {
            for item in arr {
                // 兼容两种格式：["verse", ["line1","line2"]] 或 {"kind":"verse","lines":[...]}
                let (kind_str, lines) = if item.is_array() {
                    let arr = item.as_array().unwrap();
                    let kind = arr.get(0).and_then(|k| k.as_str()).unwrap_or("verse");
                    let lines = arr
                        .get(1)
                        .and_then(|l| l.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    (kind.to_string(), lines)
                } else {
                    let kind = item
                        .get("kind")
                        .and_then(|k| k.as_str())
                        .unwrap_or("verse");
                    let lines = item
                        .get("lines")
                        .and_then(|l| l.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    (kind.to_string(), lines)
                };
                sections.push((SongSection::from_str_loose(&kind_str), lines));
            }
        }

        if sections.is_empty() {
            return Err(orange_core::CoreError::AiService(
                "AI 写词返回空歌词，请重试或调整提示词".into(),
            ));
        }

        Ok(LyricsDraft {
            title,
            sections,
            theme,
            rhyme_scheme,
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minimax_lyrics_format() {
        let draft = LyricsDraft {
            title: "测试".into(),
            sections: vec![
                (SongSection::Verse, vec!["第一句".into(), "第二句".into()]),
                (SongSection::Chorus, vec!["副歌".into()]),
            ],
            theme: "主题".into(),
            rhyme_scheme: None,
        };
        let out = draft.to_minimax_lyrics();
        assert!(out.contains("[Verse]"));
        assert!(out.contains("[Chorus]"));
        assert!(out.contains("第一句"));
        assert!(out.contains("副歌"));
    }

    #[test]
    fn test_section_from_str_loose() {
        assert_eq!(SongSection::from_str_loose("Verse"), SongSection::Verse);
        assert_eq!(SongSection::from_str_loose("chorus"), SongSection::Chorus);
        assert_eq!(SongSection::from_str_loose("pre-chorus"), SongSection::PreChorus);
        assert_eq!(SongSection::from_str_loose("Bridge"), SongSection::Bridge);
        assert_eq!(SongSection::from_str_loose("unknown"), SongSection::Verse);
    }
}
