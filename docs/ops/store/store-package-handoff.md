# Microsoft Store 包托管摘要

面向 Partner Center 填写与自检。Worker 实现与运维见 [`apps/distribution/README.md`](../../../apps/distribution/README.md)。

当前版本：**1.3.0**

---

## 1. 包下载地址

### 推荐（Worker）

```text
https://cogito-distribution.layenbrank.workers.dev/1.3.0/cogito_1.3.0_x64-setup.exe
```

### 备用（R2 公共开发域名）

本机可直连时用于自检；Store 也可填此链。

```text
https://pub-7a57d3acde3e4d7b9c42f56423f83c93.r2.dev/1.3.0/cogito_1.3.0_x64-setup.exe
```

### 校验记录

| 项 | 值 |
|----|-----|
| 体积 | `344804707` 字节 |
| 元数据 | `GET ...?meta=1` → `size` 与上一致 |
| Content-Type | `application/octet-stream` |
| 本地源 | `D:\Documents\cache\release\bundle\nsis\cogito_1.3.0_x64-setup.exe` |

---

## 2. Partner Center 包页

| 字段 | 填写值 |
|------|--------|
| 包 URL | 上文「推荐」Worker HTTPS 直链 |
| 体系结构 | `x64` |
| 应用类型 | `EXE` |
| 安装程序参数 | `/S`（大写） |
| 安装成功返回码 | `0` |
| 用户取消返回码 | `1` |
| 其他失败专用项 | 留空 |

NSIS ExitCode 对照：`0` 成功 · `1` 用户取消 · `2` 脚本 Abort（勿与取消码混用）。

---

## 3. 基础设施

| 项 | 值 |
|----|-----|
| R2 桶 | `cogito` |
| 对象键 | `1.3.0/cogito_1.3.0_x64-setup.exe` |
| Worker 代码 | [`apps/distribution`](../../../apps/distribution)（workspace 包 `@cogito/distribution`；统一入口 `pnpm command distribution`） |
| workers.dev 子域 | `layenbrank` |
| 上传 | Worker multipart，或 rclone S3（见 Worker README） |
| 部署 | 仓库根：`pnpm command distribution deploy` |

---

## 4. 上架前检查

1. 境外或可用网络打开包 URL，应直接开始下载（非 HTML / 登录页）。
2. `?meta=1` 返回的 `size` 与本地文件一致。
3. 提交后 **不要覆盖** 该 URL 上的文件；新版本使用新路径（如 `/1.3.1/...`）。
4. 仍须可信 CA **代码签名**（与托管方式无关）。
5. **改名迁移**：本节 URL 已按新工作名 `cogito-distribution` 更新（Cloudflare 侧旧名
   `cogito-downloads` 在删除旧 Worker 前仍可访问）。顺序：`pnpm command distribution deploy`
   → 更新 Partner Center 的包 URL → 删除旧 Worker。
5. GET/HEAD 公开；写操作需 `X-Custom-Auth-Key`。
6. 部分网络（如国内）可能无法访问 `*.workers.dev`；Microsoft Store 服务器拉取通常不受影响。备用链可用 `*.r2.dev`。
