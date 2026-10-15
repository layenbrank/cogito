//! `media:probe` / `media:export` — 调用本机 FFmpeg 9.0.2 资源二进制

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const EXPORT_PROGRESS_EVENT: &str = "media:export-progress";

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
