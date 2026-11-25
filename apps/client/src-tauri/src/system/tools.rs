//! 在线工具（FFmpeg / Pandoc）的按需下载、校验、解压与卸载。
//!
//! 设计对齐 Studio 的 `capabilities/tools`，但实现落在 Rust 侧（client 没有 Node 主进程）：
//!
//! - 版本 / 直链 / sha256 **只钉一次**：构建期把仓库的
//!   `scripts/commands/features/sidecar/tools.lock.json` 内联进来（`include_str!`），
//!   客户端不另存一份清单；
//! - 落点 `<appLocalData>/sidecar/<tool>/<version>/`：版本进路径，升级就是换目录，
//!   卸载整包删；取用顺序 **下载的那份优先于随包那份**（见 `media::command::find_tool_path`）；
//! - 全程在 `<tool>/<version>.tmp/` 里做，最后一步才 `rename` 上位：断网 / 断电 /
//!   校验失败都不会在正式目录留下半份；
//! - 下载边写边算 sha256（少读一遍 165 MB 的大文件），进度按 100ms 节流通过
//!   `tools://install-progress` 推给「设置 → 诊断」。
//!
//! 解压不引第三方归档库：与 Studio 一致走系统 `tar`（Windows 10+ 自带 bsdtar，认 zip 与
//! tar.\*），zip 失败再回退 `Expand-Archive` / `unzip`。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

/// 下载进度事件（与 `channels.ts` 的 `CHANNELS.TOOLS.INSTALL_PROGRESS` 同名）
const PROGRESS_EVENT: &str = "tools://install-progress";
/// 进度节流：大包按 chunk 直推能给前端造成上万次 setState
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
/// 单次读 chunk 的超时：连上但长时间不给数据是大文件下载最常见的失败形态
const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);
/// 下载总超时兜底：60s × N 也救不了「服务器慢慢滴数据」
const MAX_DOWNLOAD: Duration = Duration::from_secs(30 * 60);

/// 构建期内联的版本清单（与 Studio / CLI 同一份）。
const TOOLS_LOCK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../scripts/commands/features/sidecar/tools.lock.json"
));

/// 允许按需下载的包（lock 里标了 `onDemand` 且有在线直链的才算真正可装）。
///
/// 只列 client 真正消费的两个：`opencode` 是 Studio 的 agent 运行时，这里用 goose。
const PACKAGES: [(&str, &[&str]); 2] = [
    ("ffmpeg", &["ffmpeg", "ffprobe", "ffplay"]),
    ("pandoc", &["pandoc"]),
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolsLock {
    schema_version: u32,
    tools: HashMap<String, LockedTool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockedTool {
    #[serde(default)]
    on_demand: bool,
    platforms: HashMap<String, LockedPin>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockedPin {
    version: String,
    url: String,
    sha256: String,
}

fn lock() -> &'static ToolsLock {
    static LOCK: OnceLock<ToolsLock> = OnceLock::new();
    LOCK.get_or_init(|| {
        let parsed: ToolsLock = serde_json::from_str(TOOLS_LOCK)
            .expect("tools.lock.json 解析失败：形状变了就要同步改 system/tools.rs");
        assert_eq!(
            parsed.schema_version, 2,
            "tools.lock.json schemaVersion 不是 2"
        );
        parsed
    })
}

/// 平台键：`win32-x64` / `darwin-arm64` / `linux-x64`（与 `@cogito/sidecar` 同口径）。
pub fn platform_key() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "win32-x64",
        ("windows", "aarch64") => "win32-arm64",
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        _ => "unsupported",
    }
}

/// 能力键 → 包键。`ffprobe` 与 `ffmpeg` 在同一个归档里。
pub fn package_for(capability: &str) -> Option<&'static str> {
    match capability {
        "ffmpeg" | "ffprobe" => Some("ffmpeg"),
        "pandoc" => Some("pandoc"),
        _ => None,
    }
}

fn binaries_for(package: &str) -> &'static [&'static str] {
    PACKAGES
        .iter()
        .find(|(key, _)| *key == package)
        .map(|(_, binaries)| *binaries)
        .unwrap_or(&[])
}

