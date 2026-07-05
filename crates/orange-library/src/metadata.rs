//! 元数据读取器 (基于 lofty 0.21)

use crate::scanner::SOURCE_ID_LOCAL;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::prelude::ItemKey;
use orange_core::audio_format::{AudioFormat, Quality};
use orange_core::source::SourceId;
use orange_core::track::{Artwork, ArtworkSource, Track, TrackMeta};
use orange_core::Result;
use std::path::Path;

/// 从音频文件读取元数据并构建 Track
pub fn read_track(path: &Path, source_id: SourceId) -> Result<Track> {
    let source_track_id = path.to_string_lossy().to_string();
    let format =
        AudioFormat::from_extension(path.extension().and_then(|e| e.to_str()).unwrap_or(""));

    let mut meta = TrackMeta::default();

    match lofty::read_from_path(path) {
        Ok(tagged_file) => {
            if let Some(tag) = tagged_file.primary_tag() {
                meta.title = tag
                    .get(&ItemKey::TrackTitle)
                    .and_then(|v| v.value().text().map(str::to_string))
                    .unwrap_or_else(|| {
                        path.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("未知曲目")
                            .to_string()
                    });

                meta.artist = tag
                    .get(&ItemKey::TrackArtist)
                    .or_else(|| tag.get(&ItemKey::AlbumArtist))
                    .and_then(|v| v.value().text().map(str::to_string))
                    .unwrap_or_else(|| "未知艺术家".into());

                meta.album = tag
                    .get(&ItemKey::AlbumTitle)
                    .and_then(|v| v.value().text().map(str::to_string));

                meta.album_artist = tag
                    .get(&ItemKey::AlbumArtist)
                    .and_then(|v| v.value().text().map(str::to_string));

                meta.year = tag
                    .get(&ItemKey::Year)
                    .and_then(|v| v.value().text())
                    .and_then(|s| s.parse().ok());

                meta.track_number = tag
                    .get(&ItemKey::TrackNumber)
                    .and_then(|v| v.value().text())
                    .and_then(|s| s.parse().ok());

                meta.genre = tag
                    .get(&ItemKey::Genre)
                    .and_then(|v| v.value().text().map(|s| vec![s.to_string()]))
                    .unwrap_or_default();

                // 内嵌歌词（USLT/LRC），让本地曲目也能显示歌词（LRC 有时间戳会按行滚动）
                meta.lyrics = tag
                    .get(&ItemKey::Lyrics)
                    .and_then(|v| v.value().text().map(str::to_string));

                meta.composer = tag
                    .get(&ItemKey::Composer)
                    .and_then(|v| v.value().text().map(str::to_string));

                if !tag.pictures().is_empty() {
                    // 提取第一张图片字节到磁盘，存为 Local path（前端用 convertFileSrc 访问）
                    if let Some(pic) = tag.pictures().first() {
                        if let Some(path) = extract_cover_to_disk(pic.data(), pic.mime_type()) {
                            meta.artwork = Some(Artwork {
                                source: ArtworkSource::Local { path },
                                dominant_color: None,
                                palette: vec![],
                            });
                        }
                    }
                }
            }

            // 时长（需要 AudioFile trait）
            let d = tagged_file.properties().duration().as_secs_f64();
            if d > 0.0 {
                meta.duration_secs = Some(d);
            }
        }
        Err(e) => {
            tracing::warn!("读取元数据失败 {:?}: {}", path, e);
            meta.title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("未知曲目")
                .to_string();
            meta.artist = "未知艺术家".into();
        }
    }

    let mut track = Track::new(source_id, source_track_id, meta);
    track.format = format;
    track.quality = if format.is_lossless() {
        Quality::Lossless
    } else {
        Quality::High
    };
    Ok(track)
}

pub fn local_source_id() -> SourceId {
    SOURCE_ID_LOCAL
}

/// 封面图提取到磁盘缓存目录
///
/// 策略：用图片字节内容的 FNV-1a 哈希命名（避免重复提取同一张图）。
/// 写到 `<cwd>/.orangeradio/covers/<hash>.<ext>`。返回磁盘绝对路径。
/// 若文件已存在则跳过写入（命中缓存）。
fn extract_cover_to_disk(data: &[u8], mime: Option<&lofty::picture::MimeType>) -> Option<String> {
    use std::io::Write;

    // 简单哈希（FNV-1a 64bit）——不引入额外依赖
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in data {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }

    // 扩展名：从 MimeType 推断，默认 jpg
    let ext = match mime {
        Some(lofty::picture::MimeType::Png) => "png",
        Some(lofty::picture::MimeType::Gif) => "gif",
        Some(lofty::picture::MimeType::Bmp) => "bmp",
        Some(lofty::picture::MimeType::Tiff) => "tiff",
        _ => "jpg",
    };

    let covers_dir = std::env::current_dir()
        .ok()?
        .join(".orangeradio")
        .join("covers");
    std::fs::create_dir_all(&covers_dir).ok()?;
    let file_path = covers_dir.join(format!("{:x}.{}", hash, ext));

    // 命中缓存：文件已存在则直接返回
    if !file_path.exists() {
        let mut f = std::fs::File::create(&file_path).ok()?;
        f.write_all(data).ok()?;
    }

    file_path.to_str().map(String::from)
}
