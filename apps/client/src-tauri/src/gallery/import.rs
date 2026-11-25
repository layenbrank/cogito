//! 图库导入：`gallery:import`。
//!
//! 旧实现把这件事放在渲染进程：逐条 `invoke`、用 `readFile` 把整文件读进 JS 堆做 EXIF、
//! 再用隐藏 `<video>` 探时长。这里改成「Rust 一次跑完」：
//! 一次 stat → EXIF（只读需要的段）→ 尺寸（只读文件头）→ 插 asset → 写侧表 → 发进度事件。
//!
//! 刻意**不做**的事：
//! - 解码整张图（尺寸用 `image` 的文件头读取，不解码像素）；
//! - 在前端算哈希（BLAKE3 放去重流程，按 size 分组建批才划算）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use chrono::{NaiveDateTime, TimeZone, Utc};
use cogito_core::asset::Service as AssetService;
use cogito_core::gallery::{ProbeResult, Service as GalleryService};
use cogito_database::Storage;
use cogito_database::entity::asset::{self, Insert, InsertP};
use sea_orm::{EntityTrait, TransactionTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const IMPORT_PROGRESS_EVENT: &str = "gallery://import-progress";

/// 目录递归上限：深度 8 层、单次最多 20000 个文件。
///
/// 旧实现在前端硬编码 4 层 / 400 个，"几万张照片"根本导不进来；
/// 这里只留一个安全阀，超了会以「只导了前 N 个」的形式真实反映在结果里。
const MAX_DEPTH: u32 = 8;
const MAX_FILES: usize = 20_000;
/// 每个事务处理多少个文件：太小则提交次数多，太大则失败时回滚面过大。
const IMPORT_BATCH: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    pub current: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub imported: usize,
    pub skipped: usize,
    pub failed: Vec<ImportFailure>,
}

/// 扩展名 → (mime, kind)。只覆盖图库关心的格式；不认识的直接跳过并记原因。
fn find_mime(ext: &str) -> Option<(&'static str, &'static str)> {
    match ext {
        "jpg" | "jpeg" => Some(("image/jpeg", "image")),
        "png" => Some(("image/png", "image")),
        "webp" => Some(("image/webp", "image")),
        "gif" => Some(("image/gif", "image")),
        "bmp" => Some(("image/bmp", "image")),
        "avif" => Some(("image/avif", "image")),
        "heic" | "heif" => Some(("image/heic", "image")),
        "tif" | "tiff" => Some(("image/tiff", "image")),
        // RAW：mime 用通用名，具体型号由 probe 后续补
        "dng" | "cr2" | "cr3" | "nef" | "arw" | "raf" | "orf" | "rw2" | "pef" => {
            Some(("image/x-raw", "image"))
        }
        "mp4" | "m4v" => Some(("video/mp4", "video")),
        "mov" => Some(("video/quicktime", "video")),
        "webm" => Some(("video/webm", "video")),
        "mkv" => Some(("video/x-matroska", "video")),
        "avi" => Some(("video/x-msvideo", "video")),
        _ => None,
    }
}

fn find_extension(path: &Path) -> String {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// 递归收集目录下的媒体文件（只认扩展名表里有的格式）。
///
/// `media:pick` 的 `folders` 模式返回的是**目录**，旧版直接把它当文件去猜 mime，
/// 结果全部落到「不支持的格式」—— 这是「导入失败」最常见的来源。
fn collect_media_files(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        // 跳过隐藏项（含 OneDrive 占位符常见的 `.` 开头目录）
        if path
            .file_name()
            .map(|name| name.to_string_lossy().starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            collect_media_files(&path, depth + 1, out);
            continue;
        }
        if find_mime(&find_extension(&path)).is_some() {
            out.push(path);
        }
    }
}

fn find_file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn parse_exif_datetime(raw: &str) -> Option<i64> {
    let trimmed = raw.trim().trim_end_matches('\0');
    let naive = NaiveDateTime::parse_from_str(trimmed, "%Y:%m:%d %H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S"))
        .ok()?;
    Some(Utc.from_utc_datetime(&naive).timestamp_millis())
}

fn read_u16(buffer: &[u8], offset: usize, is_little: bool) -> Option<u16> {
    let bytes = buffer.get(offset..offset + 2)?;
    Some(if is_little {
        u16::from_le_bytes([bytes[0], bytes[1]])
    } else {
        u16::from_be_bytes([bytes[0], bytes[1]])
    })
}

fn read_u32(buffer: &[u8], offset: usize, is_little: bool) -> Option<u32> {
    let bytes = buffer.get(offset..offset + 4)?;
    Some(if is_little {
        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    } else {
        u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    })
}