/// 没有它们就算没装好（`ffplay` 不是必需：有的发行版不带）。
///
/// 幂等判定与安装完成校验都用这一份：半份安装（比如只有 ffmpeg 没 ffprobe）
/// 会让能力面板永远显示缺失，却又因为「主程序在」而拒绝重装。
fn required_binaries(package: &str) -> &'static [&'static str] {
    match package {
        "ffmpeg" => &["ffmpeg", "ffprobe"],
        "pandoc" => &["pandoc"],
        _ => &[],
    }
}

fn is_complete(package: &str, dir: &Path) -> bool {
    required_binaries(package)
        .iter()
        .all(|binary| dir.join(exe_name(binary)).is_file())
}

fn pin_for(package: &str) -> Option<LockedPin> {
    if !PACKAGES.iter().any(|(key, _)| *key == package) {
        return None;
    }
    let tool = lock().tools.get(package)?;
    if !tool.on_demand {
        return None;
    }
    tool.platforms.get(platform_key()).cloned()
}

/// 这个能力键当前平台能不能补装（`ffprobe` 跟着 `ffmpeg` 走）。
pub fn is_installable(capability: &str) -> bool {
    package_for(capability).and_then(pin_for).is_some()
}

/// 安装根：`<appLocalData>/sidecar`（与 Studio 的 `<userData>/sidecar` 同构）。
pub fn install_root() -> Option<PathBuf> {
    crate::utils::instance::app_local_data_dir().map(|dir| dir.join("sidecar"))
}

/// 某个包当前版本该落的目录。
fn version_dir(package: &str) -> Option<PathBuf> {
    let pin = pin_for(package)?;
    Some(install_root()?.join(package).join(pin.version))
}

/// 已下载的所有包版本目录（找不到安装根时为空）。
pub fn installed_dirs() -> Vec<PathBuf> {
    PACKAGES
        .iter()
        .filter_map(|(key, _)| version_dir(key))
        .collect()
}

/// 这个路径是不是「用户下载的那份」（而不是随包内置）。
pub fn is_installed_path(path: &Path) -> bool {
    install_root()
        .map(|root| path.starts_with(root))
        .unwrap_or(false)
}

fn exe_name(binary: &str) -> String {
    if cfg!(windows) {
        format!("{binary}.exe")
    } else {
        binary.to_string()
    }
}

/// 同一包同时只允许一个安装：两个请求抢同一个目录只会得到半份文件。
static INSTALLING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn installing() -> &'static Mutex<HashSet<String>> {
    INSTALLING.get_or_init(|| Mutex::new(HashSet::new()))
}

struct InstallingGuard {
    key: String,
}

impl InstallingGuard {
    fn acquire(key: &str) -> Result<Self, String> {
        let mut guard = installing()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !guard.insert(key.to_string()) {
            return Err("正在下载中，先等它结束".to_string());
        }
        Ok(Self {
            key: key.to_string(),
        })
    }
}

impl Drop for InstallingGuard {
    fn drop(&mut self) {
        let mut guard = installing()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.remove(&self.key);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    key: String,
    /// `download` / `extract`
    phase: &'static str,
    received: u64,
    total: u64,
}

fn emit_progress(app: &AppHandle, key: &str, phase: &'static str, received: u64, total: u64) {
    let _ = app.emit(
        PROGRESS_EVENT,
        InstallProgress {
            key: key.to_string(),
            phase,
            received,
            total,
        },
    );
}

fn archive_name(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|segments| segments.last())
                .map(str::to_string)
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "package.bin".to_string())
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

fn run_quiet(mut cmd: Command) -> Result<(), String> {
    hide_console(&mut cmd);
    let output = cmd
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("启动外部命令失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

/// 解压：系统 tar 优先（Windows 10+ 自带 bsdtar，认 zip / tar.gz / tar.xz），
/// zip 失败再回退 PowerShell / unzip。
fn extract_archive(archive: &Path, dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| format!("创建解压目录失败：{error}"))?;

    let mut tar = Command::new("tar");
    tar.arg("-xf").arg(archive).arg("-C").arg(dir);
    let tar_error = match run_quiet(tar) {
        Ok(()) => return Ok(()),
        Err(error) => error,
    };

    let is_zip = archive
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);
    if !is_zip {
        return Err(format!("tar 解压失败：{tar_error}"));
    }

    #[cfg(windows)]
    {
        let script = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            archive.display().to_string().replace('\'', "''"),
            dir.display().to_string().replace('\'', "''")
        );
        let mut powershell = Command::new("powershell.exe");
        powershell
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(script);
        return run_quiet(powershell)
            .map_err(|error| format!("解压失败（tar: {tar_error}；Expand-Archive: {error}）"));
    }
    #[cfg(not(windows))]
    {
        let mut unzip = Command::new("unzip");
        unzip.arg("-o").arg(archive).arg("-d").arg(dir);
        run_quiet(unzip).map_err(|error| format!("解压失败（tar: {tar_error}；unzip: {error}）"))
    }
}

