# 代码窗口（Code Workbench）

磁贴组件 `code` 打开独立窗口，路由 `/code`。对齐 VS Code / Cursor / Qoder **Editor** 壳层，**不含** AI 侧栏（AI 在 Agent 窗）。

## 布局

```
Decorations（窗口壳：菜单 / 布局开关 / 状态，勿塞编辑器控件）
├─ Caption.begin：标题 + 命令中心（Ctrl+P）
├─ Caption.final：布局控制（侧栏 Ctrl+B、底栏 Ctrl+`）+ 命令面板
├─ children（内容区 = workbench）
│  └─ Activity Bar │ Sidebar │ Tabs + Breadcrumbs + Monaco │ Panel
└─ section：状态栏
```

职责：
- **Decorations**：窗口级（标题、布局展开/收起、命令入口、状态）
- **内容区**：编辑工作台（活动栏切视图、文件树、编辑器、终端面板本体）


## 竞品对照

| 区域 | VS Code / Cursor / Qoder Editor | 本窗 |
|------|--------------------------------|------|
| Activity Bar | 切视图 | Explorer / Search / SCM(占位) |
| Sidebar | 主侧栏 | 可折叠 |
| Editor Tabs | 多文档 | 单 group 多 tab |
| Panel | Terminal / Problems | 复用 `features/terminal` |
| Command Palette | Ctrl+Shift+P / Ctrl+P | Dialog 命令/文件面板 |
| AI 侧栏 | Cursor / Qoder 强调 | **不做** → Agent 窗 |

## 工作区

启动时**不**默认打开 Documents；侧栏为空，需 Ctrl+O /「打开文件夹」选择根目录。

## 快捷键

| 快捷键 | 作用 |
|--------|------|
| Ctrl/Cmd+Shift+P | 命令面板 |
| Ctrl/Cmd+P | 转到文件 |
| Ctrl/Cmd+S | 保存 |
| Ctrl/Cmd+W | 关闭标签 |
| Ctrl/Cmd+O | 打开文件夹 |
| Ctrl/Cmd+B | 展开/收起主侧栏（标题栏布局按钮 / Activity 再点当前项） |
| Ctrl/Cmd+` | 切换终端 |

## 关键路径

- 视图：`apps/client/src/views/code/`
- 状态：`apps/client/src/stores/code.ts`
- 终端：`apps/client/src/features/terminal/`（与 Agent 共用）

## 与 Agent 窗边界

- **代码窗**：编辑、文件系统、终端、问题列表
- **Agent 窗**：对话、任务、审批、工具卡；可另开终端面板
