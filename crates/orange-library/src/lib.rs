//! # OrangeRadio Library
//!
//! 本地音乐库管理。
//!
//! ## 职责
//! - 扫描本地音频文件，建立索引库（SQLite）
//! - 读取 / 写入元数据（ID3 / FLAC Vorbis / MP4 atoms）
//! - 听歌识曲：基于 chromaprint 声纹指纹识别环境中的歌曲
//! - 智能歌单生成

pub mod scanner;
pub mod metadata;
pub mod fingerprint;
pub mod database;

pub use scanner::{LibraryScanner, ScanOptions};
pub use metadata::read_track;
pub use fingerprint::FingerprintRecognizer;
pub use database::LibraryDb;
