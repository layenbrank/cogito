# Backend Console — 开发

## 启动

```bash
# 需本机 cogito 已起（默认 http://127.0.0.1:3000）
pnpm --filter @i-thinking/backend dev
# → http://127.0.0.1:8300
```

根脚本：`pnpm dev:backend` / `pnpm build:backend`。

## 环境变量

| 变量 | 说明 |
| ---- | ---- |
| `VITE_APP_TITLE` | 标题 |
| `VITE_THINKING` | cogito API 前缀，如 `http://127.0.0.1:3000/api/v1` |

见 `apps/backend/.env.development`。

登录走滑块验证码（`go-captcha-react` → cogito `/auth/captcha`），需 captcha sidecar 与 cogito 一并可用。

## 偏好 API

迁移含 `console_preference` 后需对开发库执行：

```bash
cd apps/cogito && cargo run -p migration -- fresh   # 仅开发空库
```

接口：`GET/PUT /api/v1/console/preference`（ADMIN）。
