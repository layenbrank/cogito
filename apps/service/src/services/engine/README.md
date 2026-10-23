# Engine 模块

Bing 搜索建议代理。路由前缀 `/api/v1/engine`。

## 概述

将前端搜索框的联想请求转发至 Bing `AS/Suggestions` API，返回 JSON 建议列表。**不读写数据库**。

## 路由一览

| 方法 | 路径                        | 鉴权 | 说明         |
| ---- | --------------------------- | ---- | ------------ |
| GET  | `/api/v1/engine/suggestion` | JWT  | 获取搜索建议 |

## 鉴权说明

挂载 [`Auth::required()`](../../guards/auth.rs)，需有效 Bearer JWT。

## 数据表

无。

## 实现架构

```
EngineController::find
  └── 解析 Query URLParams
  └── EngineService::suggestion
        └── reqwest GET https://cn.bing.com/AS/Suggestions
        └── 解析 JSON → Suggestion { s, i }
```

源码：[`module.rs`](module.rs) · [`controller.rs`](controller.rs) · [`service.rs`](service.rs) · [`schema.rs`](schema.rs)

---

## 接口详情

### GET /api/v1/engine/suggestion

**Query 参数**

| 参数 | 类型   | 说明                     |
| ---- | ------ | ------------------------ |
| pt   | string | 页面类型，如 `page.home` |
| qry  | string | 搜索关键词               |
| cp   | number | 关键词长度               |
| csr  | string | 客户端标识，如 `1`       |
| pths | string | 路径标识，如 `1`         |
| cvid | string | 会话/版本 ID             |

**示例**

```
GET /api/v1/engine/suggestion?pt=page.home&qry=rust&cp=4&csr=1&pths=1&cvid=00000000-0000-0000-0000-000000000001
```

**成功 data**：Bing 原始建议结构 `{ s: [...], i: { ig: "..." } }`

**常见错误**

| code   | msg                       |
| ------ | ------------------------- |
| 200002 | 请求参数格式错误          |
| 700004 | 网络/解析失败（代理异常） |

---

## 使用示例

```bash
curl "http://127.0.0.1:3000/api/v1/engine/suggestion?pt=page.home&qry=rust&cp=4&csr=1&pths=1&cvid=test-id"
```

**HTTP 文件**：[`http/04-engine.http`](../../../http/04-engine.http) · [`http/suggestion.http`](http/suggestion.http)
