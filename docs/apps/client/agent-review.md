# Agent 右栏审阅

右栏「审阅」不再只是一个「未提交变更」列表：它要回答四件事 ——
**代码拉没拉**、**本地和远端各差什么**、**哪些改动已暂存**、**点开能看到具体差异**。
同一个面板里还能切文件夹、切分支（含远端）、暂存 / 提交 / 抓取 / 拉取 / 推送。

## 单一真源：当前文件夹

一个工作区可以挂多个目录（frontend / backend / docs…）。以前文件树自己记一个
`selectedRoot`，审阅直接拿「列表第一个文件夹」，composer 又是第三份口径 ——
切了文件夹，三个面板看的不是同一棵目录。

现在统一到 `features/agent/workspace/active-root.ts`：

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 内存态 + 持久化 | `selectedByWorkspace: Map<workspaceID, path>` | 落 `agent.activeRootByWorkspace`，重启后停在上次的文件夹 |
| 写入 | `selectActiveRootPath(workspaceID, path)` | 变化时通知所有订阅方 |
| 订阅 | `useActiveRootVersion()` | `useSyncExternalStore` 版本号，面板据此重算 |
| 解析 | `useActiveWorkspace().rootPath` | 选中的优先；已从工作区移除则回落第一个 |
| 主文件夹 | `useActiveWorkspace().primaryRootPath` | 列表第一个，不随切换改变 |
| 切换 UI | `WorkspaceFolderChips` | 文件夹 > 1 才出现，文件树与审阅共用 |

约束：新增面板读「工作区根」一律用 `useActiveWorkspace().rootPath`，
不要再自己存一份选中目录；需要「真正的主目录」时才用 `primaryRootPath`。

## 共享 Git 快照与动作层

`features/agent/workspace/git.ts` 是 agent 侧唯一的 Git 出口：

- `useWorkspaceGitSnapshot(rootPath)` 一次拿全：仓库探测 / 分支 / 变更 / 上游分歧 / 分支清单；
  同一 `root + revision` 的并发请求共享一个 promise，多个面板同时挂载不会重复打 IPC；
  每次读取前先 `workspaceGit:invalidate`，避免工作区改动因指纹未变而命中旧缓存。
- 动作函数：`refreshNow` / `fetchNow` / `pullNow` / `pushNow` / `checkoutNow` /
  `stageNow` / `unstageNow` / `discardNow` / `commitNow`。
  成功即 `bumpWorkspaceRevision()` + toast，失败 toast 并返回 `{ ok, message }`。

跨面板失效走 `features/agent/workspace/revision.ts` 的版本号广播：

```
审阅点「拉取」→ pullNow → bump revision
        ├─ 审阅：快照重读（分支 / ahead / behind / 文件清单）
        ├─ 文件：WorkspaceFilePicker 重拉
        ├─ 提交历史：重拉
        └─ 代码窗：use-code-workspace-effects 订阅 revision → invalidate + refresh
```

代码窗的 store（`stores/code-git.ts`）在 checkout / fetch / pull / commit / stage /
unstage / discard 成功后同样 bump，所以「代码窗切分支 → 审阅自动更新」是反过来的同一条通道。

## 审阅面板结构

```
┌ 状态栏 ─────────────────────────────────────────────┐
│ [文件夹 chips]（> 1 个文件夹时）                      │
│ [分支 ▾ ↑2 ↓1]            [抓取][拉取][推送][刷新]  │
│ ☁ origin/main  ↑2 ↓1                                │
└─────────────────────────────────────────────────────┘
待拉取   上游有、本地没有（拉取会改这些文件）
待推送   本地有、上游没有（推送会发这些文件）
暂存的更改  HEAD ↔ 暂存区
更改（未暂存） 暂存区 ↔ 工作区
未跟踪   新文件
本会话改动 工具写过但 git 还没感知的路径（通常是忽略文件）
┌ 提交框 ─────────────────────────────────────────────┐
│ 提交说明（多行）                                    │
│ [提交 ▾ 提交所有更改]                               │
└─────────────────────────────────────────────────────┘
```

按钮语义（都写进 `title`，不再出现「一个刷新图标猜不出干什么」）：

| 按钮 | 做什么 | 禁用条件 |
| --- | --- | --- |
| 抓取 | `git fetch`：只更新远端跟踪分支，不动工作区 | 非仓库 / 进行中 |
| 拉取 | `git pull`：把上游提交并入当前分支 | 没有上游 |
| 推送 | `git push`；无上游时自动 `--set-upstream origin <branch>` | 非仓库 / 无分支 |
| 刷新 | 先 `invalidate` 再重读本地状态 | 进行中 |

## Diff 口径

后端 `git::diff` 的 `DiffScope` 决定「没有 oid 时拿什么对比」：

