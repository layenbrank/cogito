# ADR：策略与执行分离——硬禁用不可被公开接口撤销

- 状态：提议（2026-11-23）
- 影响范围：`apps/agentd/src/{goose/allowlist,graph,agent-server}.ts`、
  `packages/agent-protocol/src/policy/*`、`apps/client/src-tauri/src/utils/goose_permissions.rs`
- 关联：[agent-audit.md](../apps/client/agent-audit.md) 的 F-001 / F-002 / F-010 / F-027 / F-028；
  [agent-approval-service.md](./agent-approval-service.md)

## 1. 背景

当前安全模型有三层：

| 层 | 职责 | 落点 |
| --- | --- | --- |
| 硬策略 | 哪些工具永远不许跑 | `findHardDenyLevel` → agentd `ensureHardDeny` 写 goose `never_allow` |
| 档位 | 本轮要不要问 | `findGooseMode` → `applyMode` |
| 业务规则 | 这一次该不该问 | `decideApproval`（纯函数） |

问题：

1. **公开白名单允许 `_goose/unstable/tools/permissions/set`**，任何持 bearer 的调用方都能把
   `shell` 改回 `always_allow`，硬策略被同一条 HTTP 面撤销（F-001）；
2. 硬策略的**唯一执行点**是 goose 的 `permission.yaml`，而该文件：
   - 进程内缓存，改后必须重启 goose；
   - 格式写坏会让 goose panic；
   - 一旦被外部重置，`hardenedSessions` 仍认为已同步，不会重写；
3. 工具分类依赖动词启发式，第三方 MCP 的 `open_pr` / `fetch_url` 会被判只读（F-027），
   `stripServerPrefix` 还可能误剥（F-028）；
4. `cwd` 只校验「非空字符串」，`mcpServers` 原样交给 goose spawn 任意命令（F-010 相关信任边界）；
5. 目前没有 OS 级沙箱，唯一兜底是 Windows Job Object 的进程回收。

## 2. 决策

**审批回答「谁同意」，执行闸门回答「最多能做什么」；两者分离，且硬策略不能由公开接口撤销。**

### 2.1 收敛配置面

- 从 `ALLOWED_GOOSE_METHODS` 移除 `_goose/unstable/tools/permissions/set`；
- 如确需写权限，新增 agentd 内部方法（不经 `/goose/invoke`），且：
  - 只允许写 `never_allow`；
  - 带目标会话与 `expectedRevision`；
  - 写后强制重启 goose 或使 `hardenedSessions` 失效；
- `session/close`、`session/load`、`config/upsert` 逐项评估是否应暴露给前端（至少限制为「当前 thread 的 session」）；
- `/goose/sessions/:id/config` 增加 `configId` 白名单，与 `/mode` 的校验对齐。

### 2.2 agentd 侧工具闸门

在 `runTurn` 的工具调用事件上增加一层校验（在结果回写 goose 之前）：

```
tool call → classifyToolEffect + findHardDenyLevel
  ├─ hard deny 且当前档位不是 ask → 直接拒绝（返回结构化拒绝原因）
  ├─ hard deny 且档位是 ask → 推审批卡，卡上标风险与替代工具
  └─ 其余 → 交给 goose 的审批流程
```

- 拒绝原因要区分「硬策略」「用户拒绝」「未知工具」，避免模型把 `never_allow` 的静默拒绝误读为
  「用户不想用这个工具」（仓库 memory 已记录过这个误判）；
- 闸门是**第二道**，goose `permission.yaml` 仍是第一道；两道任一命中即拒绝。

### 2.3 输入校验

| 输入 | 规则 |
| --- | --- |
| `cwd` | 必须存在、必须是绝对路径、必须落在允许根（工作区/用户选择的目录）内 |
| `mcpServers` | 默认关闭任意 command；只允许已配置的 server 或显式开关；`env` 不得包含未声明变量 |
| `thread_id` | 长度/字符集校验；`threads` Map 设上限 |
| `after` | 同时接受 `epoch:seq` 与纯数字；非法值不得退化成「全量补发」 |

### 2.4 会话指纹

`fingerprintMcpServers` 扩展为 `fingerprintSession({ cwd, workspaceID, mcpServers, systemText })`：
任一变化即重开会话。避免「换工作区后仍写旧目录」（F-010）。

### 2.5 沙箱路线

- **R0**：完成 2.1–2.4，把「无沙箱」的风险写进产品文档与审批卡提示；
- **R5（后续）**：评估 Windows 受限令牌 / AppContainer 包装 `local__cogito_terminal_run`；
  macOS/Linux 若纳入支持范围，再对齐 Seatbelt / bubblewrap；
- 沙箱一旦落地，审批与沙箱保持正交：批准命令不扩大沙箱可写/可访问范围。

## 3. 理由

1. VS Code 明确「批准不扩大访问」，Codex 用 OS 级沙箱与审批策略正交——两者都把「同意」与「能力」分开；
2. 只靠 goose 文件 + 工具名黑名单，既挡不住未知 MCP，也挡不住配置面被改写；
3. agentd 是唯一持有 bearer 与工具调用流的组件，是天然的第二个执行点；
4. 输入校验是低成本、高收益的修复，能显著缩小「token 泄漏 = 任意命令执行」的面。

## 4. 不变量

1. 硬禁用**不能**由任何公开 HTTP 方法撤销；
2. 未知工具默认按写处理（fail-closed），除非在显式只读清单里；
3. `cwd` 必须绑定到调用方声明的工作区；
4. 审批结论不改变沙箱/目录能力，只决定「是否执行」；
5. 拒绝原因必须可区分硬策略 / 用户拒绝 / 未知工具。

## 5. 代价

- 移除 `permissions/set` 会影响现有的设置页「工具权限」写入路径 → 需要改为内部方法或迁移到 agentd 配置；
- agentd 侧闸门需要解析工具调用事件，增加少量 CPU 与一次策略查表；
- 输入校验可能拒绝现有的合法用法（例如用户选择工作区外目录）→ 需要显式「允许根」设置；
- 沙箱落地前，产品仍需承认提示注入的残余风险。

## 6. 备选方案

| 方案 | 否决理由 |
| --- | --- |
| 只保留 goose `permission.yaml` | 配置面可撤销、重启才生效、格式坏了会 panic |
| 只加 UI 层禁用 | UI 不是安全边界；扩展/任意本机进程可绕过 |
| 完整 OS 沙箱立即上线 | Windows 成本高、会影响现有终端体验；先做策略与校验，分期做沙箱 |
| 用 LLM 判定工具是否危险 | 不确定性不能作为唯一闸门；可作为辅助信号 |

## 7. 验收

1. 单测：已移除的方法调用返回 404/403；硬禁用工具在 agentd 闸门被拒绝且原因可区分；
2. 集成：会话建立后尝试通过 `/goose/invoke` 撤销 never_allow → 失败；
3. 会话复用：切换 cwd/workspace 后重开会话，工具在正确目录读写；
4. 输入：非法 `cwd` / `mcpServers` 被拒绝并返回结构化错误；
5. 文档：`agent-orchestration.md` 的三层表与「无沙箱」风险提示更新。

## 8. 重新考虑条件

- goose 提供不可撤销的「服务端策略」并由 agentd 签名 → 可简化第二道闸门；
- 产品扩展到 macOS/Linux → 需要重新评估沙箱与路径校验；
- 出现多用户/远程执行 → 策略必须迁到服务端，agentd 只做本地执行。
