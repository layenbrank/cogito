# 正式包 + dev 实例同时跑（双实例调试）

装了打包好的 cogito 之后，`pnpm dev` 默认**起不来**，或者起来后和正式包互相抢资源：

| 撞的地方               | 原因                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| 第二个进程直接退出     | `tauri-plugin-single-instance` 按 identifier（`com.cogito.client`）建互斥量 |
| SQLite / 知识库 / 日志 | 两边都用 `<appLocalData>\com.cogito.client`                                 |
| WebView2               | 同一个 `EBWebView` profile，WebView2 不支持两个进程共用                     |
| goose 数据 / jwt       | 两边都用 `<appData>\com.cogito.client`                                      |
| corex-daemon           | Named Pipe 写死 `\\.\pipe\corex`，dev 的调用会打进正式包的 daemon           |
| 剪藏 / 知识库 HTTP     | 写死 `127.0.0.1:19828`                                                      |

## 怎么跑

```powershell
# 仓库根目录
pnpm dev:client:isolated

# 或者只跑 client
pnpm --filter @cogito/client dev:isolated
```

正式包照常从开始菜单 / `%LOCALAPPDATA%\cogito\cogito.exe` 启动，两个进程互不干扰。

脚本做了两件事（缺一个都会出问题）：

1. `tauri dev --config src-tauri/tauri.dev.conf.json`
   → identifier 变成 `com.cogito.client.dev`，上表中所有**由 identifier 派生**的路径 / 互斥量自动分开；
2. 进程环境加 `COGITO_DEV_ISOLATED=1`
   → Tauri 起来**之前**就要用的路径（`main.rs` 的 token helper、`utils/diagnostics` 的 panic 现场）也认 `.dev` 目录。

剩下几个写死的名字由 `src-tauri/src/utils/instance.rs` 按 identifier 自动切换：

|                                                   | 正式包                             | dev 隔离实例                           |
| ------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| identifier                                        | `com.cogito.client`                | `com.cogito.client.dev`                |
| appLocalData（DB / knowledge / logs / EBWebView） | `%LOCALAPPDATA%\com.cogito.client` | `%LOCALAPPDATA%\com.cogito.client.dev` |
| appData（goose / jwt）                            | `%APPDATA%\com.cogito.client`      | `%APPDATA%\com.cogito.client.dev`      |
| corex-daemon pipe                                 | `\\.\pipe\corex`                   | `\\.\pipe\corex-dev`                   |
| 剪藏 / 知识库端口                                 | `19828`                            | `19829`                                |
| 窗口标题 / 托盘提示                               | `cogito`                           | `cogito (dev)`                         |

dev 侧仍然共用：OS Keyring 里的密钥（service/account 名字没带 identifier）、
`%LOCALAPPDATA%\cogito\agent-cache`（会话级缓存，7 天自动清）。

## 想把正式包的账号 / 模型配置带过来

dev 是**全新的空库**（第一次启动会跑完整迁移）。需要同一份配置时，把库复制过去
（复制，不是共用 —— 共用会被 dev 的新迁移写坏正式包的库）：

```powershell
$src = "$env:LOCALAPPDATA\com.cogito.client"
$dst = "$env:LOCALAPPDATA\com.cogito.client.dev"
# 先在 dev 里启动一次再退出，保证目录存在；然后：
Remove-Item "$dst\cogito-client.db*" -ErrorAction SilentlyContinue
Copy-Item "$src\cogito-client.db" $dst
Copy-Item "$src\knowledge" $dst -Recurse -ErrorAction SilentlyContinue
```

登录态另外算：goose 的 provider 配置落在 `%APPDATA%\com.cogito.client.dev\goose`，
JWT 落在 `%APPDATA%\com.cogito.client.dev\cogito\jwt`，按需复制或重新登录。

## 已知的抢占项

- **截屏全局热键**：OS 只允许一个进程注册同一个键。正式包先起时，dev 里设热键会失败
  （前端会走 fallback 链并给出提示）。调试截屏请只留一个实例，或两边设不同的键。
- **托盘图标**：两个图标，靠 tooltip（`cogito` / `cogito (dev)`）区分。
- **剪藏扩展 / 外部调用**：默认打到 `19828`（正式包）。要指向 dev，改用到 `19829`，
  dev 的 `/health`、`/api/v1/*` 都在这上面。

## 两种模式切换会重新编译

identifier 是编译进二进制的（`generate_context!`），所以 `pnpm dev` ↔ `dev:isolated`
来回切会触发一次 `cogito` crate 重编译 + 链接（增量约 1–2 分钟）。

## 排查

- dev 启动后立刻退出、什么日志都没有 → 检查有没有漏掉 `--config`（identifier 还是
  `com.cogito.client`，被单实例锁踢掉了）。
- dev 日志里出现 `实例 identifier 与环境开关不一致` → 用了裸 `tauri dev` 又带着
  `COGITO_DEV_ISOLATED`（或反过来），改用 `dev:isolated`。
- 想知道当前进程到底落在哪个目录：设置 → 诊断里的 `identifier` / `appDataDir`
  （`diagnostics:capabilities` 回报的是**当前实例**的值）。