/// 在某个 IFD 里找 tag，返回 (类型, 值/偏移)。
fn find_ifd_entry(buffer: &[u8], ifd: usize, tag: u16, is_little: bool) -> Option<(u16, u32)> {
    let count = read_u16(buffer, ifd, is_little)? as usize;
    if count > 512 {
        return None;
    }
    for index in 0..count {
        let base = ifd + 2 + index * 12;
        if read_u16(buffer, base, is_little)? != tag {
            continue;
        }
        let field_type = read_u16(buffer, base + 2, is_little)?;
        let value = read_u32(buffer, base + 8, is_little)?;
        return Some((field_type, value));
    }
    None
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// 只读 EXIF 容器拿 `DateTimeOriginal`（不解码像素）。
///
/// 不引入第三方 EXIF crate：只需要一个字段，自己走 TIFF IFD 反而更可控；
/// 容器/字段缺失一律当作「拿不到」，交给 mtime 兜底。
///
/// 只读前 128KB：EXIF APP1 段几乎总在文件头几 KB 内，512KB 的读放大在
/// 「几万张导入」这个场景下是几十 GB 的无谓 I/O；搜索也从 O(512K×6) 降到 1/4。
const EXIF_HEAD_BYTES: u64 = 128 * 1024;

fn read_exif_date(path: &Path) -> Option<i64> {
    use std::io::Read;

    let mut head = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(EXIF_HEAD_BYTES)
        .read_to_end(&mut head)
        .ok()?;

    let tiff_start = find_subslice(&head, b"Exif\0\0")? + 6;
    let tiff = head.get(tiff_start..)?;
    let is_little = match tiff.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    if read_u16(tiff, 2, is_little)? != 42 {
        return None;
    }
    let ifd0 = read_u32(tiff, 4, is_little)? as usize;
    let (_, exif_ifd) = find_ifd_entry(tiff, ifd0, 0x8769, is_little)?;
    let (_, value_offset) = find_ifd_entry(tiff, exif_ifd as usize, 0x9003, is_little)?;
    let raw = tiff.get(value_offset as usize..value_offset as usize + 19)?;
    parse_exif_datetime(&String::from_utf8_lossy(raw))
}

/// 只读文件头拿宽高（`image` 的 `into_dimensions` 不解码像素）。
fn read_dimensions(path: &Path) -> Option<(i64, i64)> {
    let reader = image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?;
    let (width, height) = reader.into_dimensions().ok()?;
    Some((i64::from(width), i64::from(height)))
}

fn probe_file(path: &Path, kind: &str) -> ProbeResult {
    // 一次 metadata 同时给 size 与 mtime：旧实现 size / mtime / 尺寸各 stat 一次
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|meta| meta.len() as i64);
    let mtime = meta
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as i64);
    // 视频里没有 EXIF：不去读那 128KB
    let exif_date = if kind == "image" {
        read_exif_date(path)
    } else {
        None
    };
    let dimensions = if kind == "image" {
        read_dimensions(path)
    } else {
        None
    };
    // 尺寸/EXIF 都取不到时，把文件名里的拼音文本一并塞进来（一次算完，避免再查库）
    let captured_at = exif_date.or(mtime);
    ProbeResult {
        captured_at,
        date_source: Some(if exif_date.is_some() {
            "exif".into()
        } else {
            "mtime".into()
        }),
        size_bytes: size,
        mtime_ms: mtime,
        width: dimensions.map(|pair| pair.0),
        height: dimensions.map(|pair| pair.1),
        duration_ms: None,
        stack_id: None,
        keywords: vec![],
        search_text: Some(GalleryService::toSearchText(&find_file_name(path), &[])),
    }
}

/// 同目录同主名的文件算一组（RAW+JPEG / Live Photo 的 HEIC+MOV）。
fn find_stack_map(paths: &[PathBuf]) -> HashMap<String, String> {
    let mut by_stem: HashMap<String, Vec<&PathBuf>> = HashMap::new();
    for path in paths {
        if let Some(stem) = path.file_stem() {
            let key = format!(
                "{}::{}",
                path.parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
                stem.to_string_lossy()
            );
            by_stem.entry(key).or_default().push(path);
        }
    }
    let mut stack_of: HashMap<String, String> = HashMap::new();
    for (key, group) in by_stem {
        if group.len() < 2 {
            continue;
        }
        for path in group {
            stack_of.insert(path.to_string_lossy().to_string(), key.clone());
        }
    }
    stack_of
}

