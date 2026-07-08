//! # OrangeRadio Core
//!
//! OrangeRadio 系统的核心抽象层。定义了音源、播放器、AI、创作工作站
//! 等模块的统一 trait 接口。所有功能模块都基于这些抽象构建，
//! 保证可插拔、可扩展、可测试。
//!
//! ## 核心概念
//!
//! - [`Track`] —— 一首可播放的曲目（来自本地、网络电台或第三方平台）
//! - [` AudioSource`] —— 音源提供者（本地库、网易云、Spotify、网络电台...）
//! - [`Player`] —— 播放器内核（Hi-Res 解码 + DSP）
//! - [`PlaybackMode`] —— 播放模式（顺序/随机/循环/懂你模式）

pub mod audio_format;
pub mod error;
pub mod events;
pub mod player;
pub mod recommendation;
pub mod source;
pub mod track;
pub mod wallpaper_engine;

pub use audio_format::AudioFormat;
pub use error::{CoreError, Result};
pub use events::{AuthEventSink, AuthExpiredPayload, EventBus, EventSubscription, NoopAuthSink};
pub use player::{PlaybackMode, Player, PlayerEvent, PlayerState, RepeatMode};
pub use recommendation::{RecommendContext, RecommendationEngine, UserProfile};
pub use source::{
    AudioSource, AuthSource, PlaylistRef, QrCodeLogin, QrCodeStatus, SearchQuery, SearchResult,
    SourceId, SourceKind, StreamLocation, UserInfo,
};
pub use track::{Artwork, Track, TrackId, TrackMeta};

/// OrangeRadio 版本号
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;
    use source::{SearchQuery, SourceKind, StreamLocation};
    use track::{Track, TrackMeta};

    #[test]
    fn version_is_set() {
        assert!(!VERSION.is_empty());
        // 与 Cargo 包版本保持一致
        assert_eq!(VERSION, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn track_id_is_unique() {
        let a = track::TrackId::new();
        let b = track::TrackId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn track_default_values() {
        let source_id = source::SourceId(uuid::Uuid::new_v4());
        let t = Track::new(source_id, "/music/test.flac".into(), TrackMeta::default());
        assert_eq!(t.source_track_id, "/music/test.flac");
        assert_eq!(t.source_id, source_id);
        assert_eq!(t.source_kind, SourceKind::Local);
        assert!(!t.liked);
        assert_eq!(t.play_count, 0);
        assert!(t.is_hires() || !t.is_hires()); // 默认 format=Unknown 时应为 false
        assert!(!t.is_hires());
    }

    #[test]
    fn track_hires_detection() {
        let source_id = source::SourceId(uuid::Uuid::new_v4());
        let mut t = Track::new(source_id, "/music/test.flac".into(), TrackMeta::default());
        t.format = audio_format::AudioFormat::Flac;
        t.quality = audio_format::Quality::HiRes;
        assert!(t.is_hires());

        t.quality = audio_format::Quality::Standard;
        t.format = audio_format::AudioFormat::Flac;
        assert!(t.is_hires()); // FLAC 格式本身即视为 Hi-Res
    }

    #[test]
    fn audio_format_from_extension() {
        assert_eq!(
            audio_format::AudioFormat::from_extension("flac"),
            audio_format::AudioFormat::Flac
        );
        assert_eq!(
            audio_format::AudioFormat::from_extension(".mp3"),
            audio_format::AudioFormat::Mp3
        );
        assert_eq!(
            audio_format::AudioFormat::from_extension(".m4a"),
            audio_format::AudioFormat::Alac
        );
        assert_eq!(
            audio_format::AudioFormat::from_extension("xyz"),
            audio_format::AudioFormat::Unknown
        );
    }

    #[test]
    fn audio_format_lossless_and_hires() {
        assert!(audio_format::AudioFormat::Flac.is_lossless());
        assert!(audio_format::AudioFormat::Flac.is_hires());
        assert!(!audio_format::AudioFormat::Mp3.is_lossless());
        assert!(!audio_format::AudioFormat::Mp3.is_hires());
        assert!(!audio_format::AudioFormat::Unknown.is_lossless());
    }

    #[test]
    fn source_kind_default_is_local() {
        assert_eq!(SourceKind::default(), SourceKind::Local);
    }

    #[test]
    fn search_query_default_pagination() {
        let q = SearchQuery::default();
        assert_eq!(q.page, 1);
        assert_eq!(q.page_size, 30);
        assert!(q.kind.is_none());
    }

    #[test]
    fn stream_location_serializes_with_tag() {
        let loc = StreamLocation::Url {
            url: "https://example.com/song.mp3".into(),
            headers: vec![("Referer".into(), "https://music.163.com/".into())],
        };
        let json = serde_json::to_value(&loc).unwrap();
        assert_eq!(json["kind"], "url");
        assert_eq!(json["url"], "https://example.com/song.mp3");

        let file = StreamLocation::File {
            path: "/tmp/song.flac".into(),
        };
        let json = serde_json::to_value(&file).unwrap();
        assert_eq!(json["kind"], "file");
    }

    #[test]
    fn user_profile_defaults() {
        let p = recommendation::UserProfile::default();
        assert!(p.top_genres.is_empty());
        assert!(p.top_artists.is_empty());
        assert_eq!(p.hourly_activity.len(), 24);
        assert_eq!(p.bpm_preference.medium, 0.35);
    }

    #[test]
    fn playback_mode_values() {
        // 确保 PlaybackMode 枚举能正常序列化/反序列化
        use player::PlaybackMode;
        let modes = vec![
            PlaybackMode::Sequence,
            PlaybackMode::ListLoop,
            PlaybackMode::SingleLoop,
            PlaybackMode::Shuffle,
            PlaybackMode::UnderstandYou,
        ];
        for m in modes {
            let s = serde_json::to_string(&m).unwrap();
            let back: PlaybackMode = serde_json::from_str(&s).unwrap();
            assert_eq!(m, back);
        }
    }
}
