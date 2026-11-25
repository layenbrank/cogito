//! 派生指纹与相似检索：`gallery:compute-phash` / `gallery:similar` / `gallery:rescan`。
//!
//! 为什么是「感知哈希」而不是 CLIP：CLIP 要 ONNX Runtime + 下载模型（新增 crate + 网络），
//! 本轮镜像不可用；aHash 只依赖已有的 `image` crate，能真正回答「找出和这张像的照片」，
//! 只是不吃自然语言。语义检索的接口位在 `data/search-provider.ts` 里保留，等模型链就绪再换。
//!
//! 三个命令都是**纯派生物维护**：结果可随时重算，删表重建也不会丢用户数据。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use cogito_core::gallery::{DerivedPatch, Service as GalleryService};
use cogito_database::Storage;
use cogito_database::entity::{asset, gallery_asset};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Serialize;
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarRow {
    pub id: String,
    /// 汉明距离（0 = 感知上几乎同图）
    pub distance: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanOutcome {
    pub checked: usize,
    pub missing: usize,
    pub restored: usize,
}

/// aHash：8×8 灰度 → 与均值比较得到 64 bit。
///
/// 对缩放/压缩不敏感，对「构图明显不同」敏感 —— 正好是「同一场景的几张废片」这个用途。
fn find_ahash(path: &Path) -> Option<String> {
    let image = image::open(path).ok()?;
    Some(find_ahash_of(&image))
}

fn find_ahash_of(image: &image::DynamicImage) -> String {
    let gray = image.to_luma8();
    let small = image::imageops::resize(&gray, 8, 8, image::imageops::FilterType::Triangle);
    let sum: u64 = small.pixels().map(|pixel| u64::from(pixel.0[0])).sum();
    let mean = sum / 64;
    let mut bits: u64 = 0;
    for (index, pixel) in small.pixels().enumerate() {
        if u64::from(pixel.0[0]) >= mean {
            bits |= 1 << index;
        }
    }
    format!("{bits:016x}")
}

/// 优先用已缓存的 192 缩略图算指纹。
///
/// `image::open` 要解整个像素矩阵（48MP 的 JPEG 约 30–60ms），而我们只需要 8×8；
/// 缩略图缓存里已经有 192px 的成品（网格滚过一次就有），解它只要 1–2ms。
fn find_ahash_cached(root: &Path, asset_id: &str, version: i64, source: &Path) -> Option<String> {
    let request = crate::media::thumb::ThumbRequest {
        asset_id: asset_id.to_string(),
        bucket: 192,
        version: version.to_string(),
        fit: crate::media::thumb::Fit::Cover,
    };
    let cached: PathBuf = crate::media::thumb::cache_path(root, &request);
    if cached.is_file() {
        return find_ahash(&cached);
    }
    find_ahash(source)
}

fn hamming(left: u64, right: u64) -> u32 {
    (left ^ right).count_ones()
}

/// 只认媒体行：`asset` 表各域共用，对 PDF / 文档做感知哈希既无意义又白烧 CPU。
fn is_media(row: &asset::Model) -> bool {
    match row.kind.as_deref() {
        Some("image") | Some("video") => true,
        _ => row.mime.starts_with("image/") || row.mime.starts_with("video/"),
    }
}

#[tauri::command(rename = "gallery:compute-phash")]
pub async fn gallery_compute_phash(
    app: tauri::AppHandle,
    state: State<'_, Storage>,
    limit: Option<usize>,
) -> cogito_core::CommandResult<usize> {
    let db = state.connection();
    let assets = asset::Entity::find()
        .filter(asset::Column::ArchivedAt.is_null())
        .all(db)
        .await?;
    let path_by_id: HashMap<String, String> = assets
        .into_iter()
        .filter(is_media)
        .map(|row| (row.id, row.file_path))
        .collect();

    let targets = gallery_asset::Entity::find()
        .filter(gallery_asset::Column::Phash.is_null())
        .all(db)
        .await?;

    let thumb_root = app
        .try_state::<crate::media::thumb::ThumbService>()
        .map(|service| service.root().to_path_buf());

    let cap = limit.unwrap_or(usize::MAX);
    let mut written = 0usize;
    let mut patches: Vec<(String, DerivedPatch)> = Vec::new();
    for target in targets.into_iter().take(cap) {
        let Some(path) = path_by_id.get(&target.asset_id).cloned() else {
            continue;
        };
        let asset_id = target.asset_id.clone();
        let version = target.mtime_ms.unwrap_or(0);
        let root = thumb_root.clone();
        let computed = tokio::task::spawn_blocking(move || match root {
            Some(root) => find_ahash_cached(&root, &asset_id, version, Path::new(&path)),
            None => find_ahash(Path::new(&path)),
        })
        .await;
        match computed {
            Ok(Some(phash)) => {
                patches.push((
                    target.asset_id,
                    DerivedPatch {
                        phash: Some(phash),
                        ..Default::default()
                    },
                ));
                written += 1;
            }
            Ok(None) => {
                // 解不开（HEIC / RAW / 损坏）：留空，下次再试；不要写假指纹
            }
            Err(error) => tracing::warn!("图库感知哈希失败：{}", error),
        }
    }
    GalleryService::toWriteDerivedMany(db, patches).await?;
    Ok(written)
}

#[tauri::command(rename = "gallery:similar")]
pub async fn gallery_similar(
    state: State<'_, Storage>,
    id: String,
    max_distance: Option<u32>,
) -> cogito_core::CommandResult<Vec<SimilarRow>> {
    let db = state.connection();
    let rows = gallery_asset::Entity::find().all(db).await?;
    let target = rows.iter().find(|row| row.asset_id == id).and_then(|row| {
        row.phash
            .as_deref()
            .and_then(|value| u64::from_str_radix(value, 16).ok())
    });
    let Some(target_bits) = target else {
        return Ok(vec![]);
    };
    let threshold = max_distance.unwrap_or(12);
    let mut out: Vec<SimilarRow> = Vec::new();
    for row in rows {
        if row.asset_id == id {
            continue;
        }
        let Some(bits) = row
            .phash
            .as_deref()
            .and_then(|value| u64::from_str_radix(value, 16).ok())
        else {
            continue;
        };
        let distance = hamming(target_bits, bits);
        if distance <= threshold {
            out.push(SimilarRow {
                id: row.asset_id,
                distance,
            });
        }
    }
    out.sort_by_key(|row| row.distance);
    out.truncate(63);
    Ok(out)
}

#[tauri::command(rename = "gallery:rescan")]
pub async fn gallery_rescan(
    state: State<'_, Storage>,
) -> cogito_core::CommandResult<RescanOutcome> {
    let db = state.connection();
    let assets = asset::Entity::find()
        .filter(asset::Column::ArchivedAt.is_null())
        .all(db)
        .await?
        .into_iter()
        .filter(is_media)
        .collect::<Vec<_>>();
    let metas = gallery_asset::Entity::find().all(db).await?;
    let missing_by_id: HashMap<String, bool> = metas
        .into_iter()
        .map(|row| (row.asset_id, row.missing != 0))
        .collect();

    // `Path::exists` 是同步 stat：几万张时在机械盘/网络盘上能卡好几秒。
    // 全面丢给阻塞线程池一次算完，避免卡住 async runtime（单连接下其他命令会一起排队）。
    let probes: Vec<(String, String)> = assets
        .iter()
        .map(|row| (row.id.clone(), row.file_path.clone()))
        .collect();
    let exists_list = tokio::task::spawn_blocking(move || {
        probes
            .into_iter()
            .map(|(id, path)| (id, Path::new(&path).exists()))
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|error| cogito_core::Exception::Internal(format!("位置校验失败：{error}")))?;

    let mut checked = 0usize;
    let mut missing = 0usize;
    let mut restored = 0usize;
    let mut patches: Vec<(String, DerivedPatch)> = Vec::new();
    for (id, exists) in exists_list {
        checked += 1;
        let was_missing = missing_by_id.get(&id).copied().unwrap_or(false);
        if !exists && !was_missing {
            patches.push((
                id,
                DerivedPatch {
                    missing: Some(true),
                    ..Default::default()
                },
            ));
            missing += 1;
        } else if exists && was_missing {
            patches.push((
                id,
                DerivedPatch {
                    missing: Some(false),
                    ..Default::default()
                },
            ));
            restored += 1;
        }
    }
    GalleryService::toWriteDerivedMany(db, patches).await?;
    Ok(RescanOutcome {
        checked,
        missing,
        restored,
    })
}
