# Windows 更新覆盖安装：释放 corex-serve 文件锁

本文记录 Client（Tauri）在 Windows 上通过应用内更新覆盖安装时，因 `corex-serve` sidecar 占用可执行文件导致 NSIS 安装失败的问题、根因与解决方案。

| 项 | 内容 |
|----|------|
| 状态 | 已实现（待真机覆盖安装验收） |
| 平台 | Windows（sidecar 当前仅在此启动） |
| 相关组件 | Tauri Updater、NSIS、`corex-serve` externalBin |

---

## 1. 问题是什么

### 1.1 现象

用户从系统托盘右键菜单选择「检查更新」，流程走到下载并安装时，NSIS 弹出错误：

> 无法打开要写入的文件：  
> `…\cogito\corex-serve.exe`

安装器引擎为 Nullsoft Install System；更新插件配置为 `installMode: passive`。

### 1.2 影响

- 应用内更新在覆盖安装阶段失败，用户无法平滑升级。
- 若选择「忽略」跳过该文件，可能留下旧版 sidecar，造成版本不一致。

### 1.3 复现路径

```
托盘「检查更新」
  → tray:action / checkUpdate()
  → check() 发现新版本 → 用户确认
  → update.downloadAndInstall()   ← NSIS 开始写安装目录
  → （本应）relaunchApp()
```

失败发生在 `downloadAndInstall()` 期间，而不是应用正常「退出」之后。

---

## 2. 根因分析

问题可拆成三层，缺任一环都会在 Windows 上撞上「正在运行的 exe 无法被覆盖」。

### 2.1 生命周期错位（主因）

| 时机 | 主进程 | corex-serve | NSIS 写文件 |
|------|--------|-------------|-------------|
| 正常退出（托盘「退出」） | 触发 `RunEvent::Exit` | 原逻辑会 `shutdown` | 不涉及 |
| **应用内更新** | 仍在运行；`relaunch` 在安装**之后** | **未 shutdown** | **正在进行** |

修复前，sidecar 清理只挂在：

```text
RunEvent::Exit → sidecar::shutdown(app)
```

「更新安装」不等于「进程退出」，因此 Exit 钩子不会在写文件前执行。

### 2.2 安装器默认范围不足

Tauri NSIS 自带的「检测应用是否在运行」主要针对**主程序**。  
`externalBin` 打进安装目录的 `corex-serve.exe` 不在该默认处理范围内，安装器不会主动停掉 sidecar。

### 2.3 关机竞态（次要，但真实存在）

即便调用了旧版 `shutdown`（IPC + `kill` 后立刻返回），也**不等待**进程真正退出并释放文件句柄。NSIS 若紧接着拷贝，仍可能失败。

### 2.4 因果链（摘要）

```text
更新确认
  → downloadAndInstall 启动 NSIS
  → NSIS 尝试覆盖 corex-serve.exe
  → 进程仍占用该文件（Exit 未触发 / 或 kill 未 wait）
  → 「无法打开要写入的文件」
```

---

## 3. 解决思路

### 3.1 设计原则

企业级桌面应用通常把责任拆成两层：

1. **应用侧**：换包前主动停依赖进程，并**等到句柄释放**。
2. **安装器侧**：假设应用可能失败或存在孤儿进程，在拷贝前再强制清理一次。

本仓库采用同一原则，简称**双保险**。

### 3.2 方案选型

| 方案 | 结论 | 说明 |
|------|------|------|
| 仅增加 `ExitRequested` / 依赖 `Exit` | 不采用 | 更新写文件时主进程往往仍存活，时机太晚 |
| 安装前同步停 sidecar 并 wait | **采用（P0）** | 对准更新主路径 |
| NSIS `PREINSTALL` / `PREUNINSTALL` kill | **采用（P0 加固）** | 覆盖手动 setup、孤儿进程 |
| Windows Service / 独立 Updater.exe | 本迭代不做 | 架构过重 |
| Job Object（父死子灭） | 延期 P1 | hook 已覆盖多数孤儿场景 |

### 3.3 目标时序

```text
用户确认安装
  → invoke('sidecar:shutdown')
       IPC 优雅退出 → 必要时 kill → WaitForSingleObject（≤5s）
  → update.downloadAndInstall()
       └─ NSIS_HOOK_PREINSTALL 再杀 corex-serve.exe
  → relaunchApp()
```

正常退出仍走：

```text
RunEvent::Exit → sidecar::shutdown（同一套逻辑，超时约 2s）
```

---

## 4. 实施方案（分层）

### 4.1 应用侧：可等待的 sidecar 关闭

**模块：** `apps/client/src-tauri/src/utils/sidecar.rs`

| API | 用途 | 超时 |
|-----|------|------|
| `shutdown_and_wait(app, timeout)` | 更新前 / 需要确认已停 | 调用方传入（更新默认 5s） |
| `shutdown(app)` | `RunEvent::Exit` | 内部使用约 2s，避免拖慢退出 |

