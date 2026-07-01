//! # OrangeStudio —— AI 音乐创作工作站
//!
//! OrangeRadio 的核心差异化：专业级 AI 音乐创作能力。
//!
//! ## 全流程
//! ```text
//! 灵感输入 ──► AI 写词 ──► AI 作曲编曲 ──► AI 演唱
//!    │           │             │              │
//!    └─ 对话/哼唱  └─ MiniMax   └─ 生成+STEM   └─ TTS/音色克隆
//!                          │
//!                          ▼
//!              多轨 DAW 编辑 ──► AI 混音/母带 ──► 发布/导出
//!              (时间线/钢琴卷帘/混音台)  (响度归一/立体声拓宽)  (社区/商用)
//! ```
//!
//! ## 模块
//! - [`provider`] —— AudioAIProvider trait (MiniMax 等可插拔)
//! - [`lyrics`] —— AI 写词
//! - [`composition`] —— AI 作曲 / 编曲生成
//! - [`stems`] —— STEM 分轨（人声/鼓/贝斯/和声/其他）
//! - [`vocal`] —— AI 演唱 / 音色克隆
//! - [`project`] —— 创作工程文件 (.orp) 管理
//! - [`render`] —— 混音 / 母带渲染
//! - [`minimax`] —— MiniMax 官方对接

pub mod provider;
pub mod lyrics;
pub mod composition;
pub mod stems;
pub mod vocal;
pub mod project;
pub mod render;
pub mod minimax;

pub use provider::{AudioAIProvider, GenerationRequest, GenerationResult};
pub use lyrics::{LyricsGenerator, LyricsDraft, SongSection};
pub use composition::{Composer, CompositionStyle, CompositionResult};
pub use stems::{StemSeparator, Stems, StemKind};
pub use vocal::{VocalSynth, VoiceProfile};
pub use project::{StudioProject, ProjectTrack, ProjectClip};
pub use render::{ProjectRenderer, RenderOptions};
pub use minimax::MiniMaxProvider;
