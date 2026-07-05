//! STEM 分轨
//!
//! ## 当前能力（诚实说明）
//!
//! MiniMax 当前 API **无独立 5 轨 STEM 分离端点**。本模块的 `separate` 通过
//! 「同一 prompt 双调用」实现**人声/伴奏双轨**：
//! - 第一次 `is_instrumental=false` → 带人声演唱的完整版（vocals 轨）
//! - 第二次 `is_instrumental=true`  → 纯伴奏版（other 轨）
//!
//! 这是"分轨"的简化语义（两次生成而非对已有音频分离），消耗双倍额度。
//! 完整 5 轨（人声/鼓/贝斯/和声/其他）留待后续接入 Demucs 或厂商新端点。

use serde::{Deserialize, Serialize};

use crate::provider::AudioAIProvider;

/// 分轨类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StemKind {
    Vocals,  // 人声
    Drums,   // 鼓
    Bass,    // 贝斯
    Harmony, // 和声 / 其他乐器
    Other,   // 其他
}

/// 分轨结果（每项是本地音频文件路径）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Stems {
    pub vocals: Option<String>,
    pub drums: Option<String>,
    pub bass: Option<String>,
    pub harmony: Option<String>,
    pub other: Option<String>,
}

impl Stems {
    /// 获取指定类型的路径
    pub fn get(&self, kind: StemKind) -> Option<&str> {
        match kind {
            StemKind::Vocals => self.vocals.as_deref(),
            StemKind::Drums => self.drums.as_deref(),
            StemKind::Bass => self.bass.as_deref(),
            StemKind::Harmony => self.harmony.as_deref(),
            StemKind::Other => self.other.as_deref(),
        }
    }
}

/// 分轨器
///
/// 持有 `AudioAIProvider`（通常是 `MiniMaxProvider`），通过双调用产出人声/伴奏。
pub struct StemSeparator {
    provider: Box<dyn AudioAIProvider>,
}

impl StemSeparator {
    pub fn new(provider: Box<dyn AudioAIProvider>) -> Self {
        Self { provider }
    }

    /// 对已有生成结果做人声/伴奏分离
    ///
    /// **注意**：此方法会**重新生成两遍**音频（带唱 + 纯伴奏），而非对 `audio_url`
    /// 做后处理分离。这是因为 MiniMax 无独立 STEM 分离端点。两次生成会有风格/旋律
    /// 差异（同一 prompt 不同随机种子），适合"试听人声/伴奏"用途，不适合精确混音。
    ///
    /// `style_prompt` 和 `lyrics` 应与原始生成保持一致。
    pub async fn separate(
        &self,
        style_prompt: &str,
        lyrics: Option<&str>,
    ) -> orange_core::Result<Stems> {
        use crate::provider::{GenerationRequest, GenerationStatus};

        // 第一次：带人声
        let vocal_req = GenerationRequest {
            style_prompt: style_prompt.into(),
            duration_secs: None,
            need_stems: false,
            lyrics: lyrics.map(|s| s.to_string()),
            reference_audio_url: None,
            params: serde_json::json!({ "is_instrumental": false }),
        };
        let vocal_result = self.provider.generate(&vocal_req).await?;
        if vocal_result.status != GenerationStatus::Succeeded {
            return Err(orange_core::CoreError::AiService(
                vocal_result
                    .error
                    .unwrap_or_else(|| "人声轨生成失败".into()),
            ));
        }

        // 第二次：纯伴奏
        let instr_req = GenerationRequest {
            style_prompt: style_prompt.into(),
            duration_secs: None,
            need_stems: false,
            lyrics: lyrics.map(|s| s.to_string()),
            reference_audio_url: None,
            params: serde_json::json!({ "is_instrumental": true }),
        };
        let instr_result = self.provider.generate(&instr_req).await?;
        if instr_result.status != GenerationStatus::Succeeded {
            return Err(orange_core::CoreError::AiService(
                instr_result
                    .error
                    .unwrap_or_else(|| "伴奏轨生成失败".into()),
            ));
        }

        Ok(Stems {
            vocals: vocal_result.audio_url,
            drums: None,
            bass: None,
            harmony: None,
            other: instr_result.audio_url,
        })
    }
}
