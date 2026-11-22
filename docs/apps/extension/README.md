# 浏览器扩展（apps/extension）

Chrome MV3 单扩展：**新标签磁贴墙 + 整页对话 + 网页剪藏 + 侧栏**。产物落在 `apps/extension/dist`。

## 入口

| 入口 | 文件 | 说明 |
| --- | --- | --- |
| 新标签页 | `index.html` → `src/main.tsx` | 磁贴墙（`chrome_url_overrides.newtab`） |
| 对话页 | `index.html#/agent/chat` → `src/views/agent/chat/chat.tsx` | 整页 tab；`Ctrl+Shift+K` 或工具栏图标右键打开 |
| 侧栏 | `sidepanel.html` → `src/entries/side.tsx` | 固定当前页 / 墙上链接 / 书签 |
| 工具栏弹窗 | `popup.html`（由 `apps/clipper` 构建进 dist） | 网页剪藏 |
| Service worker | `src/entries/worker.ts` | **唯一**的 MV3 worker，四件事都在顶层同步注册 |

worker 里的四件安装必须在模块顶层同步完成 —— MV3 唤醒 worker 时事件可能立刻到达，异步注册会漏事件：

```ts
installPinMenu()      // 右键「固定到新标签」
installClipRelay()    // 剪藏（@cogito/extension-kit/relay）
installAgentCommand() // 快捷键 / 工具栏右键 → 对话页
installAgentMenu()
installAskPageMenu()  // 选中文字右键「问 Cogito 关于这段内容」
```

## 对话是怎么跑起来的

**双路执行，自动选路，能力差别强制可见**。

```
扩展对话页
  └─ ChatModelPort（port/router.ts 选路）
       ├─ bridge：127.0.0.1:19828/api/v1/agent/*  → client 的 Rust → agentd
       │     全能力：工具调用、审批卡、计划；代价是必须装并运行桌面端
       └─ cloud：${VITE_COGITO}/gateway/chat/completions
             仅对话（无工具）；只填文本，不支持审批
```

选路规则（`features/agent/port/router.ts` 的 `findExecutor`）：桥可用 → `bridge`；否则有云端令牌且选了模型 → `cloud`；都不行 → `none`，并且**把两条路的原因都说出来**（只说桥的原因，用户会以为「开桌面端就好了」，而实际他连账号都没登）。

### 为什么是「代理」而不是把 agentd 地址交给扩展

agentd 的 Bearer 令牌能拿到**带写文件、执行命令能力**的 agent。让它只活在 Rust 进程里，扩展带的是**本机 API 令牌**（用户在桌面端生成），Rust 再换成 agentd 令牌转发。细节见 `apps/client/src-tauri/src/bridge/agent.rs` 的模块注释。

三道闸：

| 闸 | 行为 |
| --- | --- |
| `agentEnabled` | 桌面端设置里的开关，默认 **关闭** |
| 令牌 | **永远需要**；未配置令牌 = 拒绝（不复用 Wiki API 的「本机免鉴权」） |
| `allowLanAccess` | 开启时 agent 面一律 403 |

启用步骤：桌面端 设置 → 知识库 → API / Clip 守护 → 点「生成」拿令牌 → 打开「Agent 代理」→ 把令牌填进扩展设置 → 保存。

## 代码分层

| 目录 | 职责 |
| --- | --- |
| `features/platform/` | **平台层**：`storage.ts`（`chrome.storage.local` 封装 + 集中键表）、`prefs.ts`（非密偏好，同步读 + 异步落盘）、`secrets.ts`（云端令牌 / provider key，**明文**）、`http.ts`（唯一 HTTP 出口） |
| `features/bridge/` | 本机代理：探活 `19828 → 19829`、`/status` 四态、带令牌转发 |
| `features/agent/port/` | chat 端口实现：`model.ts`（桥）、`cloud.ts`（云端）、`router.ts`（选路）、`history.ts`（Dexie）、`instance.ts`（单例） |
| `features/page-context/` | 右键选区的跨页面交接 |
| `views/agent/chat/` | runtime 装配 + 对话页 |
| `database/` | Dexie `cogito` 库（v5 起含 `agentThread` / `agentMessage` / `agentProvider`） |

协议层**不在这个 app 里**：`AGENTD_ROUTES`、SSE 读帧、游标去重、审批派生、ACP 事件映射、审批判定全部来自 `packages/agent-runtime`，与 `apps/client` 共用同一份实现。

## 存储

| 内容 | 落点 |
| --- | --- |
| 领域数据（磁贴 / 会话 / 消息 / 接入） | Dexie（IndexedDB），库名 `cogito` |
| 非密偏好、本机代理令牌 | `chrome.storage.local['cogito.prefs']` |
| 云端令牌 / provider key | `chrome.storage.local['cogito.secrets']`（**浏览器没有 keyring，是明文**） |
| 右键选区交接 | `chrome.storage.local['cogito.agent.pending']`（取完即删，超 10 分钟丢弃） |

## 命令

```powershell
pnpm dev:extension          # vite dev（1024 端口，自签证书；EXTENSION_HTTP=1 回退 http）
pnpm build:extension        # core + clipper + manifest 改写，产物 dist/
pnpm --filter @cogito/extension unit
pnpm --filter @cogito/extension run smoke:dist   # 真浏览器加载 dist 冒烟
```

装载：`chrome://extensions` → 开发者模式 → 加载已解压的 `apps/extension/dist`。

## 已知缺口

- **登录**：目前靠设置页粘贴云端 JWT，没有登录表单
- **配额闸门**：`GET /gateway/quota/me` 未接，云端路径在超限时会到上游才报错
- **MCP 工具面**：桥路上扩展不发 `mcpServers`，只有 goose 内置工具（cogito 自己的 MCP 工具需要桥侧注入）
- **追问表单**：回执会投递，elicitation 的渲染面未接
- **知识库视图**：只做了剪藏投递，没有列表 / 检索页面
- **体积预算**：尚未加硬断言（client 那份「首屏预算」的债不能带进来）
