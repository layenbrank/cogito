//! 字节级去重：`gallery:dedupe`。
//!
//! 三步（Lap 的做法）：按 size 分组 → 组内算内容哈希 → 按「哈希 + size」分组。
//! 只认**字节完全相同**；「长得像」是相似图的事，两者别混。
//!
//! 哈希算法用 **SHA-256** 而不是 BLAKE3：`sha2` 已经是本 crate 的依赖（token 签名在用），
//! 而 BLAKE3 需要新 crate —— 本轮镜像不可用。差异只在速度（BLAKE3 快 3–5 倍），
//! 语义（字节级相同）完全一致；换来的是零新依赖。

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use cogito_core::gallery::{DerivedPatch, Service as GalleryService};
use cogito_database::Storage;
use cogito_database::entity::{asset, gallery_asset};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

const DEDUPE_PROGRESS_EVENT: &str = "gallery://dedupe-progress";

/// 每多少个文件发一次进度（逐文件 emit 会让渲染进程每行重渲染一次）。
const PROGRESS_EVERY: usize = 20;

/// 只认媒体行：`asset` 表是各域共用的，对 PDF / 文档做「字节级去重」毫无意义，
/// 而且会让「重复项」视图混进图库里根本看不到的文件。
fn is_media(row: &asset::Model) -> bool {
    match row.kind.as_deref() {
        Some("image") | Some("video") => true,
        _ => row.mime.starts_with("image/") || row.mime.starts_with("video/"),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DedupeOutcome {
    /// 本次真正算过哈希的文件数
    pub hashed: usize,
    /// 判定为重复的文件数（含每组保留的那一份）
    pub duplicated: usize,
    pub groups: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DedupeProgress {
    done: usize,
    total: usize,
}

fn hash_file(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(hex::encode(hasher.finalize()))
}

#[tauri::command(rename = "gallery:dedupe")]
pub async fn gallery_dedupe(
    app: AppHandle,
    state: State<'_, Storage>,
) -> cogito_core::CommandResult<DedupeOutcome> {
    let db = state.connection();
    let assets = asset::Entity::find()
        .filter(asset::Column::ArchivedAt.is_null())
        .all(db)
        .await?
        .into_iter()
        .filter(is_media)
        .collect::<Vec<_>>();
    let metas = gallery_asset::Entity::find().all(db).await?;

    let mut known_hash: HashMap<String, String> = HashMap::new();
    let mut state_size: HashMap<String, i64> = HashMap::new();
    for row in &metas {
        if let Some(hash) = &row.content_hash {
            known_hash.insert(row.asset_id.clone(), hash.clone());
        }
        if let Some(size) = row.size_bytes {
            state_size.insert(row.asset_id.clone(), size);
        }
    }

    // 第 1 步：按 size 分组（大小不同绝不可能是同一份内容）
    let mut by_size: HashMap<i64, Vec<asset::Model>> = HashMap::new();
    for row in assets {
        let size = state_size
            .get(&row.id)
            .copied()
            .or(row.size)
            .unwrap_or_default();
        if size <= 0 {
            continue;
        }
        by_size.entry(size).or_default().push(row);
    }

    let candidates: Vec<Vec<asset::Model>> = by_size
        .into_values()
        .filter(|group| group.len() > 1)
        .collect();
    let total: usize = candidates.iter().map(|group| group.len()).sum();

    let mut hashed = 0usize;
    let mut duplicated = 0usize;
    let mut groups = 0usize;
    let mut done = 0usize;
    // 派生物先记账、最后一次性提交：逐条 `toWriteDerived` 是「每文件一次自动提交」，
    // 在单连接上会把界面请求堵在后面。
    let mut patches: Vec<(String, DerivedPatch)> = Vec::new();

    for group in candidates {
        let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
        for row in group {
            let hash = match known_hash.get(&row.id) {
                Some(existing) => existing.clone(),
                None => {
                    let path = row.file_path.clone();
                    let computed =
                        tokio::task::spawn_blocking(move || hash_file(Path::new(&path))).await;
                    match computed {
                        Ok(Some(hash)) => {
                            hashed += 1;
                            hash
                        }
                        other => {
                            if let Err(error) = other {
                                tracing::warn!("图库去重哈希失败：{}", error);
                            }
                            done += 1;
                            continue;
                        }
                    }
                }
            };
            patches.push((
                row.id.clone(),
                DerivedPatch {
                    content_hash: Some(hash.clone()),
                    ..Default::default()
                },
            ));
            by_hash.entry(hash).or_default().push(row.id);
            done += 1;
            if done % PROGRESS_EVERY == 0 {
                let _ = app.emit(
                    DEDUPE_PROGRESS_EVENT,
                    DedupeProgress {
                        done,
                        total: total.max(1),
                    },
                );
            }
        }

        for (hash, ids) in by_hash {
            if ids.len() < 2 {
                continue;
            }
            groups += 1;
            duplicated += ids.len();
            // 分组键取哈希前 16 位：够区分，也够短
            let key: String = hash.chars().take(16).collect();
            for id in ids {
                patches.push((
                    id,
                    DerivedPatch {
                        dup_group: Some(key.clone()),
                        ..Default::default()
                    },
                ));
            }
        }
    }

    let _ = app.emit(
        DEDUPE_PROGRESS_EVENT,
        DedupeProgress {
            done: total,
            total: total.max(1),
        },
    );
    GalleryService::toWriteDerivedMany(db, patches).await?;

    Ok(DedupeOutcome {
        hashed,
        duplicated,
        groups,
    })
}
