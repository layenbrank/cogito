# Application 模块

应用接口程序入口，负责挂载 `/api/v1` 下全部子模块路由。

## 路由

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/v1/application/toRead` | 无 | 读取应用配置（Mock） |

## 数据结构

响应 `data` 为 `App`（见 `schema.rs`），包含 id、name、component、size、shape 等字段。

## 本地调试

```bash
curl http://127.0.0.1:3000/api/v1/application/toRead
```

- [`http/05-application.http`](../../../http/05-application.http)
