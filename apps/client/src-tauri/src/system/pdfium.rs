//! pdfium 动态库路径解析 + 知识库 PDF 文本抽取入口。
//!
//! Windows 打包：`binaries/pdfium.dll` → 安装根 `pdfium.dll`。
//! 当前无 `pdfium-render` 绑定：优先旁路 `.md`；否则登记占位正文。
//! `extract_images=true` 时扫描 `media_dir` 下已有同 stem 图片并回传路径（供 caption）。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExtractResult {
    pub path: String,
    pub page_count: usize,
    pub markdown: String,
    pub image_paths: Vec<String>,
}

/// 按平台查找 pdfium 动态库。
pub fn find_pdfium_library<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let resource = app.path().resource_dir().ok()?;
    let candidates = [
        resource.join("pdfium.dll"),
        resource.join("pdfium").join("pdfium.dll"),
        resource.join("libpdfium.dylib"),
        resource.join("libpdfium.so"),
        resource.join("binaries").join("pdfium.dll"),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn collect_media_images(media_dir: &Path, stem: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(media_dir) else {
        return Vec::new();
    };
    let stem_lower = stem.to_ascii_lowercase();
    let mut paths = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_image = name.ends_with(".png")
            || name.ends_with(".jpg")
            || name.ends_with(".jpeg")
            || name.ends_with(".webp")
            || name.ends_with(".gif");
        if is_image && (stem_lower.is_empty() || name.contains(&stem_lower)) {
            paths.push(path.display().to_string());
        }
    }
    paths.sort();
    paths
}

/// 轻量抽取：旁路同名 `.md` → 占位 markdown；可选收集 media 目录已有图片。
pub fn extract_pdf_markdown(
    path: &Path,
    media_dir: Option<&Path>,
    extract_images: bool,
) -> Result<PdfExtractResult, String> {
    if !path.is_file() {
        return Err(format!("PDF 不存在: {}", path.display()));
    }
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("document.pdf");

    if let Some(dir) = media_dir {
        let _ = std::fs::create_dir_all(dir);
    }

    let image_paths = if extract_images {
        media_dir
            .map(|dir| collect_media_images(dir, stem))
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let cached = path.with_extension("md");
    if cached.is_file() {
        let markdown = std::fs::read_to_string(&cached).map_err(|e| e.to_string())?;
        return Ok(PdfExtractResult {
            path: path.display().to_string(),
            page_count: 0,
            markdown,
            image_paths,
        });
    }

    let images_note = if image_paths.is_empty() {
        String::new()
    } else {
        format!(
            "\n\n## 关联图片\n\n{}\n",
            image_paths
                .iter()
                .map(|p| format!("- `{p}`"))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };

    Ok(PdfExtractResult {
        path: path.display().to_string(),
        page_count: 0,
        markdown: format!(
            "---\ntitle: \"{name}\"\nsources: [\"{name}\"]\n---\n\n# {name}\n\n> PDF 原文已登记。当前 pdfium 路径为轻量占位（未绑定 pdfium-render）；请用旁路同名 `.md` 或 MinerU 获取正文。{images_note}\n"
        ),
        image_paths,
    })
}

#[tauri::command(rename = "knowledge:extract-pdf")]
pub fn knowledge_extract_pdf(
    path: String,
    media_dir: Option<String>,
    extract_images: Option<bool>,
) -> Result<PdfExtractResult, String> {
    let pdf = PathBuf::from(&path);
    let media = media_dir.as_deref().map(Path::new);
    extract_pdf_markdown(&pdf, media, extract_images.unwrap_or(false))
}

#[tauri::command(rename = "knowledge:find-pdfium")]
pub fn knowledge_find_pdfium(app: AppHandle) -> Option<String> {
    find_pdfium_library(&app).map(|path| path.display().to_string())
}
