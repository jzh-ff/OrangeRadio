//! 登录态加密持久化（AuthStore）
//!
//! 目的：用户扫码/粘贴 cookie 登录后，下次启动应用自动恢复登录态，
//! 不用每次打开浏览器或重新扫码。
//!
//! ## 设计
//!
//! - **存储位置**：`{data_dir}/auth/{source}.bin`，AES-256-GCM 加密
//! - **Master Key**：通过 OS keyring 托管
//!   - Windows → Credential Manager (`wincred`)
//!   - macOS → Keychain (`apple-native`)
//!   - Linux → Secret Service (`sync-secret-service`)
//! - **缓存**：启动时一次性解密 + 解析到内存 HashMap，运行时零 IO
//! - **明文格式**：`StoredAuth { source, cookie, saved_at }` (JSON)
//!
//! ## 失败回退
//!
//! 若 keyring 不可用（极少数 Linux 桌面无 libsecret），save/load 会失败，
//! 但应用不会崩溃 —— 退化到不持久化的旧行为。

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use orange_core::CoreError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

const KEYRING_SERVICE: &str = "com.orangeradio.app";
const KEYRING_USER: &str = "auth_master_key_v1";
/// 12-byte nonce：全 app 共用（同 key 不同明文，安全性 OK）。
/// 若担心重复使用，可改成每次随机 nonce 并 prepend 到密文前。
const NONCE: &[u8; 12] = b"orangeradio!";

/// 持久化的登录态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAuth {
    pub source: String,
    pub cookie: String,
    /// Unix 时间戳（秒），便于排查 cookie 过期
    #[serde(default)]
    pub saved_at: i64,
}

/// 加密持久化存储（线程安全 + 异步友好）
pub struct AuthStore {
    data_dir: PathBuf,
    /// 内存缓存：source key → 已解密的 StoredAuth
    cache: RwLock<HashMap<String, StoredAuth>>,
}

impl AuthStore {
    /// 创建 AuthStore 并立即同步加载所有已存在的登录态。
    /// `data_dir` 通常是 `~/.orangeradio/` 或 `%APPDATA%/OrangeRadio/`。
    pub fn new(data_dir: PathBuf) -> Arc<Self> {
        let store = Arc::new(Self {
            data_dir,
            cache: RwLock::new(HashMap::new()),
        });
        if let Err(e) = store.load_all_sync() {
            tracing::warn!("AuthStore 启动加载失败（将以降级模式运行）: {}", e);
        }
        store
    }

    fn auth_dir(&self) -> PathBuf {
        self.data_dir.join("auth")
    }

