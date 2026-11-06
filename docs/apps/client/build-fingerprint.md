# 宿主构建指纹：先确认跑的是哪份二进制

排查 agent 工具面的怪现象时，最容易白烧一轮的假设是「代码刚改完，所以行为一定变了」。
dev 下前端是热更新的，**Rust 侧却是启动时那个进程**：改了 `browser/intercept.rs` 或
`browser/agent.rs` 之后不重启宿主，看到的仍然是旧实现，于是

- `app_browser_screenshot` 报 `CDP Page.captureScreenshot 超时（10s）`（旧的 `CALL_TIMEOUT`，新实现是 4s 上限 + 三通道兜底）
- `app_browser_intercept` 返回里没有 `paused / matched`（旧实现没有计数器）
- 终端里 `$env:COGITO_AGENT_CACHE` 是空的、`$env:TEMP` 还是系统 temp（旧实现不注入）
- 计划卡片没有「按新计划执行（rN）」文案（旧前端 + 旧后端）

这些全是同一个根因：**进程比代码老**。`utils/build_info.rs` 把这件事变成可读事实。

## 读哪里

| 位置 | 看到什么 |
| --- | --- |
| 设置 → 诊断 → 运行中的宿主 | `链接时间`（本地时间）、`构建档位`（`debug` / `release` + 版本）、`exe` 绝对路径、`pid` |
| 启动日志 | `宿主构建指纹 version=… profile=debug exe=… exe_modified_ms=… pid=…` |
| IPC | `app_build_info` → `{ version, profile, exe, exeModifiedMs, pid }` |

判定口径只有一条：**链接时间早于你最近一次构建的时间，就说明这个进程跑的是旧的**。
链接时间取可执行文件的 mtime（Windows 上链接即写文件），所以不依赖 git、也不需要构建注入。

## 为什么不做 git 版本号

- dev 的 `target/` 可能在别处，甚至不在 git 工作区里；
- 引入 `vergen` 会给每次构建加一个 git 依赖，收益只是多一串 sha；
- 真正要回答的问题是「重建过没有」，`mtime` 就够，而且零成本。

## 排查顺序

1. 设置 → 诊断看 `链接时间` 与 `pid`；和这次构建日志的时间对一下。
2. 对不上 → 重启宿主（关掉窗口再 `pnpm dev`，或让 dev 进程重链接）。
3. 链接时间是对的、行为还是旧的 → 才轮到查真 bug：先看返回里的通道 / 计数信息
   （截图 `mode: surface|view|os`、拦截 `paused / matched`）。
4. 线上包同样适用：`profile=release` 且链接时间 = 安装包构建时间的，才是这份包的二进制。

## 装好的包 vs dev 构建：两个不同的文件

本仓库 2026-11-06 实测过一次「怎么改都不生效」，根因不是 bug：

| 对象 | 路径 | 时间 |
| --- | --- | --- |
| 正在跑的进程（pid 21404） | `D:\Applications\cogito\cogito.exe`（装好的包） | 启动于 09:29:17 |
| dev 构建产物 | `D:\Documents\cache\debug\cogito.exe` | 13:17:02 链接完成 |

也就是说：**改完 Rust 只重启装好的那个包，等于什么都没改** —— 它跟 dev 构建是两个文件。
判据就在诊断页的 `exe` 字段：路径在 `Applications\` 下 = 装好的包；在 CARGO_TARGET_DIR 下 = dev 构建。
要验 dev 改动，得用 dev 构建启动（`pnpm dev`）；要验包，得重新打包安装。

## 边界

- 只读本进程信息，不写文件、不发网络；
- `exeModifiedMs` 读不到时返回 `0`，前端显示「读不到」，不抛异常（诊断页自己崩掉最难查）；
- 重启会换 `pid`，重建会换链接时间 —— 两个信号分别回答「重启了」与「重建了」。
