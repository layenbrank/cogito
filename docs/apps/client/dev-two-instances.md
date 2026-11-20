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
- **扩展剪藏 / 外部调用**：先探测 `19828`（正式包），没有响应再试 `19829`（隔离 dev），并记住上次成功的端口。
  dev 的 `/health`、`/api/v1/*` 都在 `19829` 上。

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

## 右栏自载本应用 / dev server 预览墙：只有 dev 有

嵌套预览（右栏打开 `http://localhost:8200`、或地址带 `?embedded=1`）是**开发手段**，
正式包里整块被 `import.meta.env.DEV` 剪掉（`src/features/window/shell-mode.ts` 的
`EMBEDDED_SUPPORTED`）：「打开本应用」按钮不渲染，发布器 / 快照桥 / 兜底提示都不执行。
正式包的右栏就是浏览器，不自载本应用。

dev 侧看到真磁贴有两条通道（都只读）：

| 场景 | 通道 |
| ---- | ---- |
| 在 **dev 实例**的右栏打开本应用（同 profile + 同 origin） | 主窗写同源 `localStorage`（`cogito:preview:mirror-wall`），子 webview 读 + `storage` 事件 |
| 在**别的实例 / 普通浏览器**打开 `http://localhost:8200` | vite 端点 `GET/POST /__cogito/preview-wall`（`vite.preview-wall.ts`，仅 `apply: "serve"`） |

两条通道的数据都来自**主窗的 store**（`preview-snapshot.ts` 的 `buildSnapshot`，即正常
读取路径：集合成员已剔除、`background` / `backdrop` 已由实体反序列化）。中继不读库、
不做额外数据处理 —— 直读 SQLite 的裸行与 IPC 语义不一致，自调试时会把「另一面墙」
误判成 bug。所以没有主窗在跑时，`?embedded=1` 是空墙（overview 底部有兜底提示）。

预览端没有任何 IPC：新建镜像、登录、终端这些写操作在自载页里一定失败 —— 那是能力表的
边界（见 `src-tauri/src/browser/mod.rs`），不是 bug。
