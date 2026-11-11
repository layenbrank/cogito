# cogito-codeindex

tree-sitter 代码索引（S12）。只读、可重算：索引是派生数据，删了能重建，所以不进库。

## 做到什么

| 语言 | 扩展名 | 符号 | 边 |
| --- | --- | --- | --- |
| TypeScript | `.ts` `.mts` `.cts` | 函数 / 方法 / 类 / 接口 / 枚举 / 类型 / 常量 / 变量 / 模块 | `import` 说明符、`call` 名字 |
| TSX | `.tsx` | 同上 | 同上 |
| JavaScript | `.js` `.mjs` `.cjs` `.jsx` | 同上（用 TS 文法解析，TS 是 JS 超集） | 同上 |
| Rust | `.rs` | 函数 / 结构体 / 枚举 / trait / impl / 类型 / 常量 / 模块 | `use` 路径、`call` 名字 |

符号带：相对路径、起始/结束行（1 起算）、父符号（方法 → 类）、导出标记
（TS/JS：处在 `export` 语句里；Rust：带 `pub`）。

## 明确不做

- **不做类型解析、不做跨文件名字消解**：`Call` 边按**名字**连，重名的会连成一片。
  精确调用图要 LSP / 编译器级信息，超出「给 Agent 一张地图」的范围。
- **不做增量索引**：每次调用重建全库（进程内缓存 60 秒兜住重复调用）。
- **不落库**：没有 `code_symbol` / `code_edge` 表。落库要迁移 + 失效逻辑，
  而本地几万个符号重建一次只要几百毫秒 —— 详见 `docs/decisions/security-boundary.md` 的 S12 段。

## 边界

- 跳目录：`.git` / `node_modules` / `target` / `dist` / `build` / `.next` / `.turbo` / `vendor`
  以及所有以 `.` 开头的目录。
- 单文件上限 512KB、整库上限 2000 文件、递归上限 12 层；超出的文件数如实写进 `Index::skipped`。

## 用法

```rust
use cogito_codeindex::{index_root, index_source, Lang};

let file = index_source(Lang::Rust, "src/lib.rs", source);
let repo = index_root(std::path::Path::new(".")).expect("index");
let rows = repo.search("spawn", 20);
let affected = repo.impact("session.ts", 3, 100);
```

上层只有 `crates/core/src/tools/code.rs` 的五个只读工具；它们负责把根目录限制在
已登记工作区内，并把结果翻译成 JSON。
