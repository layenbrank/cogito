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

    // externalBin：daemon（IPC）+ corex mcp（Agent）+ cogito mcp（本地工具面）+ goose（ACP）
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    for stem in ["corex-daemon", "corex-mcp", "cogito-mcp", "goose"] {
        let path = format!("binaries/{stem}-{host}{suffix}");
        require_nonempty(
            &path,
            "run `pnpm command sidecar bootstrap client` at repo root",
        );
    }

    tauri_build::build();

    link_test_resources();
}

/// 让 test 可执行文件也能拿到 `tauri_build::build()` 那份资源库（含 manifest）。
///
/// 背景：test 可执行文件会链进 `windows` crate（经 tauri），里面用到
/// `comctl32!TaskDialogIndirect`。这个入口点只有在 exe 的 manifest 声明了
/// Common Controls v6 时才解析得到；缺了它，进程在跑第一个用例之前就以
/// 0xc0000139（STATUS_ENTRYPOINT_NOT_FOUND）退出，`cargo test` 只会报
/// "test exited abnormally"，看不出真正原因。
///
/// `resource.lib`（OUT_DIR 下，`resource.rc` 里 `1 24 { ... Microsoft.Windows.Common-Controls ... }`）
/// 已经带上了这份 manifest，但 tauri 只用 `cargo:rustc-link-arg-bins` 发给 bins。
/// 剩下两类 test 目标要分别补：
///
/// - `tests/` 下的集成测试：`cargo:rustc-link-arg-tests`（本文件）
/// - lib 单测：cargo 没有对应指令（`-tests` 不覆盖 lib 单测目标），
///   靠 `src/lib.rs` 里 `#[cfg(all(test, target_os = "windows"))] #[link(name = "resource")]`，
///   搜索路径由此处的 `cargo:rustc-link-search` 提供
///
/// 别改成 `cargo:rustc-link-arg=/MANIFESTINPUT:xxx.manifest` + `/MANIFEST:EMBED`：
/// 那是"再嵌一份"，会和 `resource.lib` 里已有的 MANIFEST 资源撞成
/// CVT1100（资源重复），bins 直接链接失败。
fn link_test_resources() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out_dir = match std::env::var("OUT_DIR") {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let resource = std::path::Path::new(&out_dir).join("resource.lib");
    if !resource.exists() {
        // tauri-build 没产资源库（换了资源方案）：保持旧行为，只是 test 可能起不来，
        // 给个提示而不是让构建无声地坏掉。
        println!(
            "cargo:warning=resource.lib missing in OUT_DIR; test binaries may exit with 0xc0000139"
        );
        return;
    }
    let out_dir = quote_if_needed(&out_dir);
    let resource = quote_if_needed(&resource.display().to_string());
    println!("cargo:rustc-link-search=native={out_dir}");
    println!("cargo:rustc-link-arg-tests={resource}");
}

/// 工作区路径可能带空格，交给 link.exe 之前补引号。
fn quote_if_needed(value: &str) -> String {
    if value.contains(' ') {
        format!("\"{value}\"")
    } else {
        value.to_string()
    }
}

fn require_nonempty(relative: &str, hint: &str) {
    let path = std::path::Path::new(relative);
    if !path.exists() {
        panic!("{relative} missing; {hint}");
    }
    let meta = std::fs::metadata(relative).unwrap_or_else(|e| panic!("stat {relative}: {e}"));
    if meta.len() == 0 {
        panic!("{relative} is empty; {hint}");
    }
}