关闭步骤：

1. 通过 Named Pipe 发送 `{"type":"shutdown"}`（失败可忽略并记日志）。
2. 取出 `CommandChild`，先短暂等待优雅退出。
3. 仍存活则 `kill`，再用 `WaitForSingleObject` 等待 PID 退出。
4. 成功后再短 sleep，给文件句柄释放留余量。
5. 超时则打 `warn`，**不阻断**后续安装（依赖 NSIS hook）。

**IPC：**

| 层 | 名称 |
|----|------|
| 前端 invoke | `sidecar:shutdown` |
| Rust command | `sidecar_shutdown` |
| 注册 | `handlers.rs` |

Command 在 blocking 线程中执行 wait；超时仍返回 `Ok(())`，避免卡死更新流。

### 4.2 前端：安装前准备

**模块：** `apps/client/src/utils/updater.ts`

确认安装后、调用 `downloadAndInstall` 之前：

1. 提示「正在准备更新…」
2. `prepareUpdate()` → `invoke('sidecar:shutdown')`
3. 失败只打 `console.warn`，不中断（安装器侧兜底）
4. 再「正在下载更新…」→ `downloadAndInstall` → `relaunchApp`

### 4.3 安装器侧：NSIS hooks

**文件：** `apps/client/src-tauri/nsis/installer-hooks.nsh`  
**配置：** `tauri.conf.json` → `bundle.windows.nsis.installerHooks`

| Hook | 行为 |
|------|------|
| `NSIS_HOOK_PREINSTALL` | `KillProcessCurrentUser "corex-serve.exe"` + Sleep |
| `NSIS_HOOK_PREUNINSTALL` | 同上（卸载/替换时同样释放锁） |

说明：

- 仅打完整 Windows NSIS 包后生效；纯 dev 模式不会跑该脚本。
- 若构建环境缺少 `nsis_tauri_utils`，可改为 `taskkill /F /IM corex-serve.exe /T`。

### 4.4 责任分层示意

```text
┌─────────────────────────────────────────┐
│  前端 updater：安装前显式停 sidecar      │  ← 主路径
├─────────────────────────────────────────┤
│  Rust：IPC + kill + 等进程退出           │  ← 保证句柄释放
├─────────────────────────────────────────┤
│  NSIS PREINSTALL：再杀 corex-serve.exe   │  ← 兜底（孤儿/手动安装）
└─────────────────────────────────────────┘
```

---

## 5. 关键决策

| 决策 | 理由 |
|------|------|
| IPC 命名 `sidecar:shutdown` | 语义是停进程，与 `ipc:ready` / `ipc:invoke` 区分 |
| 更新超时默认不阻断 | 避免更新流卡死；由 hook 二次保障 |
| Exit 使用较短 wait（约 2s） | 平衡清理完整性与退出体验 |
| 本迭代不做 Job Object / Service | 性价比；双保险已覆盖更新主路径与多数孤儿场景 |

---

## 6. 涉及文件

| 文件 | 变更要点 |
|------|----------|
| `src-tauri/src/utils/sidecar.rs` | `shutdown_and_wait`、PID 等待 |
| `src-tauri/src/system/command.rs` | `sidecar:shutdown` command |
| `src-tauri/src/app/handlers.rs` | 注册 command |
| `src-tauri/Cargo.toml` | `Win32_System_Threading` |
| `src/utils/updater.ts` | 安装前 `prepareUpdate` |
| `src-tauri/nsis/installer-hooks.nsh` | PREINSTALL / PREUNINSTALL |
| `src-tauri/tauri.conf.json` | `installerHooks` 路径 |

路径均相对于 `apps/client/`（Rust 侧在 `src-tauri/` 下）。

---

## 7. 验收清单

| # | 场景 | 期望 |
|---|------|------|
| 1 | 托盘检查更新 → 有新版本 → 安装 | 不再弹出无法写入 `corex-serve.exe`；装完可重启 |
| 2 | 更新前任务管理器可见 `corex-serve` | 进入安装阶段后进程消失 |
| 3 | 手动启动旧目录 `corex-serve` 再跑 setup | PREINSTALL 杀掉后安装成功 |
| 4 | 托盘「退出」 | 主进程与 `corex-serve` 均退出 |
| 5 | 应用日志 | 可见 shutdown / wait 相关 tracing |

---

## 8. 后续可选（P1）

- 将 sidecar 纳入 Job Object，降低主进程被强杀后的孤儿概率。
- 安装器按 `$INSTDIR\corex-serve.exe` 路径精确匹配，降低同名误杀风险。
- 为 `shutdown_and_wait` 超时行为补充自动化或脚本化回归。

---

## 9. 参考

- [Tauri Windows Installer — NSIS hooks](https://v2.tauri.app/distribute/windows-installer/)
- 社区同类实践：更新/安装前 kill sidecar，并在 NSIS `PREINSTALL` 兜底
