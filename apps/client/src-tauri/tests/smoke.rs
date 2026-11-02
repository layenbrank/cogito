//! 链接冒烟测试：确认 `cargo test` 能拉起集成测试可执行文件并访问到 lib。
//!
//! 这个文件还有一个结构性作用：`build.rs` 用 `cargo:rustc-link-arg-tests`
//! 给集成测试补 manifest，而 cargo 只在包**存在 test 目标**时才接受这条指令
//! （本 crate 原本没有 `tests/` 目录，构建脚本会直接报
//! "invalid instruction `cargo:rustc-link-arg-tests` ... does not have a test target"）。
//!
//! 真正验证「lib 单测 exe 的 manifest 修好了」的是 `cargo test --lib`：
//! 那个可执行文件会拉进 tauri → windows → `comctl32!TaskDialogIndirect`，
//! 缺 manifest 时会以 0xc0000139 直接退出，连用例都跑不到。

use cogito::browser::emulate;

#[test]
fn test_target_can_reach_the_library() {
    let iphone = emulate::preset("iphone15pro").expect("iphone15pro 预设应存在");
    assert_eq!(iphone.width, 393);
    assert_eq!(iphone.height, 852);
    assert!(iphone.mobile);
    assert_eq!(emulate::preset_ids().len(), 6);
}
