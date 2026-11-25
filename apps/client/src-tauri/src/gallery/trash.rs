//! 移出图库：`gallery:trash`。
//!
//! 语义分两条路：
//! - **从图库移除** = 只删索引行（命令面板动作），文件留在原地；
//! - **移入回收站**（本命令）= 把文件挪进可恢复的回收目录，再删索引行。
//!
//! 当前落点：`<cache>/cogito/gallery-trash/`，文件名带时间戳，用户可随时手动搬回。
//! 为什么不直接调系统回收站：需要 `SHFileOperationW`（Windows）/ `NSFileManager`（macOS）
//! 的平台 FFI，本轮先保证「不丢数据 + 可恢复」，系统回收站接入列在
//! `docs/apps/client/gallery-decisions.md` 的剩余工作里。

use std::path::{Path, PathBuf};

use cogito_core::asset::Service as AssetService;
use cogito_core::gallery::Service as GalleryService;
use cogito_database::Storage;
use cogito_database::entity::asset::{self, RemoveP};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashOutcome {
    pub trashed: usize,
    pub failed: Vec<String>,
}

/// 回收目录：放在缓存根下，不碰用户数据目录，也不需要额外权限。
fn find_trash_root() -> Result<PathBuf, String> {
    let root = dirs::cache_dir()
        .ok_or_else(|| "无法定位缓存目录".to_string())?
        .join("cogito")
        .join("gallery-trash");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn move_to_trash(path: &Path) -> Result<PathBuf, String> {
    let root = find_trash_root()?;
    let stamp = chrono::Utc::now().timestamp_millis();
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let target = root.join(format!("{stamp}_{name}"));
    std::fs::rename(path, &target).map_err(|error| error.to_string())?;
    Ok(target)
}

#[tauri::command(rename = "gallery:trash")]
pub async fn gallery_trash(
    state: State<'_, Storage>,
    ids: Vec<String>,
) -> cogito_core::CommandResult<TrashOutcome> {
    if ids.is_empty() {
        return Ok(TrashOutcome {
            trashed: 0,
            failed: vec![],
        });
    }
    let db = state.connection();
    let rows = asset::Entity::find()
        .filter(asset::Column::Id.is_in(ids))
        .all(db)
        .await?;

    let mut trashed = 0usize;
    let mut failed: Vec<String> = Vec::new();
    let mut removed: Vec<String> = Vec::new();

    for row in rows {
        let path = PathBuf::from(&row.file_path);
        if !path.exists() {
            failed.push(format!("{}：文件已不存在", row.file_path));
            continue;
        }
        match move_to_trash(&path) {
            Ok(_) => {
                trashed += 1;
                removed.push(row.id);
            }
            Err(error) => failed.push(format!("{}：{error}", row.file_path)),
        }
    }

    if !removed.is_empty() {
        let params: Vec<asset::Remove> = removed
            .into_iter()
            .map(|id| asset::Remove {
                id: Some(id),
                tenant_id: None,
                kind: None,
                hash: None,
                mime: None,
                extension: None,
                file_name: None,
                status: None,
                device_id: None,
                archived_at: None,
            })
            .collect();
        AssetService::toRemove(db, RemoveP::Many(params)).await?;
        // 外键级联在「连接没开 foreign_keys」时不会触发，显式扫一次
        let _ = GalleryService::toCleanupOrphans(db).await;
    }

    Ok(TrashOutcome { trashed, failed })
}
