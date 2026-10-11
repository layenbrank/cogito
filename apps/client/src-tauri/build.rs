fn main() {
    let host = std::env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| std::env::var("TARGET"))
        .unwrap_or_else(|_| {
            std::process::Command::new("rustc")
                .args(["--print", "host-tuple"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| "x86_64-pc-windows-msvc".into())
        });

    // pdfium：resources 映射到安装目录根；缺了 PDF morph 动作起不来。
    require_nonempty(
        "binaries/pdfium.dll",
        "run `pnpm command sidecar bootstrap client` at repo root",
    );

    // externalBin：daemon（IPC）+ mcp（Agent）+ goose（ACP）
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    for stem in ["corex-daemon", "corex-mcp", "goose"] {
        let path = format!("binaries/{stem}-{host}{suffix}");
        require_nonempty(&path, "run `pnpm command sidecar bootstrap client` at repo root");
    }

    tauri_build::build()
}

fn require_nonempty(relative: &str, hint: &str) {
    let path = std::path::Path::new(relative);
    if !path.exists() {
        panic!("{relative} missing; {hint}");
    }
    let meta = std::fs::metadata(path).unwrap_or_else(|e| panic!("stat {relative}: {e}"));
    if meta.len() == 0 {
        panic!("{relative} is empty; {hint}");
    }
}