#[tauri::command(rename = "gallery:import")]
pub async fn gallery_import(
    app: AppHandle,
    state: State<'_, Storage>,
    paths: Vec<String>,
) -> cogito_core::CommandResult<ImportOutcome> {
    let db = state.connection();
    let mut list: Vec<PathBuf> = Vec::new();
    let mut failed: Vec<ImportFailure> = Vec::new();

    // 选的是目录就递归展开（并登记为库根目录，供重扫 / 后续监听用）；
    // 选的是文件就直接收录。两者都支持，前端不必区分两次调用。
    //
    // 目录遍历走 `spawn_blocking`：几十万条目的机械盘上 `read_dir` 能卡上秒级，
    // 在 async 上直接跑会把同一 runtime 的其他命令全堵住（单连接下尤其明显）。
    for raw in paths {
        let path = PathBuf::from(&raw);
        if path.is_dir() {
            if let Err(error) = GalleryService::toAddRoot(db, &raw).await {
                tracing::debug!("登记图库根目录失败 {raw}：{error}");
            }
            let walk_root = path.clone();
            match tokio::task::spawn_blocking(move || {
                let mut found = Vec::new();
                collect_media_files(&walk_root, 0, &mut found);
                found
            })
            .await
            {
                Ok(found) => list.extend(found),
                Err(error) => {
                    tracing::warn!("遍历目录失败 {raw}：{error}");
                    failed.push(ImportFailure {
                        path: raw,
                        reason: format!("遍历目录失败：{error}"),
                    });
                }
            }
        } else if path.is_file() {
            list.push(path);
        } else {
            failed.push(ImportFailure {
                path: raw,
                reason: "路径不存在".into(),
            });
        }
    }

    // 去重：同一个文件被选两次（或文件夹里出现符号链接）时不重复入库
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    list.retain(|path| seen.insert(path.to_string_lossy().to_string()));

    // 「是否已入库」一次性查出来：逐文件 `WHERE filePath = ?` 即使有索引也是 N 次往返，
    // 单连接下这 N 次会把界面刷新请求排在后面。
    let known_paths: std::collections::HashSet<String> = asset::Entity::find()
        .all(db)
        .await?
        .into_iter()
        .map(|row| row.file_path)
        .collect();

    let stacks = find_stack_map(&list);

    let mut imported = 0usize;
    let mut skipped = 0usize;

    let mut chunk: Vec<(PathBuf, String, &'static str)> = Vec::new();
    for path in &list {
        let Some((mime, kind)) = find_mime(&find_extension(path)) else {
            failed.push(ImportFailure {
                path: path.to_string_lossy().to_string(),
                reason: "不支持的格式".into(),
            });
            continue;
        };
        if known_paths.contains(&path.to_string_lossy().to_string()) {
            skipped += 1;
            continue;
        }
        chunk.push((path.clone(), mime.to_string(), kind));
    }

    let chunk_total = chunk.len();
    let mut done = 0usize;
    let mut last_emit = std::time::Instant::now();

    // 分块 + 每块一个事务：2 万文件逐条 autocommit 等于 2 万次 WAL 提交（还有同样数量的 IPC 事件）
    for batch in chunk.chunks(IMPORT_BATCH) {
        let txn = db.begin().await?;
        for (path, mime, kind) in batch {
            done += 1;
            // 进度事件节流：每 20 个或每 150ms 一次；逐文件 emit 会让渲染进程每行重渲染一次
            if done % 20 == 0 || last_emit.elapsed().as_millis() >= 150 || done == chunk_total {
                last_emit = std::time::Instant::now();
                let _ = app.emit(
                    IMPORT_PROGRESS_EVENT,
                    ImportProgress {
                        done,
                        total: chunk_total,
                        current: find_file_name(path),
                    },
                );
            }

            let path_string = path.to_string_lossy().to_string();
            let probe_path = path.clone();
            let kind_owned = (*kind).to_string();
            let probe =
                match tokio::task::spawn_blocking(move || probe_file(&probe_path, &kind_owned))
                    .await
                {
                    Ok(probe) => probe,
                    Err(error) => {
                        failed.push(ImportFailure {
                            path: path_string,
                            reason: format!("探测失败：{error}"),
                        });
                        continue;
                    }
                };

            let insert = Insert {
                tenant_id: None,
                kind: Some((*kind).to_string()),
                hash: None,
                sha: None,
                size: probe.size_bytes,
                index: None,
                mime: mime.clone(),
                extension: find_extension(path),
                file_name: find_file_name(path),
                file_path: path_string.clone(),
                metadata: Some(
                    serde_json::json!({
                        "source": "import",
                        "capturedAt": probe.captured_at,
                        "dateSource": probe.date_source,
                        "hidden": false
                    })
                    .to_string(),
                ),
                status: None,
                device_id: None,
                archived_at: None,
            };
            let inserted = AssetService::toInsert(&txn, InsertP::One(insert)).await?;
            let Some(row) = inserted.first() else {
                failed.push(ImportFailure {
                    path: path_string,
                    reason: "插入未返回 id".into(),
                });
                continue;
            };

            let mut final_probe = probe;
            final_probe.stack_id = stacks.get(&path_string).cloned();
            GalleryService::toWriteProbe(&txn, &row.id, final_probe).await?;
            imported += 1;
        }
        txn.commit().await?;
    }

    let _ = app.emit(
        IMPORT_PROGRESS_EVENT,
        ImportProgress {
            done: chunk_total,
            total: chunk_total,
            current: String::new(),
        },
    );

    Ok(ImportOutcome {
        imported,
        skipped,
        failed,
    })
}
