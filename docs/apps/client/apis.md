# client 接口层（`src/apis`）

`apps/client` 里**所有**对 Rust 命令（Tauri `invoke`）与 cogito HTTP 的调用，都必须经由
`src/apis/*` 暴露的具名接口。业务代码（`stores` / `features` / `views` / `shared`）里不允许
出现裸 `invoke(...)`。

## 命名

接口名 = **HTTP 动词前缀 + 资源**，全大写蛇形：

| 语义 | 前缀 | 例 |
| --- | --- | --- |
| 读取（read / list / load / status / probe） | `GET_` | `GET_AGENT_SESSIONS`、`GET_MEDIA_PROBE` |
| 新建 / 触发（write / insert / save / run / import） | `POST_` | `POST_MAGNETIC_TILES`、`POST_GALLERY_IMPORT` |
| 整体覆盖 / 启用 / 定位（update / set / replace） | `PUT_` / `PATCH_` | `PUT_KNOWLEDGE_DOC`、`PATCH_SIGNBOARD_ENTRIES` |
| 删除 / 撤销 / 退出（remove / clear / close） | `DELETE_` / `POST_` | `DELETE_AGENT_MESSAGES`、`POST_CAPTURE_CLOSE` |

补充约定：

- 资源名用**复数**表示表级操作（`GET_AGENT_SESSIONS`），单条或单例用单数（`GET_COUNTDOWN`）。
- 与频道天然同名的动作不要自创词：`agentSession:toRead` → `GET_AGENT_SESSIONS`，
  `magnetic-tile:write` → `POST_MAGNETIC_TILES`。
- 参数形状保持与 Rust 命令一致（绝大多数是 `{ params }`），接口层只做「频道 + 外壳」的收拢；
  **不要**在接口层加业务兜底。

### 返回类型：不许 `invoke<unknown>`

Rust 回包形状是契约，接口层必须声明出来。两种写法：

**① 固定契约 → 声明 interface**（放接口文件里，跨域复用的放 `shared/ipc/specs/*`）

```ts
/** `agent_session` 表里的 ACP 绑定（Rust `Binding`） */
interface AgentSessionACPBinding {
  acpSessionId: string
  cwd: string
  lastSeq: number
  lastEpoch: string | null
  routeTier: string
}

function GET_AGENT_SESSION_ACP_BINDINGS(): Promise<AgentSessionACPBindingRow[]> {
  return invoke<AgentSessionACPBindingRow[]>(CHANNELS.AGENT_SESSION.LIST_ACP_BINDINGS)
}
```

需要运行时校验的（外部/旧版本可能缺列）把 zod schema 放 `shared/ipc/specs/*`，
在接口里 `.parse()` 后返回推断类型（`apis/security.ts` 的审计/成本、`apis/automation.ts` 都是这么做的）。

**② 形状确实不定 → 用递归 JSON 类型，不用 `unknown`**

```ts
type SidecarValue = string | number | boolean | null | SidecarValue[] | { [key: string]: SidecarValue }
```

只有「通用表 CRUD」的行类型例外：各业务模块的 `Session` / `Message` / `SignboardEntry` 形状
本来就不同，由调用方给泛型，接口层不重复声明：

```ts
const sessions = await GET_AGENT_SESSIONS<Session[]>()
```

## 落点

- 一个频道命名空间一个文件，按域命名：`apis/agent-session.ts`、`apis/signboard.ts`、
  `apis/gallery.ts`、`apis/workspace-git.ts`。
- 同一个域里**云端 HTTP 与本地 IPC 可以合并到同一个文件**，用分节注释隔开：
  例 `apis/dict.ts`（云端目录 + 本地字典）。
  但**别让纯本地的域把 HTTP 客户端拖进依赖图**：磁贴墙这类高频路径（拖拽、预览缓存）
  只该依赖 Tauri IPC，云端能力另开 `*-cloud.ts`。`apis/magnetic-tile.ts` 就因此只留本地 CRUD。
- 纯传输设施（`lib/ipc.ts` 的 `ipcInvoke` / `parseData`、`utils/http/*`）留在原处，由 apis 引用。
- 事件订阅（`listen`）不算接口调用，可留在业务模块；接口层只负责 `invoke`。

## 不要多套一层

接口已经是「频道 + 外壳」了，调用方**不要再写一遍纯转发的同义函数**：

```ts
// ✗ 纯转发，白加一层
async function GET_CURSOR_AGENT_STATUS(): Promise<CursorAgentStatus> {
  return GET_CURSOR_AGENT_STATUS_IPC<CursorAgentStatus>()
}

// ✓ 直接调用；类型放接口层
const status = await GET_CURSOR_AGENT_STATUS()
```

判定标准：**去掉这层函数后调用点是否变短、语义是否不变**。是的就删掉。
只有当这层真的加了东西（`isTauri()` 守卫 + 异常兜底、zod 解析、按设置组装策略、
节流/串行队列）才保留，并且换个领域动词命名，避免和接口同名（例 `retention.ts`
的 `pruneCaptures` 之于 `POST_CAPTURE_PRUNE`）。为了绕开同名而起的 `xxx_IPC` 别名
也是信号：要么删层，要么改名。


## 频道常量

- 所有 `invoke` 的频道必须来自 `src/shared/ipc/channels.ts` 的 `CHANNELS`，不允许裸字符串。
  例外（Rust 侧按函数名注册、没有 `rename`）：`browser:*`、`vector_*`、`agent_cache_*`、
  `app_build_info`、`wiki_http_configure`、`capabilities:probe`。它们也已在 `CHANNELS`
  里集中登记（`BROWSER` / `VECTOR` / `DIAGNOSTICS` / `CAPABILITIES` / `WIKI`），
  改 Rust 命令名时只改这一处。
- 新增命令三步走：Rust `#[tauri::command(rename = "模块:方法")]` → `handlers.rs` 注册 →
  `CHANNELS` 加常量 + `apis/<域>.ts` 加接口。

## 检查

```powershell
# 业务代码里不应再出现裸 invoke
Get-ChildItem src -Recurse -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch '__test__|\.test\.|\\apis\\|\\lib\\ipc\.ts$' } |
  Select-String -Pattern 'invoke\(<'
```