| 场景 | 前端传参 | 后端等价命令 | 左右两侧 |
| --- | --- | --- | --- |
| 工作区 | 不带 `side` / oid | `git diff HEAD` | HEAD ↔ 工作区 |
| 暂存的更改 | `side: 'staged'` | `git diff --cached` | HEAD ↔ index |
| 更改（未暂存） | `side: 'unstaged'` | `git diff` | index ↔ 工作区 |
| 本地 vs 上游 | `oldOid: headOid, newOid: upstreamOid` | `git diff HEAD origin/main` | 待拉取 |
| 上游 vs 本地 | `oldOid: upstreamOid, newOid: headOid` | `git diff origin/main HEAD` | 待推送 |
| 提交对比 | `oldOid` / `newOid`（空串 = 空树） | `git diff <old> <new>` | 任意两侧 |

右栏内联差异统一走 `AsideDiff`，标题按口径显示（`HEAD ↔ 暂存区` / `暂存区 ↔ 工作区` /
`origin/main ↔ HEAD` 等）；大重写仍走 hunks 分页。

## 复用源码管理组件

审阅不复制一套 UI，直接复用代码窗的 props 驱动组件：

- `views/code/workspace/scm/changes.tsx` —— 分组、行内暂存/撤销、右键菜单；
  `onOpenDiff(relative, kind)` 把分组信息带出来，审阅据此选对 diff 口径。
- `views/code/workspace/scm/commit-bar.tsx` —— 提交 / 提交所有更改。
- `views/code/workspace/scm/discard-dialog.tsx` —— 撤销与删除确认。
- `views/code/workspace/scm/branch-switcher-view.tsx` —— 纯展示分支下拉，
  代码窗用 store 数据、审阅用共享快照数据；菜单分「本地分支 / 远端分支」两组，
  点远端分支在本地无同名分支时走 `checkout -b … --track`。

## 后端命令

| 命令 | 作用 |
| --- | --- |
| `workspaceGit:upstream` | 上游名、两侧 oid、ahead/behind 计数与两侧文件清单（200 条上限 + 截断标记） |
| `workspaceGit:push` | 普通推送 / `--set-upstream` 首次推送 |
| `workspaceGit:branches` | `{ current, branches, remotes }`，远端过滤 `<remote>/HEAD` |
| `workspaceGit:checkout` | 可选 `fromRemote`：本地无同名分支时建跟踪分支 |
| `workspaceGit:diff` / `diffMeta` / `diffHunks` | 新增 `side: worktree \| staged \| unstaged` |

## 已知取舍

- `probe` 以 `.git` 标记判定仓库：仓库子目录、submodule 路径会显示「不是 Git 仓库」。
- 多远端同名分支（如 `origin/main` 与 `upstream/main`）视为独立条目，切换时按传入全名处理。
- 提交钩子 / GPG 失败原样透出错误信息，不在此层改写。
- 撤销 / 删除仍走确认框，但 agent 面板与代码窗共用同一个对话框语义（未跟踪 = 删除文件）。

## 多根工作区：面板之间怎么同步

一个工作区挂多个目录时，三件事必须一致，否则用户会看到「审阅是 A、历史是 B」：

1. **当前文件夹只有一个**（`active-root.ts`）。文件树不再自存 `selectedRoot`：
   `AsideFilesRoots`、审阅与历史的 chips、composer footer 都走 `selectRoot`。
2. **面板按 `threadID + rootPath` 重挂**（`AgentAside` 的 `panelKey`）：换文件夹等于换数据源，
   展开的提交、正在看的 diff、文件树的浏览位置都只对一个目录成立，重挂比逐个手动清 state 更可靠。
3. **刷新是同一个动作**：审阅与历史都调 `refreshNow(rootPath)`（invalidate + bump revision）。
   历史还跟随 `useWorkspaceRevision` 自动重拉，并在「展开的提交已不在列表里」（reset / 切分支）时自动收起。

历史面板顶部因此固定给出「当前文件夹名 + 分支名」，分支取自与审阅同一份
`useWorkspaceGitSnapshot` 快照 —— 两个面板不可能显示不同的分支。

## 引用路径：相对路径只对一根成立

`workspaceFiles:search` 支持多根（`roots: string[]`），但命中项的 `relative` 是**相对它所在的那根**；
而会话 cwd 只等于工作区主文件夹，所以交给 agent 的路径必须折算
（`features/agent/workspace/paths.ts` 的 `toAgentPath`）：

| 场景 | 引用路径 |
| --- | --- |
| 主文件夹内的文件 | 相对路径 `src/app.tsx` |
| 其他文件夹内的文件 | 绝对路径 `/repo/backend/src/main.rs` |
| 文件夹自身（整体引用一个项目） | 绝对路径 |
| 不在任何文件夹内 | 跳过，并 toast 提示 |

`@` 触发器据此搜**整个工作区**：结果行尾标出所属文件夹，`@api` / `@api/src` 命中工作区文件夹时
收窄到那个文件夹，文件夹本身也是候选项。`+` 面板的工作区选择器顶部有文件夹 chips，
但它是**局部切换**（只影响这个选择器），不改变全局「当前文件夹」。
