# mcp · MCP 工具面

cogito 对外暴露的 MCP（Model Context Protocol）**工具目录**：五个工具的名字、描述与
参数 schema 写死在这里，是「名字即权限」这条安全边界的唯一事实来源。HTTP 层与 compute
转发在 `src/services/mcp`，出站客户端在 `src/clients/compute`。

## 边界

| 归本能力                                 | 不归本能力                                   |
| ---------------------------------------- | -------------------------------------------- |
| 五个工具的名字 / 描述 / 参数 schema      | 工具的执行（那是 compute 的地盘）           |
| MCP 名 ↔ compute 工具名的映射（前缀）  | JSON-RPC 分发、鉴权、租户作用域（HTTP 层）    |
| 协议版本与 JSON-RPC 错误码字面量         | 审批台账与写工具的审批通道（`agent` 能力）    |

## 数据所有权

- 无表、无持久化：工具目录是**代码里的静态数据**，不落库。本能力不拥有任何数据库表。

## 对外接口

- `tools()`：五个 `ToolListing`（`name` / `description` / `inputSchema`），顺序稳定。
- `write_tools()`：需要人工审批的两个写工具（`cogito_memory_write` /
  `cogito_asset_visibility_write`）——进目录但调用即拒绝。
- `compute_name(mcp_name)`：剥掉 `cogito_` 前缀得到 compute 工具名；不是目录里的
  名字返回 `None`。
- 协议常量：`RPC_VERSION` / `MCP_PROTOCOL_VERSION` / `TOOL_PREFIX` 与 JSON-RPC 错误码。

## 边界约束

- 零 I/O、零依赖方向：只依赖 `serde` / `serde_json`，不依赖 HTTP 框架、不依赖 `cogito`，
  也不依赖 compute 客户端（R1）。
- 工具目录与 compute `tools.py` 的五份参数 schema **逐字对齐**：改了那边必须同步这里，
  否则名字漂移会变成一次 400（「名字即权限」）。
- 写工具只声明、不执行：MCP 是同步协议，装不下「人工审批」这半程，执行只发生在服务端
  agent 的审批通道（`agent` 能力）里。

## 迁移状态

- 新写能力：边界与实现一步到位（crate + `services/mcp` + e2e `mcp_scope`），无遗留路径。
