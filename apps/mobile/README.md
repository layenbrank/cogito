# i-thinking

基于 Expo SDK 54 的移动端客户端：**磁贴首页** + **Agent 对话**（参考桌面 [i-thinking Studio](https://github.com/layenbrank/i-thinking)、[corex](https://github.com/layenbrank/corex)、[rust-service](https://github.com/layenbrank/rust-service)）。

## 技术栈

- Expo SDK 54 / React Native 0.81
- expo-router、Zustand、TanStack Query、Zod
- NativeWind、react-native-mmkv
- 认证与对话对接 rust-service（JWT + captcha + OpenAI 兼容 gateway SSE）

## 功能

| 模块 | 说明 |
|------|------|
| 登录 / 注册 | `POST /api/v1/auth/captcha` → 滑块验证 → `signin` / `signup` |
| 会话 | `GET /api/v1/auth/profile` 校验 JWT；`POST /signout` 拉黑名单 |
| 磁贴 | 本地镜像：navigation / clock / markdown / intelligence |
| Agent | `GET /gateway/models` + `POST /gateway/chat/completions`（XHR 流式） |

## 配置

默认连接 `http://127.0.0.1:3000`（Android 模拟器自动用 `10.0.2.2:3000`）。

| 键 | 说明 |
|----|------|
| `EXPO_PUBLIC_API_BASE_URL` / `extra.apiBaseUrl` | rust-service 根地址 |
| `EXPO_PUBLIC_DEFAULT_MODEL` / `extra.defaultModel` | gateway 模型名 |
| `EXPO_PUBLIC_TENANT_ID` / `extra.tenantId` | 可选，写入 `X-Tenant-ID` |

真机请把 `127.0.0.1` 换成电脑局域网 IP。开发联调可临时关闭 rust-service 的 `auth.captcha.enabled`。

## 快速开始

```bash
pnpm install
# 先启动 rust-service（默认 :3000）
pnpm run dev
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm run dev` | 启动开发服务器 |
| `pnpm run typecheck` | TypeScript 检查 |
| `pnpm run test` | 单元测试 |
| `pnpm run lint` / `format` | 代码检查与格式化 |
