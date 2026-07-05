//! 本地库扫描器

use crate::metadata::read_track;
use orange_core::audio_format::AudioFormat;
use orange_core::source::SourceId;
use orange_core::track::Track;
use orange_core::Result;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use walkdir::WalkDir;

/// 本地音源固定的 SourceId（便于前端按来源筛选）
pub const SOURCE_ID_LOCAL: SourceId = SourceId(uuid::Uuid::from_u128(0x0001));

/// 扫描选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanOptions {
    /// 扫描根目录
    pub root_dirs: Vec<String>,
    /// 包含的格式
    pub formats: Vec<AudioFormat>,
    /// 是否递归
    pub recursive: bool,
    /// 是否提取封面
    pub extract_artwork: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            root_dirs: vec![],
            formats: vec![
                AudioFormat::Flac,
                AudioFormat::Wav,
                AudioFormat::Alac,
                AudioFormat::Mp3,
                AudioFormat::Aac,
                AudioFormat::Ogg,
            ],
            recursive: true,
            extract_artwork: true,
        }
    }
}

/// 本地库扫描器
pub struct LibraryScanner;

impl LibraryScanner {
    pub fn new() -> Self {
        Self
    }

    /// 扫描本地目录，返回发现的所有曲目
    pub async fn scan(&self, options: &ScanOptions) -> Result<Vec<Track>> {
        tracing::info!("开始扫描本地音乐库: {:?}", options.root_dirs);

        let formats = options.formats.clone();
        let dirs: Vec<String> = options.root_dirs.clone();
        let recursive = options.recursive;

        // 在阻塞线程池中执行文件 IO
        let tracks = tokio::task::spawn_blocking(move || -> Result<Vec<Track>> {
            let mut out = Vec::new();
            for dir in &dirs {
                let walker: Box<dyn Iterator<Item = walkdir::DirEntry>> = if recursive {
                    Box::new(WalkDir::new(dir).into_iter().filter_map(|e| e.ok()))
                } else {
                    Box::new(
                        WalkDir::new(dir)
                            .max_depth(1)
                            .into_iter()
                            .filter_map(|e| e.ok()),
                    )
                };

                for entry in walker {
                    if !entry.file_type().is_file() {
                        continue;
                    }
                    let path = entry.path();
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    let fmt = AudioFormat::from_extension(ext);
                    if !formats.contains(&fmt) {
                        continue;
                    }
                    match read_track(path, SOURCE_ID_LOCAL) {
                        Ok(t) => out.push(t),
                        Err(e) => {
                            tracing::warn!("跳过 {:?}: {}", path, e);
                        }
                    }
                }
            }
            Ok(out)
        })
        .await
        .map_err(|e| orange_core::CoreError::Internal(format!("扫描线程错误: {}", e)))??;

        tracing::info!("扫描完成，共 {} 首曲目", tracks.len());
        Ok(tracks)
    }
}

impl Default for LibraryScanner {
    fn default() -> Self {
        Self::new()
    }
}

// 保留以备将来使用
#[allow(dead_code)]
fn _unused_uuid() -> Uuid {
    Uuid::new_v4()
}
