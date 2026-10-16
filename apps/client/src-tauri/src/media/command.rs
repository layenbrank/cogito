//! `media:probe` / `media:export` / `media:filmstrip` / `media:waveform`
//! — 调用本机 FFmpeg 9.0.2 资源二进制

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const EXPORT_PROGRESS_EVENT: &str = "media:export-progress";
const FILMSTRIP_FRAME_EVENT: &str = "media:filmstrip-frame";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub duration_ms: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_audio: bool,
    pub has_video: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub inputs: Vec<String>,
    pub output: String,
    pub filter_complex: String,
    pub map_video: String,
    pub map_audio: Option<String>,
    pub video_bitrate: String,
    pub audio_bitrate: String,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct FfprobeJson {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

fn is_usable_tool(path: &Path) -> bool {
    path.is_file()
        && std::fs::metadata(path)
            .map(|meta| meta.len() > 1024)
            .unwrap_or(false)
}

fn find_tool_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let exe_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1) resource dir (packaged)
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("binaries").join(&exe_name));
        candidates.push(resource_dir.join(&exe_name));
    }

    // 2) next to current exe / walk up for sidecar bootstrap binaries/
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(&exe_name));
            candidates.push(dir.join("binaries").join(&exe_name));
        }
        for ancestor in exe.ancestors().take(10) {
            candidates.push(ancestor.join("binaries").join(&exe_name));
            candidates.push(
                ancestor
                    .join("apps")
                    .join("client")
                    .join("src-tauri")
                    .join("binaries")
                    .join(&exe_name),
            );
        }
    }

    for candidate in candidates {
        if is_usable_tool(&candidate) {
            return Ok(candidate);
        }
    }

    Err(format!(
        "找不到可用的 {exe_name}，请确认 sidecar 已 bootstrap（FFmpeg 9.0.2）"
    ))
}

fn run_capture(bin: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows：隐藏控制台窗口，避免 ffprobe/ffmpeg 子系统闪窗或拖垮宿主
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("启动 {} 失败: {e}", bin.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{} 失败 ({}): {}",
            bin.display(),
            output.status,
            stderr.trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command(rename = "media:probe")]
pub async fn media_probe(app: AppHandle, path: String) -> Result<ProbeResult, String> {
    let ffprobe = find_tool_path(&app, "ffprobe")?;
    let media_path = path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let json = run_capture(
            &ffprobe,
            &[
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                &media_path,
            ],
        )?;

        let parsed: FfprobeJson =
            serde_json::from_str(&json).map_err(|e| format!("解析 ffprobe JSON 失败: {e}"))?;

        let duration_ms = parsed
            .format
            .and_then(|f| f.duration)
            .and_then(|d| d.parse::<f64>().ok())
            .map(|s| (s * 1000.0).round() as u64)
            .unwrap_or(0);

        let streams = parsed.streams.unwrap_or_default();
        let mut width = None;
        let mut height = None;
        let mut has_audio = false;
        let mut has_video = false;

        for stream in streams {
            match stream.codec_type.as_deref() {
                Some("video") => {
                    has_video = true;
                    if width.is_none() {
                        width = stream.width;
                        height = stream.height;
                    }
                }
                Some("audio") => has_audio = true,
                _ => {}
            }
        }

        Ok(ProbeResult {
            duration_ms,
            width,
            height,
            has_audio,
            has_video,
        })
    })
    .await
    .map_err(|e| format!("media:probe 线程异常: {e}"))?
}

