# 对话输入区 / 右栏：知识库 · 技能 · 扩展（2026-11-06）

一条原则：**输入框旁边只放「边写边要做的事」，翻找类的都归右栏。**
2026-11-06 按这条原则重整了两处：拆掉输入区的 `+` 面板、右栏补三个页签。

## 输入区左下角（`composer-actions.tsx`）

| 位置 | 组件 | 作用 |
| --- | --- | --- |
| 1 | `composer-knowledge.tsx` | **知识库**：列库 → 列文档 → 点一下把文档引用进本轮对话 |
| 2 | `composer-clip.tsx` | 回形针：附件 / 图片 |
| 3 | `approval-switch.tsx` | 审批档位 |
| 4 | `mode-switch.tsx` | 执行 / 计划 / 问答 / 目标 |

原来的 `+`（`composer-context-menu.tsx`，双栏 AttachMenu：工作区 / 扩展 / 技能）**已删除**：
工作区文件在右栏「文件」、技能在右栏「技能」、MCP 插件列表搬到了右栏「扩展」，
唯一还留在输入区的是「知识库」—— 引用完继续写这件事，右栏做不到。

## 右栏页签（`aside.tsx`）

| 页签 | 组件 | 数据来源 | 点一下做什么 |
| --- | --- | --- | --- |
| 详情 | `aside-busy.tsx` / `aside-empty.tsx` | 会话状态 | — |
| 计划 | `aside-plan.tsx` | `features/agent/plan-*` | 确认执行 |
| 文件 | `aside-files.tsx` | `workspaceFiles:*` + `useActiveWorkspace` | 预览 / 引用 / 审阅 |
| **知识库** | `aside-knowledge.tsx` → `knowledge-browser.tsx` | `knowledge:listBases` / `knowledge:listDocs` | 引用文档 |
| **技能** | `aside-skills.tsx` | `workspaceSkills:list` | 引用 `SKILL.md` |
| 审阅 | `aside-review.tsx` | `workspaceGit:*` | 逐块采纳 / 丢弃 |
| 历史 | `aside-history.tsx` | `workspaceGit:*` | 看提交与改动 |
| 浏览器 | `aside-browser.tsx` | 内嵌 webview | 给 agent 读/操作 |
| **扩展** | `aside-extensions.tsx` → `extensions-pane.tsx` | `config/extensions` + `session/extensions` | 就近开关 MCP / 内置扩展 |
| 终端 | `features/terminal` | PTY | 常驻 shell |

加粗的三行是这轮新增的。前两行共用 `knowledge-browser.tsx`：
输入区的 popover 与右栏页签是**同一份实现**，只是宿主不同（`active` 控制何时去读 IPC）。

## 口径：技能按「工作区多文件夹」识别

技能不是只看「当前文件夹」的那一个：

```ts
// aside-skills.tsx / composer-triggers.tsx（`/` 触发器）
const { folderPaths, primaryRootPath } = useActiveWorkspace()
const rows = await WorkspaceSkills.fetchSkills([...folderPaths])   // 每个文件夹都扫一遍
const reference = toAgentPath(skill.path, primaryRootPath)         // 引用路径按会话 cwd 折算
```

- `folderPaths` 是工作区**全部**文件夹（`api/`、`docs/`…），不是 `rootPath`（当前选中的那个）。
- 会话 cwd 只等于**主文件夹**，所以非主文件夹里的技能必须给绝对路径 —— `toAgentPath` 负责折算
  （`features/agent/workspace/paths.ts`）。少了这一步，agent 会拿 `docs/.claude/skills/x/SKILL.md`
  去主文件夹里找，必然找不到。
- 多文件夹时列表右侧标出技能所属文件夹名，同名技能能分得清。
- 同一口径也用在下拉里：`@` 是「多根搜文件」、`/` 是「多根取技能」，两者都按 `folderPaths`。

## 口径：知识库文档 = 磁盘上的 Markdown

知识库文档不是另一种实体，就是 `<库根>/<relPath>` 上的一个文件：

```ts
const reference = toAgentPath(joinWorkspacePath(base.rootPath, doc.relPath), primaryRootPath)
await attachWorkspaceFile(aui, reference)   // 与文件树、@ 的同一条引用通道
```

库根通常**不在**工作区内，此时 `toAgentPath` 原样给绝对路径，agent 照样能读。
好处是不必给知识库另造一条「上下文注入」通道：引用语义、附件展示、持久化全部复用现成的。

## 与队列的关系

「插队 / 上下调序」失效的根因与修法（`steer` / `queue` 两条 lane + 扁平 `composer.queue`）见
[assistant-ui-elements.md](./assistant-ui-elements.md) 的「『插队 / 调整顺序』为什么曾经完全失效」。
