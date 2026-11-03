# @cogito/clipper

Chrome/Chromium MV3 网页剪藏扩展：把当前页转为 Markdown，POST 到本机 cogito client。

**不要**与 `apps/extension` 混淆：那是另一套浏览器扩展产品。

## 协议

- 端点：`POST http://127.0.0.1:19828/clip`
- Body JSON（camelCase）：`{ "title": string, "url": string, "markdown": string }`
- 成功：HTTP 200；client 经 `knowledge://clip` 事件落盘到当前活动库的 `raw/sources/`，并入 ingest 队列
- CORS：本机回环允许扩展跨域 POST

健康检查可另用 `GET /health`（若桥侧未暴露则只依赖 `/clip`）。

## 开发

```bash
pnpm --filter @cogito/clipper build
# 产物在 apps/clipper/dist，Chrome「加载已解压的扩展程序」选该目录
```

## 与 client 的分工

| 侧 | 职责 |
| --- | --- |
| `@cogito/clipper` | 抽取页面 → POST |
| `apps/client` bridge `clip.rs` | 绑定 `:19828`，emit `knowledge://clip` |
| `features/knowledge-clip/clip-inbox.ts` | 写 `raw/sources/*.md` + enqueue ingest |