/// 归档里按 basename 找（各家的目录层级都不一样，不猜路径）。
fn find_in_tree(root: &Path, file_name: &str) -> Option<PathBuf> {
    use std::collections::VecDeque;
    let mut queue = VecDeque::from([root.to_path_buf()]);
    while let Some(current) = queue.pop_front() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            if is_dir {
                queue.push_back(path);
            } else if entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(file_name)
            {
                return Some(path);
            }
        }
    }
    None
}

async fn download_to(
    app: &AppHandle,
    package: &str,
    pin: &LockedPin,
    dest: &Path,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("初始化下载客户端失败：{error}"))?;
    let mut response = client
        .get(&pin.url)
        .send()
        .await
        .map_err(|error| format!("下载失败：{error}（{}）", pin.url))?;
    if !response.status().is_success() {
        return Err(format!(
            "下载失败：HTTP {}（{}）",
            response.status(),
            pin.url
        ));
    }

    let total = response.content_length().unwrap_or(0);
    let deadline = Instant::now() + MAX_DOWNLOAD;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last_emit = Instant::now();

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|error| format!("创建下载文件失败：{error}"))?;

    emit_progress(app, package, "download", 0, total);
    loop {
        if Instant::now() >= deadline {
            return Err(format!(
                "下载超过 {} 分钟仍未完成（已收 {received} 字节）",
                MAX_DOWNLOAD.as_secs() / 60
            ));
        }
        let chunk = tokio::time::timeout(CHUNK_TIMEOUT, response.chunk())
            .await
            .map_err(|_| {
                format!(
                    "下载停滞超过 {} 秒（已收 {received} 字节）",
                    CHUNK_TIMEOUT.as_secs()
                )
            })?
            .map_err(|error| format!("下载中断：{error}"))?;
        let Some(chunk) = chunk else { break };
        hasher.update(&chunk);
        received += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("写入下载文件失败：{error}"))?;
        if last_emit.elapsed() >= PROGRESS_INTERVAL {
            last_emit = Instant::now();
            emit_progress(app, package, "download", received, total);
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("收尾下载文件失败：{error}"))?;
    drop(file);
    emit_progress(app, package, "download", received, total.max(received));

    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(&pin.sha256) {
        return Err(format!(
            "{}: 校验不通过（期望 {}…，实际 {}…）",
            package,
            &pin.sha256[..pin.sha256.len().min(12)],
            &actual[..actual.len().min(12)]
        ));
    }
    Ok(())
}

/// 把一个包从「临时目录」推进到正式目录：解压 → 只留二进制 → rename 上位。
fn stage_package(package: &str, archive: &Path, work: &Path, dest: &Path) -> Result<(), String> {
    let extract_dir = work.join("extract");
    extract_archive(archive, &extract_dir)?;

    let out_dir = work.join("out");
    fs::create_dir_all(&out_dir).map_err(|error| format!("创建安装目录失败：{error}"))?;
    let mut found = 0usize;
    for binary in binaries_for(package) {
        let name = exe_name(binary);
        let Some(source) = find_in_tree(&extract_dir, &name) else {
            continue;
        };
        let target = out_dir.join(&name);
        fs::copy(&source, &target).map_err(|error| format!("复制 {name} 失败：{error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o755));
        }
        found += 1;
    }
    if found == 0 {
        return Err(format!("{package}：归档里没找到可执行文件"));
    }
    for required in required_binaries(package) {
        if !out_dir.join(exe_name(required)).is_file() {
            return Err(format!("{package}：归档里缺少 {required}"));
        }
    }

    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|error| {
            format!(
                "清理旧版本失败（{}）：{error}；如果有程序正在使用该工具，请先退出",
                dest.display()
            )
        })?;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建工具目录失败：{error}"))?;
    }
    fs::rename(&out_dir, dest)
        .map_err(|error| format!("安装落位失败（{}）：{error}", dest.display()))
}

