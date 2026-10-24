# 上手指南

## 环境

- Node 22+
- pnpm
- 本地 [rust-service](https://github.com/layenbrank/rust-service)（默认 `http://127.0.0.1:3000`）
- Expo SDK 54 Development Build（推荐）

```bash
pnpm install
pnpm run dev
```

## 产品形态

1. **磁贴**：Studio 风格磁贴网格（本地持久化）
2. **Agent**：gateway 模型列表 + SSE 对话
3. **设置**：主题、语言、清空对话、退出（`POST /auth/signout`）

## 认证链路（与 rust-service 对齐）

```text
POST /api/v1/auth/captcha
  → 滑块得到 captchaKey + captchaValue("x,y")
POST /api/v1/auth/signin | /signup
  → data.token (JWT)
GET  /api/v1/auth/profile   # hydrate 校验
POST /api/v1/auth/signout   # Redis 黑名单
```

Body 字段均为 camelCase：`username`、`password`、`captchaKey`、`captchaValue`、`captchaKind`。

成功信封：`code === 200000`。

## Agent 链路

```text
GET  /api/v1/gateway/models
POST /api/v1/gateway/chat/completions  # stream: true，XHR progressive
```

可选请求头：`X-Tenant-ID`。

## 配置

`app.json` → `expo.extra.apiBaseUrl` 或：

```bash
export EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000
pnpm run dev
```
