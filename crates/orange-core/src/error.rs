//! 核心错误类型

use thiserror::Error;

/// OrangeRadio 核心错误
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("音源未找到: {0}")]
    SourceNotFound(String),

    #[error("曲目未找到: {0}")]
    TrackNotFound(String),

    #[error("解码失败: {0}")]
    DecodeFailed(String),

    #[error("音源不支持该操作: {0}")]
    Unsupported(String),

    #[error("网络错误: {0}")]
    Network(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("序列化错误: {0}")]
    Serialize(#[from] serde_json::Error),

    #[error("音源鉴权失败: {0}")]
    AuthFailed(String),

    #[error("AI 服务错误: {0}")]
    AiService(String),

    #[error("插件错误: {0}")]
    Plugin(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