#[tauri::command(rename = "media:export")]
pub async fn media_export(app: AppHandle, args: ExportArgs) -> Result<String, String> {
    let ffmpeg = find_tool_path(&app, "ffmpeg")?;
    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd_args: Vec<String> = Vec::new();
        cmd_args.push("-y".into());
        cmd_args.push("-hide_banner".into());

        for input in &args.inputs {
            cmd_args.push("-i".into());
            cmd_args.push(input.clone());
        }

        // color source is generated inside filter_complex; no extra input needed
        if !args.filter_complex.is_empty() {
            cmd_args.push("-filter_complex".into());
            cmd_args.push(args.filter_complex.clone());
            cmd_args.push("-map".into());
            cmd_args.push(args.map_video.clone());
            if let Some(map_audio) = &args.map_audio {
                cmd_args.push("-map".into());
                cmd_args.push(map_audio.clone());
            }
        }

        cmd_args.push("-r".into());
        cmd_args.push(args.fps.to_string());
        cmd_args.push("-c:v".into());
        cmd_args.push("libx264".into());
        cmd_args.push("-preset".into());
        cmd_args.push("veryfast".into());
        cmd_args.push("-b:v".into());
        cmd_args.push(args.video_bitrate.clone());
        cmd_args.push("-pix_fmt".into());
        cmd_args.push("yuv420p".into());

        if args.map_audio.is_some() {
            cmd_args.push("-c:a".into());
            cmd_args.push("aac".into());
            cmd_args.push("-b:a".into());
            cmd_args.push(args.audio_bitrate.clone());
        } else {
            cmd_args.push("-an".into());
        }

        cmd_args.push("-movflags".into());
        cmd_args.push("+faststart".into());
        cmd_args.push(args.output.clone());

        let mut export_cmd = Command::new(&ffmpeg);
        export_cmd
            .args(&cmd_args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            export_cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = export_cmd
            .spawn()
            .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;

        let stderr = child.stderr.take();
        if let Some(stderr) = stderr {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stderr);
            let mut last_progress = 0u32;
            for line in reader.lines().flatten() {
                // ffmpeg progress lines contain time=HH:MM:SS.xx
                if let Some(progress) = parse_ffmpeg_time_progress(&line) {
                    if progress != last_progress {
                        last_progress = progress;
                        let _ = app_handle.emit(
                            EXPORT_PROGRESS_EVENT,
                            serde_json::json!({ "progress": progress }),
                        );
                    }
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("等待 ffmpeg 结束失败: {e}"))?;

        if !status.success() {
            return Err(format!("ffmpeg 导出失败 ({status})"));
        }

        let _ = app_handle.emit(
            EXPORT_PROGRESS_EVENT,
            serde_json::json!({ "progress": 100 }),
        );

        Ok(args.output)
    })
    .await
    .map_err(|e| format!("media:export 线程异常: {e}"))?
}

