//! 网易云 weapi 加密
//!
//! 网易云 /weapi/* 接口需要加密参数：
//! - params: AES-CBC 加密（两次：presetKey 加密 payload，再随机 key 加密结果）
//! - encSecKey: RSA 加密随机 key（反转 + 大数模幂）

use base64::Engine;
use num_bigint::BigUint;
use rand::Rng;

const PRESET_KEY: &[u8; 16] = b"0CoJUm6Qyw8W8jud";
const IV: &[u8; 16] = b"0102030405060708";
const PUB_KEY: &str = "010001";
const MODULUS: &str = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

/// AES-CBC-128 加密（手动实现 CBC 链接 + PKCS7 填充，base64 输出）
fn aes_encrypt(data: &str, key: &[u8; 16]) -> String {
    use aes::cipher::{BlockEncrypt, KeyInit};
    let cipher = aes::Aes128::new(key.into());

    // PKCS7 填充
    let plaintext = data.as_bytes();
    let pad_len = 16 - (plaintext.len() % 16);
    let mut buf = Vec::with_capacity(plaintext.len() + pad_len);
    buf.extend_from_slice(plaintext);
    for _ in 0..pad_len {
        buf.push(pad_len as u8);
    }

    // CBC 模式：每块 XOR 前一块密文后加密
    let mut result = Vec::with_capacity(buf.len());
    let mut prev_block: [u8; 16] = *IV;
    for chunk in buf.chunks(16) {
        let mut block = aes::Block::clone_from_slice(chunk);
        for i in 0..16 {
            block[i] ^= prev_block[i];
        }
        cipher.encrypt_block(&mut block);
        result.extend_from_slice(&block);
        prev_block.copy_from_slice(&block);
    }
    base64::engine::general_purpose::STANDARD.encode(&result)
}

/// 生成随机 16 字节 key
fn random_key() -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..16)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// weapi 加密：返回 (params, encSecKey)
pub fn encrypt(payload: &str) -> (String, String) {
    let sec_key = random_key();
    let enc1 = aes_encrypt(payload, PRESET_KEY);
    let params = aes_encrypt(&enc1, sec_key.as_bytes().try_into().unwrap_or(PRESET_KEY));
    let enc_sec_key = rsa_encrypt(&sec_key);
    (params, enc_sec_key)
}

/// RSA 加密：反转 text → hex → 大数模幂 result = m^e mod n
fn rsa_encrypt(text: &str) -> String {
    let reversed: String = text.chars().rev().collect();
    let text_hex: String = reversed.bytes().map(|b| format!("{:02x}", b)).collect();
    let m = BigUint::parse_bytes(text_hex.as_bytes(), 16).unwrap();
    let e = BigUint::parse_bytes(PUB_KEY.as_bytes(), 16).unwrap();
    let n = BigUint::parse_bytes(MODULUS.as_bytes(), 16).unwrap();
    let result = m.modpow(&e, &n);
    let hex = result.to_str_radix(16);
    format!("{:0>256}", hex)
}
