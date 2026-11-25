//! 缩略图服务：`thumb://` 自定义协议 + 磁盘缓存（**纯派生物**，可整体删掉重建）。
//!
//! 为什么自建协议，而不是把图转 base64 或先复制到临时目录：
//!
//! - base64 让传输体积涨三成，而且每次都要在渲染进程里重新编码；
//! - 复制到临时目录会留下没人清理的垃圾文件，还得自己做生命周期。
//!
//! 协议地址（前端见 `views/gallery/data/{thumbnail,thumb-url}.ts`）：
//!
//! ```text
//! thumb://localhost/t/<assetID>/<bucket>/<version>-<fit>.jpg          // 缩略图
//! thumb://localhost/o/<assetID>/<version>                            // 原图
//! http://thumb.localhost/...                                          // Windows / Android
//! ```
//!
//! 为什么原图也走这个协议，而不是 `asset://`：`assetProtocol.scope` 只能放应用自己的目录，
//! 用户照片在 `D:\Photos\...`，放宽成 `**` 等于把整个磁盘挂给渲染进程。这里原图与缩略图
//! 共用同一条「只认库内 assetID」规则，且 `/o/` 实现了 `Range`（视频拖动进度条要 206）。
//!
//! 四条必须守住的约束：
//!
//! 1. **只认库内 assetID** —— 源路径由 `asset` 行给出，协议不接受任意路径参数。
//!    否则它就成了任意文件读取器，`fs:scope` 收口等于白做。
//! 2. **尺寸只按桶取**（192 / 384 / 768）—— 避免同一张图生成十几个尺寸、缓存碎片化。
//! 3. **绝不放大**；超宽 / 超高图（全景、长截图）退回 `contain`，不被压成一条线
//!    （Lap 的「短边不低于目标 1/4」规则的工程化版本）。
//! 4. 缓存文件名带 `version`（源文件 mtime）—— 文件变了 URL 自然变，不需要失效逻辑。
//!
//! 解码失败不抛给前端：回 404，`<img>` 自己走 `onError` 占位。HEIC / RAW 本轮不解码，
//! 由前端回落原图（见方案 §5.2 的格式边界）。
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use image::ImageDecoder;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{DynamicImage, ImageEncoder, ImageReader};
use sea_orm::EntityTrait;
use tauri::http::{Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

/// 尺寸桶：只按桶取。
pub const BUCKETS: [u32; 3] = [192, 384, 768];

const JPEG_QUALITY: u8 = 85;
/// 缓存总量上限：超过按 LRU 淘汰到 80%。
pub const CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// 每渲染 N 张检查一次容量（避免每次请求都扫盘）。
const PRUNE_EVERY: u64 = 200;
/// 源图像素上限：再大就不解，防一张 200MP 全景把内存吃光。
const MAX_SOURCE_PIXELS: u64 = 120_000_000;
/// 缩略图长边的「全景阈值」——超过这个比例就走 `contain`。
const PANORAMA_RATIO: f32 = 4.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fit {
    Cover,
    Contain,
}

impl Fit {
    fn as_str(self) -> &'static str {
        match self {
            Fit::Cover => "cover",
            Fit::Contain => "contain",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "cover" => Some(Fit::Cover),
            "contain" => Some(Fit::Contain),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbRequest {
    pub asset_id: String,
    /// 已归一化到桶上的目标边长（像素）
    pub bucket: u32,
    /// 源文件版本（mtime），只用于缓存键
    pub version: String,
    pub fit: Fit,
}

/// `/o/<assetID>/<version>`：原图（灯箱 / 对比 / 缩略图解码失败时的回落）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginalRequest {
    pub asset_id: String,
    /// 源文件 mtime，仅用于让 URL 随文件变化而变（不参与寻址）
    pub version: String,
}

/// 进程内唯一的缩略图服务：持有缓存根、淘汰计数器与源路径小缓存。
pub struct ThumbService {
    root: PathBuf,
    renders: AtomicU64,
    /// assetID → (version, filePath)。
    ///
    /// 视频是按 2 MiB 分块拉的：2 GB 的录屏就是上千次请求，每块都回库查一次
    /// `asset` 行，而连接只有一条（`max_connections(1)`），会跟界面请求抢队列。
    /// URL 里带着 mtime 作为 version：文件被改名/覆盖后 version 变，自然回落到查库。
    sources: std::sync::Mutex<HashMap<String, (String, String)>>,
}

/// 源路径缓存上限：超过就整表清空（真实库规模下很难碰到，不做 LRU 了）。
const SOURCE_CACHE_LIMIT: usize = 4096;

impl ThumbService {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            renders: AtomicU64::new(0),
            sources: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 命中且 version 一致才用（文件变了必须重查，否则会指向旧路径）。
    fn find_cached_source(&self, asset_id: &str, version: &str) -> Option<String> {
        let cache = self.sources.lock().ok()?;
        let (cached_version, path) = cache.get(asset_id)?;
        if cached_version == version {
            Some(path.clone())
        } else {
            None
        }
    }

    fn remember_source(&self, asset_id: &str, version: &str, path: &str) {
        let Ok(mut cache) = self.sources.lock() else {
            return;
        };
        if cache.len() >= SOURCE_CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(asset_id.to_string(), (version.to_string(), path.to_string()));
    }

    /// 返回 true 表示这次该做一次容量检查。
    fn should_prune(&self) -> bool {
        let count = self.renders.fetch_add(1, Ordering::Relaxed) + 1;
        count % PRUNE_EVERY == 0
    }
}

fn is_safe_token(raw: &str) -> bool {
    !raw.is_empty()
        && raw.len() <= 96
        // 纯点号（`.` / `..`）会拼出逃逸目录，虽然下游 bucket 校验也会拦，但这里直接挡住
        && raw.chars().any(|ch| ch != '.')
        && raw
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

/// 百分号解码。
///
/// `convertFileSrc` 会把**整条路径**编码成一段（`/t/x/384/1-cover.jpg` → `%2Ft%2Fx%2F384%2F1-cover.jpg`），
/// 而自定义协议拿到的 `uri().path()` 是未解码的原文 —— 不先解码，第一段就不是 `t`，
/// 于是每张图都吃 400。只处理 `%XX`，不解 `+`（这里没有 query，`+` 是合法字符）。
fn percent_decode(raw: &str) -> Option<String> {
    if !raw.contains('%') {
        return Some(raw.to_string());
    }
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `/t/<assetID>/<bucket>/<version>-<fit>.jpg`
///
/// 只依赖路径段，不用 query：这样前端可以用 `convertFileSrc` 之外的方式拼 URL，
/// 也不会被百分号编码搅坏（`?` 会被编成 `%3F`）。
pub fn parse_thumb_uri(path: &str) -> Option<ThumbRequest> {
    let mut segments = path.split('/').filter(|part| !part.is_empty());
    if segments.next()? != "t" {
        return None;
    }
    let asset_id = segments.next()?.to_string();
    if !is_safe_token(&asset_id) {
        return None;
    }
    let bucket = segments.next()?.parse::<u32>().ok()?;
    let file = segments.next()?;
    if segments.next().is_some() {
        return None;
    }
    let stem = file.strip_suffix(".jpg")?;
    let (version, fit) = stem.rsplit_once('-')?;
    if !is_safe_token(version) {
        return None;
    }
    Some(ThumbRequest {
        asset_id,
        bucket: pick_bucket(bucket),
        version: version.to_string(),
        fit: Fit::parse(fit)?,
    })
}

/// `/o/<assetID>/<version>`：原图。段数固定，`version` 只做缓存键。
pub fn parse_original_uri(path: &str) -> Option<OriginalRequest> {
    let mut segments = path.split('/').filter(|part| !part.is_empty());
    if segments.next()? != "o" {
        return None;
    }
    let asset_id = segments.next()?.to_string();
    if !is_safe_token(&asset_id) {
        return None;
    }
    let version = segments.next()?.to_string();
    if !is_safe_token(&version) {
        return None;
    }
    if segments.next().is_some() {
        return None;
    }
    Some(OriginalRequest { asset_id, version })
}

/// 扩展名 → MIME。认不出就 `application/octet-stream`（`<img>` 会自己走 onError）。
fn content_type_for(source: &Path) -> &'static str {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "heic" | "heif" => "image/heic",
        "tif" | "tiff" => "image/tiff",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

/// `Range: bytes=start-[end]`。只支持单段，认不出就当没有（回整份）。
fn parse_range(raw: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let raw = raw?.strip_prefix("bytes=")?;
    let (start, end) = raw.split_once('-')?;
    if len == 0 {
        return None;
    }
    if start.is_empty() {
        // `bytes=-500`：末尾 N 字节（Safari/WebView 有时这么探）
        let tail = end.parse::<u64>().ok()?.min(len);
        // `bytes=-0` 没有意义；不拦会把 start 算成 len，后面 `end - start + 1` 下溢
        if tail == 0 {
            return None;
        }
        return Some((len - tail, len - 1));
    }
    let start = start.parse::<u64>().ok()?.min(len - 1);
    let end = if end.is_empty() {
        len - 1
    } else {
        end.parse::<u64>().ok()?.min(len - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// 向上取到最近的桶；超出最大桶就取最大桶。
pub fn pick_bucket(px: u32) -> u32 {
    BUCKETS
        .iter()
        .copied()
        .find(|bucket| *bucket >= px)
        .unwrap_or(*BUCKETS.last().expect("BUCKETS 不能为空"))
}

/// `<root>/<id[..2]>/<id>_<bucket>_<version>-<fit>.jpg`
///
/// 前两位做子目录，避免单目录几万个文件（Windows 上目录越大枚举越慢）。
pub fn cache_path(root: &Path, request: &ThumbRequest) -> PathBuf {
    let prefix: String = request.asset_id.chars().take(2).collect();
    let shard = if prefix.len() == 2 {
        prefix
    } else {
        "00".to_string()
    };
    root.join(shard).join(format!(
        "{}_{}_{}-{}.jpg",
        request.asset_id,
        request.bucket,
        request.version,
        request.fit.as_str()
    ))
}

/// 解码 → 应用 EXIF 朝向 → 缩放 → JPEG。
///
/// 缩放滤波用 `Triangle`：384 这种目标尺寸下与 Lanczos 肉眼无差，但 45MP 源图快一个量级。
pub fn render_jpeg(source: &Path, bucket: u32, fit: Fit) -> Result<Vec<u8>, String> {
    let reader = ImageReader::open(source)
        .map_err(|error| format!("打开失败 {}: {error}", source.display()))?
        .with_guessed_format()
        .map_err(|error| format!("无法判定格式 {}: {error}", source.display()))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| format!("解码器失败: {error}"))?;

    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_SOURCE_PIXELS {
        return Err(format!("源图过大（{width}x{height}）"));
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);

    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|error| format!("解码失败: {error}"))?;
    image.apply_orientation(orientation);

    let longest = u32::from(image.width().max(image.height()));
    let ratio = longest as f32 / u32::from(image.width().min(image.height()).max(1)) as f32;
    let effective = if fit == Fit::Cover && ratio > PANORAMA_RATIO {
        Fit::Contain
    } else {
        fit
    };

    let scaled = match effective {
        // 绝不放大：源图比目标还小就原样输出
        Fit::Cover if longest <= bucket => image,
        Fit::Contain if longest <= bucket => image,
        Fit::Cover => image.resize_to_fill(bucket, bucket, FilterType::Triangle),
        Fit::Contain => image.resize(bucket, bucket, FilterType::Triangle),
    };

    let rgb = scaled.to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|error| format!("编码失败: {error}"))?;
    Ok(out)
}

/// FFmpeg 兜底：`image` crate 解不开的格式（HEIC/HEIF/RAW）与视频首帧。
///
/// 为什么不在 Rust 里内嵌解码链：HEIC 要 libheif、RAW 要 LibRaw，两个都是 C 依赖；
/// 而应用本来就随包带 FFmpeg（剪辑模块在用），直接借它的解码器最划算。
/// 失败一律返回 `None`，由调用方回 422 —— 不假装支持。
///
/// 查找必须走 `media::command::find_tool_path`：打包后 FFmpeg 在 `<安装目录>/binaries/`，
/// 开发时在 `src-tauri/binaries/`（靠向上找祖先目录命中）。这里曾经自己拼
/// `resource_dir()/bin/`，目录名不对 → 视频每条缩略图都 422。
fn render_frame_with_ffmpeg<R: Runtime>(
    app: &tauri::AppHandle<R>,
    source: &Path,
    bucket: u32,
) -> Option<Vec<u8>> {
    let tool = crate::media::command::find_tool_path(app, "ffmpeg").ok()?;
    let scale =
        format!("scale='min({bucket},iw)':'min({bucket},ih)':force_original_aspect_ratio=decrease");
    let mut command = std::process::Command::new(tool);
    command
        .args(["-v", "error", "-nostdin", "-i"])
        .arg(source)
        .args(["-frames:v", "1", "-vf", &scale])
        .args(["-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "4", "-"])
        .stdin(std::process::Stdio::null());

    // Windows：隐藏控制台窗口（同 `media::command`；缩略图是按条请求的，闪窗很显眼）
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().ok()?;
    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }
    Some(output.stdout)
}

/// 先写临时文件再改名：并发请求同一张图时不会读到半截文件。
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_extension(format!("tmp-{stamp}"));
    std::fs::write(&tmp, bytes)?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        // Windows 上并发改名可能失败：目标已存在就视为成功
        Err(error) if path.exists() => {
            let _ = std::fs::remove_file(&tmp);
            let _ = error;
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_file(&tmp);
            Err(error)
        }
    }
}

/// 按 mtime 做 LRU：超过 `max_bytes` 就删到 80%。返回清掉的字节数。
pub fn prune(root: &Path, max_bytes: u64) -> u64 {
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = Vec::new();
    let shards = match std::fs::read_dir(root) {
        Ok(shards) => shards,
        Err(_) => return 0,
    };
    for shard in shards.flatten() {
        let Ok(files) = std::fs::read_dir(shard.path()) else {
            continue;
        };
        for file in files.flatten() {
            let Ok(meta) = file.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let touched = meta.modified().unwrap_or(UNIX_EPOCH);
            entries.push((file.path(), meta.len(), touched));
        }
    }

    let total: u64 = entries.iter().map(|(_, size, _)| *size).sum();
    if total <= max_bytes {
        return 0;
    }

    entries.sort_by_key(|(_, _, touched)| *touched);
    let target = max_bytes / 5 * 4;
    let mut remaining = total;
    let mut freed = 0;
    for (path, size, _) in entries {
        if remaining <= target {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            remaining = remaining.saturating_sub(size);
            freed += size;
        }
    }
    freed
}

fn reply(status: u16, body: Vec<u8>, content_type: &'static str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::NOT_FOUND))
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn jpeg_reply(bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        // URL 里带 version，内容不会变：让 WebView 直接吃自己的缓存
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// 单次原图响应最多回多少字节。
///
/// Tauri 的自定义协议**不支持流式响应**：`UriSchemeResponder::respond` 的 body 必须是
/// 已经在内存里的 `[u8]`。所以「把整个视频一次性读出来回」等于把文件大小翻两倍塞进内存
/// （Rust 一份 + WebView 再拷一份），播放 / 拖动进度条时的 `Range: bytes=0-` 会直接
/// 把 1–2 GB 的录屏拉进 RAM —— 进程当场被 OOM 杀掉，表现就是「播放视频卡死后闪退」。
///
/// 这里统一按 4 MiB 分块回 206，让 Chromium 的多媒体栈自己续请求：
/// 内存上界与文件大小无关，只与“同时几个请求”有关。
const MAX_CHUNK_BYTES: u64 = 2 * 1024 * 1024;
/// 非视频（图片）允许整份回的上限。RAW/TIFF 可能几十 MB，再大 `<img>` 也解不动。
const MAX_FULL_BYTES: u64 = 64 * 1024 * 1024;

/// 同时最多渲染几张图（含 FFmpeg 抽帧）。
///
/// `spawn_blocking` 默认能开上百个线程：网格里 30 个视频格子同时抽帧，就是 30 个
/// `ffmpeg.exe` 在跑，每个几百 MB —— 内存和 CPU 一起爆。解码 48MP 原图同理。
/// 这里给一个固定闸门，多余的请求排队（它们本来就只是等缓存文件）。
fn render_slots() -> &'static tokio::sync::Semaphore {
    static SLOTS: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    // 2 个槽位：典型 24MP ≈ 100 MB/张，峰值约 200 MB；120MP 的极端图也只是 1 GB 左右，
    // 而滚动时每秒仍能出 30+ 张缩略图（视口就几十格）。
    SLOTS.get_or_init(|| tokio::sync::Semaphore::new(2))
}

/// 这次到底回哪一段（纯函数，便于单测）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OriginalPlan {
    start: u64,
    /** 含端 */
    end: u64,
    total: u64,
    /// true → 206 + `Content-Range`；false → 200 整份
    is_partial: bool,
}

fn plan_original(len: u64, is_streamable: bool, range: Option<&str>) -> OriginalPlan {
    if len == 0 {
        return OriginalPlan {
            start: 0,
            end: 0,
            total: 0,
            is_partial: false,
        };
    }
    // 客户端给了合法范围：照它来，但**截到分块上限**。
    // 播放器常发 `bytes=0-`（= 整份），不能真的给整份。
    if let Some((start, end)) = parse_range(range, len) {
        let end = end.min(start + MAX_CHUNK_BYTES - 1).min(len - 1);
        let is_partial = !(start == 0 && end == len - 1);
        return OriginalPlan {
            start,
            end,
            total: len,
            is_partial,
        };
    }
    // 没给 Range（或给了无法识别的多段 Range）：小文件整份回，大文件也强制分块。
    let limit = if is_streamable {
        MAX_CHUNK_BYTES
    } else {
        MAX_FULL_BYTES
    };
    if len <= limit {
        OriginalPlan {
            start: 0,
            end: len - 1,
            total: len,
            is_partial: false,
        }
    } else {
        OriginalPlan {
            start: 0,
            end: limit - 1,
            total: len,
            is_partial: true,
        }
    }
}

/// 只读计划里的那一段（绝不整份读）。
fn read_slice(source: &Path, plan: OriginalPlan) -> Result<Vec<u8>, String> {
    if plan.total == 0 {
        return Ok(Vec::new());
    }
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(source).map_err(|error| format!("打开失败：{error}"))?;
    file.seek(SeekFrom::Start(plan.start))
        .map_err(|error| format!("定位失败：{error}"))?;
    let mut bytes = vec![0_u8; (plan.end - plan.start + 1) as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| format!("读取分片失败：{error}"))?;
    Ok(bytes)
}

fn original_reply(bytes: Vec<u8>, plan: OriginalPlan, content_type: &'static str) -> Response<Vec<u8>> {
    // HEAD 请求的 body 是空的，但 `Content-Length` 必须报「本来会回多少」
    let length = if plan.total == 0 {
        0
    } else {
        plan.end - plan.start + 1
    };
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        // 原图 URL 也带 mtime：文件不变就不重读，变了 URL 自然变
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if plan.is_partial {
        builder = builder.status(StatusCode::PARTIAL_CONTENT).header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", plan.start, plan.end, plan.total),
        );
    } else {
        builder = builder.status(StatusCode::OK);
    }
    builder.body(bytes).unwrap_or_else(|_| Response::new(Vec::new()))
}

/// `/o/<assetID>/<version>`：查库拿源路径 → 读计划中的一段 → 回。
async fn serve_original<R: Runtime>(
    app: tauri::AppHandle<R>,
    parsed: OriginalRequest,
    range: Option<String>,
    is_head: bool,
    responder: UriSchemeResponder,
) {
    // 只认库内资产：协议不接受任意路径参数
    let Some(service) = app.try_state::<ThumbService>() else {
        responder.respond(reply(500, b"thumb service missing".to_vec(), "text/plain"));
        return;
    };
    let source = match service.find_cached_source(&parsed.asset_id, &parsed.version) {
        Some(path) => PathBuf::from(path),
        None => {
            let Some(storage) = app.try_state::<cogito_database::Storage>() else {
                responder.respond(reply(500, b"storage missing".to_vec(), "text/plain"));
                return;
            };
            let row = cogito_database::entity::asset::Entity::find_by_id(parsed.asset_id.clone())
                .one(storage.connection())
                .await;
            let Ok(Some(row)) = row else {
                responder.respond(reply(404, b"asset not found".to_vec(), "text/plain"));
                return;
            };
            service.remember_source(&parsed.asset_id, &parsed.version, &row.file_path);
            PathBuf::from(row.file_path)
        }
    };

    let content_type = content_type_for(&source);
    let is_streamable =
        content_type.starts_with("video/") || content_type.starts_with("audio/");
    let log_path = source.display().to_string();
    let read_source = source.clone();
    let read = tauri::async_runtime::spawn_blocking(move || -> Result<(OriginalPlan, Vec<u8>), String> {
        let len = std::fs::metadata(&read_source)
            .map_err(|error| format!("无法读取 {}：{error}", read_source.display()))?
            .len();
        let plan = plan_original(len, is_streamable, range.as_deref());
        if is_head {
            return Ok((plan, Vec::new()));
        }
        let bytes = read_slice(&read_source, plan)?;
        Ok((plan, bytes))
    })
    .await;

    match read {
        Ok(Ok((plan, bytes))) => responder.respond(original_reply(bytes, plan, content_type)),
        Ok(Err(error)) => {
            tracing::debug!("原图读取失败 {log_path}：{error}");
            responder.respond(reply(404, error.into_bytes(), "text/plain"));
        }
        Err(error) => {
            responder.respond(reply(500, error.to_string().into_bytes(), "text/plain"));
        }
    }
}

/// 协议入口：`/o/` 走原图，`/t/` 走缩略图（缓存命中直接回；未命中 → 渲染 → 落盘 → 回）。
pub fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let raw_path = request.uri().path();
    let Some(path) = percent_decode(raw_path) else {
        responder.respond(reply(400, b"bad thumb request".to_vec(), "text/plain"));
        return;
    };

    if let Some(original) = parse_original_uri(&path) {
        let range = request
            .headers()
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let is_head = request.method() == tauri::http::Method::HEAD;
        tauri::async_runtime::spawn(async move {
            serve_original(app, original, range, is_head, responder).await;
        });
        return;
    }

    let Some(parsed) = parse_thumb_uri(&path) else {
        responder.respond(reply(400, b"bad thumb request".to_vec(), "text/plain"));
        return;
    };

    tauri::async_runtime::spawn(async move {
        let Some(service) = app.try_state::<ThumbService>() else {
            responder.respond(reply(500, b"thumb service missing".to_vec(), "text/plain"));
            return;
        };
        let file = cache_path(service.root(), &parsed);
        if let Ok(bytes) = std::fs::read(&file) {
            responder.respond(jpeg_reply(bytes));
            return;
        }

        // 只认库内资产：协议不接受任意路径参数
        let source = match service.find_cached_source(&parsed.asset_id, &parsed.version) {
            Some(path) => PathBuf::from(path),
            None => {
                let Some(storage) = app.try_state::<cogito_database::Storage>() else {
                    responder.respond(reply(500, b"storage missing".to_vec(), "text/plain"));
                    return;
                };
                let row =
                    cogito_database::entity::asset::Entity::find_by_id(parsed.asset_id.clone())
                        .one(storage.connection())
                        .await;
                let Ok(Some(row)) = row else {
                    responder.respond(reply(404, b"asset not found".to_vec(), "text/plain"));
                    return;
                };
                service.remember_source(&parsed.asset_id, &parsed.version, &row.file_path);
                PathBuf::from(row.file_path)
            }
        };
        let bucket = parsed.bucket;
        let fit = parsed.fit;
        let log_path = source.display().to_string();
        // FFmpeg 兜底还要用同一个路径：`source` 会被第一个闭包吃掉
        let fallback_source = source.clone();
        // 闸门：最多 3 张同时解码（多余的排队，它们本来也只是等缓存落盘）
        let permit = render_slots().acquire().await;
        let rendered =
            tauri::async_runtime::spawn_blocking(move || render_jpeg(&source, bucket, fit)).await;
        drop(permit);

        match rendered {
            Ok(Ok(bytes)) => {
                if let Err(error) = write_atomic(&file, &bytes) {
                    tracing::debug!("缩略图落盘失败：{error}");
                }
                if service.should_prune() {
                    let root = service.root().to_path_buf();
                    tauri::async_runtime::spawn_blocking(move || prune(&root, CACHE_MAX_BYTES));
                }
                responder.respond(jpeg_reply(bytes));
            }
            Ok(Err(error)) => {
                // `image` 解不开：试 FFmpeg（HEIC / RAW / 视频首帧）。
                // 同一道闸门：视频格子多的时候不能同时拉起一堆 ffmpeg 进程。
                let app_for_decode = app.clone();
                let fallback_bucket = bucket;
                let permit = render_slots().acquire().await;
                let fallback = tauri::async_runtime::spawn_blocking(move || {
                    render_frame_with_ffmpeg(&app_for_decode, &fallback_source, fallback_bucket)
                })
                .await
                .ok()
                .flatten();
                drop(permit);
                if let Some(bytes) = fallback {
                    if let Err(write_error) = write_atomic(&file, &bytes) {
                        tracing::debug!("缩略图落盘失败：{write_error}");
                    }
                    responder.respond(jpeg_reply(bytes));
                    return;
                }
                tracing::debug!("缩略图渲染失败 {log_path}：{error}");
                responder.respond(reply(422, error.into_bytes(), "text/plain"));
            }
            Err(error) => {
                responder.respond(reply(500, error.to_string().into_bytes(), "text/plain"));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thumb_uri() {
        let parsed =
            parse_thumb_uri("/t/6f7714eb-bfa1-4b15/384/1699999999-cover.jpg").expect("应解析成功");
        assert_eq!(parsed.asset_id, "6f7714eb-bfa1-4b15");
        assert_eq!(parsed.bucket, 384);
        assert_eq!(parsed.version, "1699999999");
        assert_eq!(parsed.fit, Fit::Cover);

        // 越界 / 伪造的都不认
        assert!(parse_thumb_uri("/t/../../etc/passwd/384/1-cover.jpg").is_none());
        assert!(parse_thumb_uri("/t/id/384/1-zoom.jpg").is_none());
        assert!(parse_thumb_uri("/x/id/384/1-cover.jpg").is_none());
        assert!(parse_thumb_uri("/t/id/384/1-cover.jpg/extra").is_none());
        assert!(parse_thumb_uri("/t/id/notanumber/1-cover.jpg").is_none());
    }

    /// `convertFileSrc` 送上来的是整条百分号编码的路径，解码后才能按段解析。
    #[test]
    fn decodes_percent_encoded_uri() {
        let raw = "/%2Ft%2F6f7714eb-bfa1-4b15%2F384%2F1699999999-cover.jpg";
        let decoded = percent_decode(raw).expect("应解码成功");
        let parsed = parse_thumb_uri(&decoded).expect("解码后应解析成功");
        assert_eq!(parsed.asset_id, "6f7714eb-bfa1-4b15");
        assert_eq!(parsed.bucket, 384);

        // 没编码的原样返回
        assert_eq!(
            percent_decode("/t/id/384/1-cover.jpg").as_deref(),
            Some("/t/id/384/1-cover.jpg")
        );
        // 编码出来的目录逃逸仍然被挡
        let escaped = percent_decode("/t/%2E%2E%2F%2E%2E/384/1-cover.jpg").expect("解码成功");
        assert!(parse_thumb_uri(&escaped).is_none());
    }

    #[test]
    fn parses_original_uri_and_range() {
        let parsed = parse_original_uri("/o/6f7714eb-bfa1-4b15/1791469047319").expect("应解析成功");
        assert_eq!(parsed.asset_id, "6f7714eb-bfa1-4b15");
        assert_eq!(parsed.version, "1791469047319");

        assert!(parse_original_uri("/o/id").is_none());
        assert!(parse_original_uri("/o/id/1/extra").is_none());
        assert!(parse_original_uri("/t/id/384/1-cover.jpg").is_none());

        // Range：单段 / 结尾 N 字节 / 越界收敛 / 非法当整份
        assert_eq!(parse_range(Some("bytes=0-99"), 1000), Some((0, 99)));
        assert_eq!(parse_range(Some("bytes=100-"), 1000), Some((100, 999)));
        assert_eq!(parse_range(Some("bytes=-100"), 1000), Some((900, 999)));
        assert_eq!(parse_range(Some("bytes=0-99999"), 1000), Some((0, 999)));
        assert_eq!(parse_range(Some("bytes=abc"), 1000), None);
        assert_eq!(parse_range(Some("items=0-1"), 1000), None);
        assert_eq!(parse_range(None, 1000), None);
    }

    #[test]
    fn reads_original_slice() {
        let base = std::env::temp_dir().join(format!("cogito-original-{}", std::process::id()));
        std::fs::create_dir_all(&base).expect("mkdir");
        let file = base.join("blob.jpg");
        std::fs::write(&file, vec![7_u8; 1000]).expect("write");

        let plan = plan_original(1000, false, Some("bytes=10-19"));
        let bytes = read_slice(&file, plan).expect("读分片");
        assert_eq!(bytes.len(), 10);
        assert_eq!((plan.start, plan.end, plan.total, plan.is_partial), (10, 19, 1000, true));

        let plan = plan_original(1000, false, None);
        let bytes = read_slice(&file, plan).expect("读整份");
        assert_eq!(bytes.len(), 1000);
        assert!(!plan.is_partial);

        assert!(read_slice(&base.join("missing.jpg"), plan).is_err());
    }

    /// 这条是「播放视频闪退」的根因回归：播放器发 `bytes=0-`（整份）时，
    /// 曾经真的把整个文件读进内存 → 大视频直接 OOM。现在必须被截到分块上限。
    #[test]
    fn plan_never_exceeds_chunk() {
        let huge = 2 * 1024 * 1024 * 1024_u64; // 2 GB 录屏
        // 视频：即使客户端要整份，也只给第一块 206
        let plan = plan_original(huge, true, Some("bytes=0-"));
        assert!(plan.is_partial);
        assert_eq!(plan.start, 0);
        assert_eq!(plan.end, MAX_CHUNK_BYTES - 1);
        assert_eq!(plan.total, huge);

        // 视频：不带 Range 也一样分块
        let plan = plan_original(huge, true, None);
        assert!(plan.is_partial);
        assert_eq!(plan.end, MAX_CHUNK_BYTES - 1);

        // 只请求中间一段：照给，但不超上限
        let plan = plan_original(huge, true, Some("bytes=1048576-999999999"));
        assert_eq!(plan.start, 1_048_576);
        assert_eq!(plan.end, 1_048_576 + MAX_CHUNK_BYTES - 1);

        // 小图片：整份 200（`<img>` 不吃分块）
        let plan = plan_original(1024 * 1024, false, None);
        assert!(!plan.is_partial);
        assert_eq!((plan.start, plan.end), (0, 1024 * 1024 - 1));

        // 超大图片：超过整份上限就分块（RAW 也解不动，宁可给不了也不炸进程）
        let plan = plan_original(MAX_FULL_BYTES + 1, false, None);
        assert!(plan.is_partial);
        assert_eq!(plan.end, MAX_FULL_BYTES - 1);

        // 请求的区间正好覆盖整份 → 没必要 206
        let plan = plan_original(1000, false, Some("bytes=0-999"));
        assert!(!plan.is_partial);

        // 空文件不能算出 `end = -1`
        let plan = plan_original(0, true, Some("bytes=0-"));
        assert_eq!((plan.start, plan.end, plan.total), (0, 0, 0));
        assert!(!plan.is_partial);
    }

    #[test]
    fn snaps_to_buckets() {
        assert_eq!(pick_bucket(1), 192);
        assert_eq!(pick_bucket(192), 192);
        assert_eq!(pick_bucket(200), 384);
        assert_eq!(pick_bucket(768), 768);
        assert_eq!(pick_bucket(9999), 768);
        // 请求非桶尺寸时归一化到桶上（缓存不碎片化）
        assert_eq!(
            parse_thumb_uri("/t/id/300/1-cover.jpg").map(|req| req.bucket),
            Some(384)
        );
    }

    #[test]
    fn builds_sharded_cache_path() {
        let request = ThumbRequest {
            asset_id: "abcdef".to_string(),
            bucket: 384,
            version: "1700".to_string(),
            fit: Fit::Contain,
        };
        let path = cache_path(Path::new("C:/cache"), &request);
        assert!(path.ends_with("ab/abcdef_384_1700-contain.jpg"), "{path:?}");
    }

    #[test]
    fn renders_cover_square_and_keeps_panorama() {
        let base = std::env::temp_dir().join(format!("cogito-thumb-{}", std::process::id()));
        std::fs::create_dir_all(&base).expect("mkdir");

        // 竖图：cover 出正方形
        let tall = base.join("tall.png");
        DynamicImage::new_rgb8(400, 1200)
            .save(&tall)
            .expect("save tall");
        let bytes = render_jpeg(&tall, 192, Fit::Cover).expect("render tall");
        let decoded = image::load_from_memory(&bytes).expect("decode");
        assert_eq!((decoded.width(), decoded.height()), (192, 192));

        // 全景：cover 被降级成 contain，短边不塌成一条线
        let pano = base.join("pano.png");
        DynamicImage::new_rgb8(4000, 400)
            .save(&pano)
            .expect("save pano");
        let bytes = render_jpeg(&pano, 192, Fit::Cover).expect("render pano");
        let decoded = image::load_from_memory(&bytes).expect("decode");
        assert_eq!(decoded.width(), 192);
        assert!(
            decoded.height() >= 19,
            "全景短边应不小于 192/10，实际 {}",
            decoded.height()
        );

        // 小图不放大
        let small = base.join("small.png");
        DynamicImage::new_rgb8(64, 48)
            .save(&small)
            .expect("save small");
        let bytes = render_jpeg(&small, 384, Fit::Cover).expect("render small");
        let decoded = image::load_from_memory(&bytes).expect("decode");
        assert_eq!((decoded.width(), decoded.height()), (64, 48));

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn prunes_oldest_when_over_limit() {
        let root = std::env::temp_dir().join(format!("cogito-thumb-prune-{}", std::process::id()));
        let shard = root.join("aa");
        std::fs::create_dir_all(&shard).expect("mkdir");
        for index in 0..5 {
            std::fs::write(shard.join(format!("f{index}.jpg")), vec![0u8; 1024]).expect("write");
        }
        // 上限设成 3KB：必须清到 2.4KB 以下
        let freed = prune(&root, 3 * 1024);
        assert!(freed > 0, "应清掉一些文件");
        let left: u64 = std::fs::read_dir(&shard)
            .expect("read_dir")
            .flatten()
            .filter_map(|entry| entry.metadata().ok())
            .map(|meta| meta.len())
            .sum();
        assert!(left <= 3 * 1024, "剩余 {left} 字节应不超过上限");
        std::fs::remove_dir_all(&root).ok();
    }
}
