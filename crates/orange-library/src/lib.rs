//! # OrangeRadio Library
//!
//! 本地音乐库管理。
//!
//! ## 职责
//! - 扫描本地音频文件，建立索引库（SQLite）
//! - 读取 / 写入元数据（ID3 / FLAC Vorbis / MP4 atoms）
//! - 听歌识曲：基于 chromaprint 声纹指纹识别环境中的歌曲
//! - 智能歌单生成

pub mod database;
pub mod fingerprint;
pub mod metadata;
pub mod scanner;

pub use database::{LibraryDb, UserPlaylist, FAVORITES_PLAYLIST_ID};
pub use fingerprint::FingerprintRecognizer;
pub use metadata::read_track;
pub use scanner::{LibraryScanner, ScanOptions};

#[cfg(test)]
mod tests {
    use super::*;
    use database::LibraryDb;
    use orange_core::audio_format::AudioFormat;
    use orange_core::source::SourceKind;
    use orange_core::track::{Track, TrackMeta};
    use std::path::PathBuf;

    fn make_track(title: &str, artist: &str, path: &str) -> Track {
        let meta = TrackMeta {
            title: title.into(),
            artist: artist.into(),
            ..Default::default()
        };
        let mut t = Track::new(scanner::SOURCE_ID_LOCAL, path.into(), meta);
        t.format = AudioFormat::Flac;
        t.source_kind = SourceKind::Local;
        t
    }

    #[test]
    fn local_source_id_is_stable() {
        // 本地音源固定 UUID，便于前端筛选与跨会话稳定
        let id = scanner::SOURCE_ID_LOCAL;
        assert_eq!(id.0, uuid::Uuid::from_u128(0x0001));
    }

    #[test]
    fn scan_options_default_formats() {
        let opts = ScanOptions::default();
        assert!(opts.recursive);
        assert!(opts.extract_artwork);
        assert!(opts.formats.contains(&AudioFormat::Flac));
        assert!(opts.formats.contains(&AudioFormat::Mp3));
        assert!(!opts.formats.contains(&AudioFormat::Dsd));
    }

    #[test]
    fn library_db_in_memory_basic() {
        let db = LibraryDb::new();
        assert_eq!(db.count(), 0);
        assert!(db.all().is_empty());

        let t = make_track("Test", "Artist", "/tmp/test.flac");
        db.add(t.clone());
        assert_eq!(db.count(), 1);
        assert_eq!(
            db.find_by_source_id("/tmp/test.flac").unwrap().meta.title,
            "Test"
        );
    }

    #[test]
    fn library_db_search_and_pagination() {
        let db = LibraryDb::new();
        db.add(make_track("Hello World", "A", "/a.flac"));
        db.add(make_track("Goodbye", "World Band", "/b.flac"));
        db.add(make_track("Other", "C", "/c.flac"));

        let mut q = orange_core::source::SearchQuery {
            keyword: "world".into(),
            page_size: 1,
            ..Default::default()
        };
        let page1 = db.search(&q);
        assert_eq!(page1.len(), 1);

        q.page = 2;
        let page2 = db.search(&q);
        assert_eq!(page2.len(), 1);
        assert_ne!(page1[0].source_track_id, page2[0].source_track_id);
    }

    #[test]
    fn library_db_playlist_roundtrip() {
        let dir =
            std::env::temp_dir().join(format!("orangeradio-lib-test-{}", uuid::Uuid::new_v4()));
        let db = LibraryDb::open(dir.join("library.sqlite")).unwrap();

        let pl_id = db.create_playlist("我的歌单").unwrap();
        let t = make_track("Playlist Song", "Artist", "/playlist/song.flac");
        db.add_to_playlist(&pl_id, &t).unwrap();

        let tracks = db.playlist_tracks(&pl_id, None, None).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].meta.title, "Playlist Song");

        let playlists = db.all_playlists().unwrap();
        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].name, "我的歌单");
        assert_eq!(playlists[0].track_count, 1);

        // 删除后验证
        db.delete_playlist(&pl_id).unwrap();
        assert!(db.all_playlists().unwrap().is_empty());
    }

    #[test]
    fn library_db_liked_roundtrip() {
        let db = LibraryDb::new();
        let mut t = make_track("Like Me", "Artist", "/like.flac");
        t.liked = true;
        db.add(t);
        assert_eq!(db.liked_tracks().len(), 1);
        assert_eq!(db.liked_tracks()[0].meta.title, "Like Me");
    }

    #[test]
    fn read_track_missing_file_falls_back_to_filename() {
        // lofty 读取失败时不返回 Err，而是回退到文件名作为标题
        let path = PathBuf::from("/nonexistent/orangeradio/test.flac");
        let result = metadata::read_track(&path, scanner::SOURCE_ID_LOCAL, None);
        assert!(result.is_ok());
        let track = result.unwrap();
        assert_eq!(track.meta.title, "test");
        assert_eq!(track.meta.artist, "未知艺术家");
        assert_eq!(track.format, AudioFormat::Flac);
    }
}
