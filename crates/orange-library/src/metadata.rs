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
    let format = AudioFormat::from_extension(
        path.extension().and_then(|e| e.to_str()).unwrap_or(""),
    );

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

                meta.composer = tag
                    .get(&ItemKey::Composer)
                    .and_then(|v| v.value().text().map(str::to_string));

                if !tag.pictures().is_empty() {
                    meta.artwork = Some(Artwork {
                        source: ArtworkSource::Embedded {
                            track_id: orange_core::track::TrackId::new(),
                        },
                        dominant_color: None,
                        palette: vec![],
                    });
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