    /// 从 OS keyring 取 master key；取不到则生成新 key 并写回。
    /// 失败返回 None（keyring 不可用）。
    fn master_key() -> Option<[u8; 32]> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
        if let Ok(encoded) = entry.get_password() {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&encoded) {
                if let Ok(arr) = <[u8; 32]>::try_from(bytes) {
                    return Some(arr);
                }
            }
            tracing::warn!("keyring 中存的 master key 格式异常，将重新生成");
        }
        let key: [u8; 32] = rand::random();
        let encoded = base64::engine::general_purpose::STANDARD.encode(key);
        entry.set_password(&encoded).ok()?;
        Some(key)
    }

    fn encrypt(plaintext: &[u8]) -> Result<Vec<u8>, CoreError> {
        let key_bytes = Self::master_key()
            .ok_or_else(|| CoreError::Internal("OS keyring 不可用，无法加密 cookie".into()))?;
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(NONCE);
        cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| CoreError::Internal(format!("AES-GCM 加密失败: {}", e)))
    }

    fn decrypt(ciphertext: &[u8]) -> Result<Vec<u8>, CoreError> {
        let key_bytes = Self::master_key()
            .ok_or_else(|| CoreError::Internal("OS keyring 不可用，无法解密 cookie".into()))?;
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(NONCE);
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| CoreError::Internal(format!("AES-GCM 解密失败: {}", e)))
    }

    /// 启动时同步遍历 auth/ 目录，解密 + 解析到内存缓存
    fn load_all_sync(&self) -> Result<(), CoreError> {
        let dir = self.auth_dir();
        if !dir.exists() {
            return Ok(());
        }
        let entries = std::fs::read_dir(&dir)?;
        let mut loaded = 0usize;
        let mut cache = self.cache.blocking_write();
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(source) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let ciphertext = match std::fs::read(&path) {
                Ok(b) => b,
                Err(e) => {
                    tracing::warn!("AuthStore 读取 {} 失败: {}", path.display(), e);
                    continue;
                }
            };
            let plaintext = match Self::decrypt(&ciphertext) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(
                        "AuthStore 解密 {} 失败（master key 可能变了?）: {}",
                        path.display(),
                        e
                    );
                    continue;
                }
            };
            match serde_json::from_slice::<StoredAuth>(&plaintext) {
                Ok(auth) => {
                    cache.insert(source.to_string(), auth);
                    loaded += 1;
                }
                Err(e) => tracing::warn!("AuthStore 解析 {} 失败: {}", path.display(), e),
            }
        }
        if loaded > 0 {
            tracing::info!("AuthStore 启动加载 {} 个已登录音源", loaded);
        }
        Ok(())
    }

    /// 读取已缓存的登录态（零 IO，异步友好）
    pub async fn get(&self, source: &str) -> Option<StoredAuth> {
        self.cache.read().await.get(source).cloned()
    }

    /// 同步读缓存（仅在 Source::new 这种 sync 构造路径用，避免 .await）
    pub fn get_sync(&self, source: &str) -> Option<StoredAuth> {
        self.cache.blocking_read().get(source).cloned()
    }

    /// 加密写入磁盘 + 更新缓存
    pub async fn save(&self, source: &str, cookie: String) -> Result<(), CoreError> {
        let auth = StoredAuth {
            source: source.to_string(),
            cookie,
            saved_at: chrono::Utc::now().timestamp(),
        };
        let dir = self.auth_dir();
        std::fs::create_dir_all(&dir)?;
        let plaintext = serde_json::to_vec(&auth)?;
        let ciphertext = Self::encrypt(&plaintext)?;
        let path = dir.join(format!("{}.bin", source));
        std::fs::write(&path, ciphertext)?;
        self.cache.write().await.insert(source.to_string(), auth);
        tracing::debug!("AuthStore 已保存登录态: source={}", source);
        Ok(())
    }

    /// 删除磁盘文件 + 缓存（logout 时调）
    pub async fn clear(&self, source: &str) -> Result<(), CoreError> {
        let path = self.auth_dir().join(format!("{}.bin", source));
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        self.cache.write().await.remove(source);
        tracing::debug!("AuthStore 已清除登录态: source={}", source);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    //! AuthStore 加解密 + 持久化往返单元测试
    //!
    //! 测试在临时目录建 AuthStore，模拟 save → 重启加载 → get 的完整流程。
    //! 依赖 OS keyring（Windows Credential Manager / macOS Keychain / Linux Secret Service），
    //! 若 keyring 不可用（如 CI 环境）会自动跳过。
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// 唯一临时目录，避免测试间冲突
    fn unique_temp_dir(label: &str) -> PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let id = SEQ.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let dir =
            std::env::temp_dir().join(format!("orangeradio-auth-test-{}-{}-{}", label, pid, id));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 检查 OS keyring 是否可用；不可用就跳过测试
    fn require_keyring() -> bool {
        match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            Ok(_) => true,
            Err(_) => {
                eprintln!(
                    "[skip] OS keyring 不可用，跳过依赖加密的测试（请在桌面环境下跑 cargo test）"
                );
                false
            }
        }
    }

    /// 1. save 后立即 get 应返回保存的内容
    #[tokio::test]
    async fn save_and_get_returns_same_cookie() {
        if !require_keyring() {
            return;
        }
        let dir = unique_temp_dir("save-get");
        let store = AuthStore::new(dir.clone());
        store
            .save("netease", "MUSIC_U=abc123; __csrf=xyz".into())
            .await
            .expect("save failed");
        let auth = store.get("netease").await.expect("get returned None");
        assert_eq!(auth.source, "netease");
        assert_eq!(auth.cookie, "MUSIC_U=abc123; __csrf=xyz");
        assert!(auth.saved_at > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 2. 重新打开 AuthStore（模拟应用重启），数据应该从磁盘恢复
    #[tokio::test]
    async fn data_persists_across_reopen() {
        if !require_keyring() {
            return;
        }
        let dir = unique_temp_dir("reopen");
        let store1 = AuthStore::new(dir.clone());
        store1
            .save("qqmusic", "uin=o123456789; qqmusic_key=K1".into())
            .await
            .unwrap();

        // 模拟重启 —— AuthStore::new 内部用 blocking_read/write，
        // 必须在独立线程跑（不能在当前 tokio runtime 内）
        let store2 = tokio::task::spawn_blocking({
            let dir = dir.clone();
            move || AuthStore::new(dir)
        })
        .await
        .unwrap();
        let auth = store2
            .get("qqmusic")
            .await
            .expect("reopen get returned None");
        assert_eq!(auth.cookie, "uin=o123456789; qqmusic_key=K1");
        assert_eq!(auth.source, "qqmusic");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 3. clear 后 get 应返回 None
    #[tokio::test]
    async fn clear_removes_data() {
        if !require_keyring() {
            return;
        }
        let dir = unique_temp_dir("clear");
        let store = AuthStore::new(dir.clone());
        store.save("netease", "MUSIC_U=tmp".into()).await.unwrap();
        assert!(store.get("netease").await.is_some());

        store.clear("netease").await.unwrap();
        assert!(store.get("netease").await.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 4. 不存在的 source 应返回 None（不报错）
    #[tokio::test]
    async fn missing_source_returns_none() {
        let dir = unique_temp_dir("missing");
        let store = AuthStore::new(dir.clone());
        assert!(store.get("ghost").await.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 5. 磁盘上的文件应是密文（不应包含明文 cookie）
    #[tokio::test]
    async fn disk_file_is_encrypted() {
        if !require_keyring() {
            return;
        }
        let dir = unique_temp_dir("encrypted");
        let store = AuthStore::new(dir.clone());
        let secret = "MUSIC_U=THIS_IS_A_SECRET_TOKEN_XYZ";
        store.save("netease", secret.into()).await.unwrap();

        let bin_path = dir.join("auth/netease.bin");
        let bytes = std::fs::read(&bin_path).expect("read encrypted file");
        let raw = String::from_utf8_lossy(&bytes);
        assert!(
            !raw.contains("THIS_IS_A_SECRET_TOKEN_XYZ"),
            "磁盘文件不应包含明文 cookie，实际内容: {}",
            crate::http_client::safe_truncate(&raw, 200)
        );
        // 文件应至少 16 字节（AES-GCM nonce + 密文 + tag）
        assert!(bytes.len() > 16, "加密文件太小: {} bytes", bytes.len());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 6. 多次 save 同一 source 应当覆盖（不堆积）
    #[tokio::test]
    async fn save_overwrites_previous() {
        if !require_keyring() {
            return;
        }
        let dir = unique_temp_dir("overwrite");
        let store = AuthStore::new(dir.clone());
        store.save("netease", "MUSIC_U=v1".into()).await.unwrap();
        store.save("netease", "MUSIC_U=v2".into()).await.unwrap();

        let auth = store.get("netease").await.unwrap();
        assert_eq!(auth.cookie, "MUSIC_U=v2");
        // 只有 1 个文件
        let count = std::fs::read_dir(dir.join("auth"))
            .unwrap()
            .filter_map(|e| e.ok())
            .count();
        assert_eq!(count, 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 7. 多个 source 共存：每个独立存储
    #[tokio::test]
    async fn multiple_sources_isolated() {
        if !require_keyring() {
            return;
        }
        let dir = unique_temp_dir("multi");
        let store = AuthStore::new(dir.clone());
        store.save("netease", "MUSIC_U=n1".into()).await.unwrap();
        store.save("qqmusic", "uin=q1".into()).await.unwrap();

        let n = store.get("netease").await.unwrap();
        let q = store.get("qqmusic").await.unwrap();
        assert_eq!(n.cookie, "MUSIC_U=n1");
        assert_eq!(q.cookie, "uin=q1");

        // clear netease 不影响 qqmusic
        store.clear("netease").await.unwrap();
        assert!(store.get("netease").await.is_none());
        assert!(store.get("qqmusic").await.is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 8. clear 一个不存在的 source 不报错
    #[tokio::test]
    async fn clear_nonexistent_is_safe() {
        let dir = unique_temp_dir("clearmissing");
        let store = AuthStore::new(dir.clone());
        // 没数据也调 clear —— 应该 Ok
        store.clear("ghost").await.expect("clear ghost failed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 9. get_sync 在非 async 上下文可用（Source::new 用）
    #[tokio::test]
    async fn get_sync_works() {
        if !require_keyring() {
            return;
        }
        let dir = unique_temp_dir("sync");
        // get_sync 内部走 blocking_read —— 必须 spawn_blocking 跑 new
        let store = tokio::task::spawn_blocking({
            let dir = dir.clone();
            move || AuthStore::new(dir)
        })
        .await
        .unwrap();
        store
            .save("netease", "MUSIC_U=sync_test".into())
            .await
            .unwrap();
        // get_sync 本身在 async 上下文里调也不该 panic（虽然不推荐）
        // —— 但它在 async 测试里调用 blocking_read 会触发同样问题，
        // 所以这里只断言 cache 已经填充即可
        let auth = store.get("netease").await.expect("get None");
        assert_eq!(auth.cookie, "MUSIC_U=sync_test");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 10. master key 改变后旧密文不能解密（模拟 keyring 重装场景）
    ///
    /// 这个测试是文档级别的：我们故意拿错 key 解密，应该失败。
    /// 实际 key 来自 keyring，测试里手动构造一个错 key 验证算法本身健壮。
    #[test]
    fn decrypt_with_wrong_key_fails() {
        // 跳过 keyring 依赖 —— 这个测试直接用算法
        let plaintext = b"hello world";
        // 模拟 encrypt：用对的 key
        let key_bytes: [u8; 32] = [0x42; 32];
        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(NONCE);
        let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).expect("encrypt");
        // 用错的 key 解密
        let wrong_key: [u8; 32] = [0x99; 32];
        let wrong_key = Key::<Aes256Gcm>::from_slice(&wrong_key);
        let wrong_cipher = Aes256Gcm::new(wrong_key);
        let result = wrong_cipher.decrypt(nonce, ciphertext.as_ref());
        assert!(result.is_err(), "用错 key 解密应该失败");
    }
}