async fn install(app: AppHandle, requested: String) -> Result<(), String> {
    let package = package_for(&requested)
        .unwrap_or(requested.as_str())
        .to_string();
    let pin = pin_for(&package).ok_or_else(|| format!("{package}：当前平台没有可下载的版本"))?;
    let root = install_root().ok_or_else(|| "取不到应用数据目录".to_string())?;
    let dest = root.join(&package).join(&pin.version);

    if is_complete(&package, &dest) {
        return Ok(());
    }

    let _guard = InstallingGuard::acquire(&package)?;
    let work = root.join(&package).join(format!("{}.tmp", pin.version));
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|error| format!("创建下载目录失败：{error}"))?;

    let archive = work.join(archive_name(&pin.url));
    let outcome = async {
        download_to(&app, &package, &pin, &archive).await?;
        emit_progress(&app, &package, "extract", 1, 1);
        let package_for_task = package.clone();
        let work_for_task = work.clone();
        let archive_for_task = archive.clone();
        let dest_for_task = dest.clone();
        tauri::async_runtime::spawn_blocking(move || {
            stage_package(
                &package_for_task,
                &archive_for_task,
                &work_for_task,
                &dest_for_task,
            )
        })
        .await
        .map_err(|error| format!("安装线程异常：{error}"))??;
        Ok::<(), String>(())
    }
    .await;

    let _ = fs::remove_dir_all(&work);
    outcome
}

#[tauri::command(rename = "tools:install")]
pub async fn tools_install(app: AppHandle, key: String) -> Result<(), String> {
    install(app, key).await
}

#[tauri::command(rename = "tools:remove")]
pub async fn tools_remove(key: String) -> Result<(), String> {
    let package = package_for(&key).unwrap_or(key.as_str()).to_string();
    if package_for(&package).is_none() {
        return Err(format!("未知工具：{key}"));
    }
    if installing()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(&package)
    {
        return Err("正在下载中，先等它结束".to_string());
    }
    let root = install_root().ok_or_else(|| "取不到应用数据目录".to_string())?;
    let dir = root.join(&package);
    tauri::async_runtime::spawn_blocking(move || {
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|error| {
                format!(
                    "卸载失败（{}）：{error}；如果有程序正在使用该工具，请先退出",
                    dir.display()
                )
            })?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("卸载线程异常：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_is_parsed_and_has_platform_entries() {
        let parsed = lock();
        assert_eq!(parsed.schema_version, 2);
        // 两个包都必须有至少一个平台条目，否则这个功能在发布版里等于不存在
        for (package, _) in PACKAGES {
            let tool = parsed.tools.get(package).expect("lock 缺工具");
            assert!(!tool.platforms.is_empty(), "{package} 没有任何平台直链");
        }
    }

    #[test]
    fn ffprobe_shares_the_ffmpeg_package() {
        assert_eq!(package_for("ffprobe"), Some("ffmpeg"));
        assert_eq!(package_for("ffmpeg"), Some("ffmpeg"));
        assert_eq!(package_for("pandoc"), Some("pandoc"));
        assert_eq!(package_for("goose"), None);
    }

    #[test]
    fn archive_name_comes_from_url_path() {
        assert_eq!(
            archive_name("https://example.com/a/ffmpeg-windows-x64.zip"),
            "ffmpeg-windows-x64.zip"
        );
        assert_eq!(
            archive_name("https://example.com/download?file=pandoc.zip"),
            "download"
        );
    }

    #[test]
    fn supported_packages_are_on_demand() {
        for (package, _) in PACKAGES {
            let tool = lock().tools.get(package).expect("lock 缺工具");
            assert!(tool.on_demand, "{package} 在 lock 里没标 onDemand");
        }
    }

    #[test]
    fn completeness_requires_all_required_binaries() {
        let dir =
            std::env::temp_dir().join(format!("cogito-tools-complete-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("建临时目录");
        assert!(!is_complete("ffmpeg", &dir));
        fs::write(dir.join(exe_name("ffmpeg")), b"stub").expect("写桩");
        assert!(
            !is_complete("ffmpeg", &dir),
            "只有 ffmpeg 没 ffprobe 不算装好，否则 ffprobe 行会永远卡在「可下载」"
        );
        fs::write(dir.join(exe_name("ffprobe")), b"stub").expect("写桩");
        assert!(is_complete("ffmpeg", &dir));
        let _ = fs::remove_dir_all(&dir);
    }
}
