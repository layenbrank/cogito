# 在线工具（FFmpeg / Pandoc）的按需下载

精简版安装包不带 FFmpeg / Pandoc 这类上百 MB 的第三方二进制。缺的时候用户在
**设置 → 诊断 → 完整版能力** 里一键下载，装好的那份优先于随包那份被使用。

## 落点与取用顺序

- 下载落点：`<appLocalData>/sidecar/<包>/<版本>/`（Windows：
  `%LOCALAPPDATA%\<identifier>\sidecar\ffmpeg\9.0.2\`）。版本进路径，升级就是换目录，
  卸载直接删整个 `<包>/`。
- 取用顺序：**运行时下载的那份 → 随包那份**（`resource_dir/binaries`、可执行文件旁的
  `binaries/`、dev 下再沿 exe 祖先找仓库的 `src-tauri/binaries`）。
  统一入口是 `media::command::find_tool_path`；能力探测 `system::capabilities` 用同一顺序。
- 包与二进制的对应：`ffmpeg` 包内含 `ffmpeg` / `ffprobe` / `ffplay`；`ffprobe` 不是独立包，
  下载 / 卸载都按 `ffmpeg` 这个键走。`pandoc` 单独一个包。

## 版本与校验和的唯一来源

Rust 侧构建期 `include_str!` 内联仓库的
[`scripts/commands/features/sidecar/tools.lock.json`](../../../scripts/commands/features/sidecar/tools.lock.json)，
客户端**不另存一份清单**。升级工具版本只改那一个文件（studio 的 `sidecar/manifest.json` 同源）。

## 安装流程

`tools:install`（异步命令，重活都在阻塞线程池）：

1. 下载到 `<包>/<版本>.tmp/<归档名>`，边写盘边算 sha256，进度按 100ms 节流通过
   `tools://install-progress` 推送（payload：`{ key, phase, received, total }`）；
2. 校验 sha256（不一致即失败，不落正式目录）；
3. 解压：系统 `tar -xf` 优先（Windows 10+ 自带 bsdtar，认 zip / tar.\*），zip 失败回退
   `Expand-Archive` / `unzip`；
4. 只把可执行文件搬进 `out/`，**必需二进制缺一即失败**（`ffmpeg` 包要求 ffmpeg + ffprobe）；
5. 删除旧版本目录后 `rename(out → <版本>)` 上位，最后清掉 `.tmp`。

任何一步失败都会清空 `.tmp`：正式目录里不会出现半份安装。

`tools:remove` 删整个 `<包>/` 目录；正在下载时拒绝。Windows 上若二进制正被占用，
错误信息会提示先退出相关进程。

## 并发与幂等

- 同一个包同时只允许一个安装（进程内 `HashSet` 闸门），重复点击得到「正在下载中」。
- 已装好（必需二进制齐全）时再次安装直接返回成功。
- 能力探测带 10 分钟版本缓存：反复打开设置页不会反复起 `--version` 子进程。

## 前端契约

`apis/diagnostics.ts`：

- `POST_TOOLS_INSTALL(key)` / `POST_TOOLS_REMOVE(key)`（key = `installKey`：`ffmpeg` / `pandoc`）
- `ToolInstallProgress` 类型（进度事件 payload）

进度事件按约定留在视图层订阅（`views/settings/surfaces/diagnostics.tsx` 的 `listen`），
`apis` 层只做 `invoke`。

`GET_CAPABILITIES` 的每个工具带：

| 字段 | 含义 |
| --- | --- |
| `installable` | 当前平台有没有可下载的包 |
| `installed` | 找到的是不是用户下载的那份（可卸载） |
| `installKey` | 安装 / 卸载要传的包键（`ffprobe` → `ffmpeg`） |
