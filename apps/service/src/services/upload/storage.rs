use std::path::PathBuf;

use futures::stream::{self, Stream};
use sha2::{Digest, Sha256};
use tokio::fs::{self, File};
use tokio::io::AsyncReadExt;

use crate::services::upload::error::UploadError;
use crate::services::upload::validation::CAS_DIR;

#[cfg(test)]
thread_local! {
    static CAS_ROOT_OVERRIDE: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}

fn cas_root() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(path) = CAS_ROOT_OVERRIDE.with(|slot| slot.borrow().clone()) {
            return path;
        }
    }
    PathBuf::from(CAS_DIR)
}

pub async fn ensure_cas_dir() -> Result<(), UploadError> {
    fs::create_dir_all(cas_root()).await?;
    Ok(())
}

pub fn cas_path(hash: &str) -> PathBuf {
    cas_root().join(hash)
}

pub async fn cas_exists(hash: &str) -> bool {
    cas_path(hash).exists()
}

pub async fn cas_len(hash: &str) -> Result<u64, UploadError> {
    let meta = fs::metadata(cas_path(hash)).await?;
    Ok(meta.len())
}

/// 写入 CAS；若已存在则不拷贝、不覆盖。返回 true 表示复用。
pub async fn store_cas(hash: &str, data: &[u8]) -> Result<bool, UploadError> {
    ensure_cas_dir().await?;
    let path = cas_path(hash);
    if path.exists() {
        let existing = cas_len(hash).await?;
        if existing != data.len() as u64 {
            return Err(UploadError::BadRequest(format!(
                "CAS 对象大小不一致：期望 {}，实际 {existing}",
                data.len()
            )));
        }
        return Ok(true);
    }

    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).await?;
    match fs::rename(&tmp, &path).await {
        Ok(()) => Ok(false),
        Err(err) => {
            let _ = fs::remove_file(&tmp).await;
            if path.exists() {
                Ok(true)
            } else {
                Err(UploadError::Storage(err.to_string()))
            }
        }
    }
}

pub fn calculate_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex_encode(hasher.finalize().as_slice())
}

pub async fn verify_chunks_integrity(
    chunk_hashes: &[String],
    expected_hash: &str,
) -> Result<String, UploadError> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 65536];

    for hash in chunk_hashes {
        let path = cas_path(hash);
        if !path.exists() {
            return Err(UploadError::BadRequest(format!("分片 CAS 缺失: {hash}")));
        }
        let mut file = File::open(&path).await?;
        loop {
            let n = file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
    }

    let calculated = hex_encode(hasher.finalize().as_slice());
    if calculated != expected_hash {
        return Err(UploadError::ChecksumFailed);
    }
    Ok(calculated)
}

/// 按序流式输出 CAS 分片（64KiB 块）。
pub fn stream_cas_chunks(
    chunk_hashes: Vec<String>,
) -> impl Stream<Item = Result<actix_web::web::Bytes, std::io::Error>> {
    const BUF_SIZE: usize = 64 * 1024;
    stream::try_unfold(
        (chunk_hashes.into_iter(), None::<File>),
        |(mut hashes, mut file)| async move {
            loop {
                if let Some(mut open) = file.take() {
                    let mut buf = vec![0u8; BUF_SIZE];
                    let n = open.read(&mut buf).await?;
                    if n == 0 {
                        continue;
                    }
                    buf.truncate(n);
                    return Ok(Some((
                        actix_web::web::Bytes::from(buf),
                        (hashes, Some(open)),
                    )));
                }

                let Some(hash) = hashes.next() else {
                    return Ok(None);
                };
                file = Some(File::open(cas_path(&hash)).await?);
            }
        },
    )
}

pub async fn ensure_cas_present(chunk_hashes: &[String]) -> Result<(), UploadError> {
    for hash in chunk_hashes {
        if !cas_exists(hash).await {
            return Err(UploadError::BadRequest(format!("分片 CAS 缺失: {hash}")));
        }
    }
    Ok(())
}

pub fn safe_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).trim();
    let sanitized: String = base
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '"' | '\\' | ';' | '/'))
        .take(200)
        .collect();
    if sanitized.is_empty() {
        "download".to_string()
    } else {
        sanitized
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_path_and_quotes() {
        assert_eq!(safe_filename(r#"..\..\evil"name.txt"#), "evilname.txt");
    }

    #[test]
    fn empty_falls_back() {
        assert_eq!(safe_filename("///"), "download");
    }

    #[test]
    fn cas_path_uses_hash() {
        let p = cas_path("abc");
        assert!(p.ends_with("abc"));
    }

    #[test]
    fn calculate_hash_stable() {
        assert_eq!(
            calculate_hash(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[tokio::test]
    async fn store_cas_reuses_without_copy() {
        let dir = std::env::temp_dir().join(format!("upload-cas-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let _guard = CasOverride::set(dir.clone());

        let data = b"chunk-payload-aaaa";
        let hash = calculate_hash(data);
        assert!(!store_cas(&hash, data).await.unwrap());
        assert!(store_cas(&hash, data).await.unwrap());
        assert_eq!(cas_len(&hash).await.unwrap(), data.len() as u64);
        assert_eq!(tokio::fs::read(cas_path(&hash)).await.unwrap(), data);
    }

    #[tokio::test]
    async fn stream_cas_chunks_concatenates() {
        let dir = std::env::temp_dir().join(format!("upload-cas-stream-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let _guard = CasOverride::set(dir.clone());

        let a = b"AAA";
        let b = b"BBBB";
        let ha = calculate_hash(a);
        let hb = calculate_hash(b);
        store_cas(&ha, a).await.unwrap();
        store_cas(&hb, b).await.unwrap();

        use futures::StreamExt;
        let mut stream = Box::pin(stream_cas_chunks(vec![ha, hb]));
        let mut out = Vec::new();
        while let Some(item) = stream.next().await {
            out.extend_from_slice(&item.unwrap());
        }
        assert_eq!(out, b"AAABBBB");
    }

    struct CasOverride;

    impl CasOverride {
        fn set(path: PathBuf) -> Self {
            CAS_ROOT_OVERRIDE.with(|slot| {
                *slot.borrow_mut() = Some(path);
            });
            Self
        }
    }

    impl Drop for CasOverride {
        fn drop(&mut self) {
            let path = CAS_ROOT_OVERRIDE.with(|slot| slot.borrow_mut().take());
            if let Some(path) = path {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
}