fn parse_ffmpeg_time_progress(line: &str) -> Option<u32> {
    // crude: look for time=00:01:23.45 and map minutes roughly to 0-99
    let idx = line.find("time=")?;
    let rest = &line[idx + 5..];
    let token = rest.split_whitespace().next()?;
    let parts: Vec<&str> = token.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    let total_secs = hours * 3600.0 + minutes * 60.0 + seconds;
    // Without total duration we only emit a soft rising signal capped at 95
    let soft = ((total_secs / 120.0) * 95.0).min(95.0) as u32;
    Some(soft)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmstripFramesArgs {
    pub path: String,
    /// 源时间点（毫秒）。调用方按「先疏后密」排序；单次最多 120。
    pub times_ms: Vec<u64>,
    pub tile_width: Option<u32>,
    pub tile_height: Option<u32>,
    /// 渐进事件关联 id；每落一帧发 `media:filmstrip-frame`
    #[serde(default)]
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilmstripFrameEvent {
    request_id: String,
    time_ms: u64,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmstripFrame {
    pub time_ms: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmstripFramesResult {
    pub frames: Vec<FilmstripFrame>,
    pub tile_width: u32,
    pub tile_height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformArgs {
    pub path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformResult {
    pub wave_path: String,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}

fn find_cache_dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法解析 app cache: {e}"))?
        .join("clipchamp")
        .join(kind);
    std::fs::create_dir_all(&root).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    Ok(root)
}

fn hash_cache_key(parts: &[&str]) -> String {
    let mut hasher = DefaultHasher::new();
    for part in parts {
        part.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

fn file_fingerprint(path: &str) -> String {
    let meta = std::fs::metadata(path).ok();
    let len = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .unwrap_or(Duration::ZERO)
        .as_secs();
    format!("{path}|{len}|{modified}")
}

fn probe_duration_ms(ffprobe: &Path, media_path: &str) -> Result<u64, String> {
    let json = run_capture(
        ffprobe,
        &[
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            media_path,
        ],
    )?;
    let parsed: FfprobeJson =
        serde_json::from_str(&json).map_err(|e| format!("解析 ffprobe JSON 失败: {e}"))?;
    Ok(parsed
        .format
        .and_then(|f| f.duration)
        .and_then(|d| d.parse::<f64>().ok())
        .map(|s| (s * 1000.0).round() as u64)
        .unwrap_or(0))
}

fn run_ffmpeg(ffmpeg: &Path, args: &[String]) -> Result<(), String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffmpeg 失败 ({}): {}",
            output.status,
            stderr.trim()
        ));
    }
    Ok(())
}

fn dedup_keep_order(times: Vec<u64>) -> Vec<u64> {
    let mut seen = HashSet::new();
    times.into_iter().filter(|time| seen.insert(*time)).collect()
}

/// 按时间点抽帧（`-ss` 在 `-i` 前）。
/// 保持调用方顺序（先疏后密）。每落一帧发 `media:filmstrip-frame`，不等整批结束。
#[tauri::command(rename = "media:filmstrip-frames")]
pub async fn media_filmstrip_frames(
    app: AppHandle,
    args: FilmstripFramesArgs,
) -> Result<FilmstripFramesResult, String> {
    let ffmpeg = find_tool_path(&app, "ffmpeg")?;
    let cache_dir = find_cache_dir(&app, "frames")?;
    let media_path = args.path.clone();
    let request_id = args.request_id.clone();
    let tile_width = args.tile_width.unwrap_or(120).clamp(40, 240);
    let tile_height = args.tile_height.unwrap_or(68).clamp(24, 135);

    let mut times = dedup_keep_order(args.times_ms);
    if times.len() > 120 {
        times.truncate(120);
    }
    if times.is_empty() {
        return Ok(FilmstripFramesResult {
            frames: vec![],
            tile_width,
            tile_height,
        });
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let fingerprint = file_fingerprint(&media_path);
        let vf = format!(
            "scale={tile_width}:{tile_height}:flags=fast_bilinear:force_original_aspect_ratio=decrease,pad={tile_width}:{tile_height}:(ow-iw)/2:(oh-ih)/2:color=black"
        );

        let emit_frame = |time_ms: u64, path: &std::path::Path| {
            let _ = app_handle.emit(
                FILMSTRIP_FRAME_EVENT,
                FilmstripFrameEvent {
                    request_id: request_id.clone(),
                    time_ms,
                    path: path.to_string_lossy().to_string(),
                },
            );
        };

        let mut frames: Vec<FilmstripFrame> = Vec::with_capacity(times.len());
        // 4 路：2528×1340 这类片源单次 seek ~300ms，再多会抢磁盘，第一批反而更晚
        const CHUNK: usize = 4;
        for chunk in times.chunks(CHUNK) {
            let mut children = Vec::with_capacity(chunk.len());
            for &time_ms in chunk {
                let key = hash_cache_key(&[
                    &fingerprint,
                    &format!("t{time_ms}"),
                    &format!("tw{tile_width}"),
                    &format!("th{tile_height}"),
                ]);
                let out_path = cache_dir.join(format!("{key}.jpg"));
                if out_path.is_file()
                    && std::fs::metadata(&out_path)
                        .map(|m| m.len() > 64)
                        .unwrap_or(false)
                {
                    emit_frame(time_ms, &out_path);
                    frames.push(FilmstripFrame {
                        time_ms,
                        path: out_path.to_string_lossy().to_string(),
                    });
                    continue;
                }

                let ss = format!("{:.3}", time_ms as f64 / 1000.0);
                let out = out_path.to_string_lossy().to_string();
                let mut cmd = Command::new(&ffmpeg);
                cmd.args([
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-threads",
                    "1",
                    "-ss",
                    &ss,
                    "-i",
                    &media_path,
                    "-frames:v",
                    "1",
                    "-an",
                    "-vf",
                    &vf,
                    "-q:v",
                    "8",
                    &out,
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }
                match cmd.spawn() {
                    Ok(child) => children.push((time_ms, out_path, child)),
                    Err(e) => {
                        return Err(format!("启动 ffmpeg 抽帧失败: {e}"));
                    }
                }
            }

            while !children.is_empty() {
                let mut index = 0;
                let mut progressed = false;
                while index < children.len() {
                    match children[index].2.try_wait() {
                        Ok(Some(status)) => {
                            let (time_ms, out_path, _) = children.remove(index);
                            progressed = true;
                            if status.success()
                                && out_path.is_file()
                                && std::fs::metadata(&out_path)
                                    .map(|m| m.len() > 64)
                                    .unwrap_or(false)
                            {
                                emit_frame(time_ms, &out_path);
                                frames.push(FilmstripFrame {
                                    time_ms,
                                    path: out_path.to_string_lossy().to_string(),
                                });
                            }
                        }
                        Ok(None) => index += 1,
                        Err(e) => return Err(format!("等待 ffmpeg 抽帧失败: {e}")),
                    }
                }
                if !progressed && !children.is_empty() {
                    std::thread::sleep(Duration::from_millis(12));
                }
            }
        }

        frames.sort_by_key(|frame| frame.time_ms);
        Ok(FilmstripFramesResult {
            frames,
            tile_width,
            tile_height,
        })
    })
    .await
    .map_err(|e| format!("media:filmstrip-frames 线程异常: {e}"))?
}

/// 生成音频波形预览图（png），时间轴按 sourceIn/duration 裁切 blit。
#[tauri::command(rename = "media:waveform")]
pub async fn media_waveform(app: AppHandle, args: WaveformArgs) -> Result<WaveformResult, String> {
    let ffmpeg = find_tool_path(&app, "ffmpeg")?;
    let ffprobe = find_tool_path(&app, "ffprobe")?;
    let cache_dir = find_cache_dir(&app, "waveform")?;
    let media_path = args.path.clone();
    let width = args.width.unwrap_or(1280).clamp(320, 4096);
    let height = args.height.unwrap_or(64).clamp(24, 256);

    tauri::async_runtime::spawn_blocking(move || {
        let duration_ms = probe_duration_ms(&ffprobe, &media_path)?.max(1);
        let fingerprint = file_fingerprint(&media_path);
        let key = hash_cache_key(&[&fingerprint, &format!("w{width}"), &format!("h{height}")]);
        let wave_path = cache_dir.join(format!("{key}.png"));

        if !is_usable_tool(&wave_path) {
            let filter = format!(
                "[0:a]aformat=channel_layouts=mono,compand,showwavespic=s={width}x{height}:colors=0x34d399[out]"
            );
            let out = wave_path.to_string_lossy().to_string();
            run_ffmpeg(
                &ffmpeg,
                &[
                    "-y".into(),
                    "-hide_banner".into(),
                    "-loglevel".into(),
                    "error".into(),
                    "-i".into(),
                    media_path.clone(),
                    "-filter_complex".into(),
                    filter,
                    "-map".into(),
                    "[out]".into(),
                    "-frames:v".into(),
                    "1".into(),
                    out,
                ],
            )?;
            if !wave_path.is_file() {
                return Err("waveform 生成后文件不存在（素材可能无音轨）".into());
            }
        }

        Ok(WaveformResult {
            wave_path: wave_path.to_string_lossy().to_string(),
            width,
            height,
            duration_ms,
        })
    })
    .await
    .map_err(|e| format!("media:waveform 线程异常: {e}"))?
}
