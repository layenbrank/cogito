# Markdown 模块

占位模块（**未挂载**到 `ApplicationModule`）。路由前缀预留 `/api/v1/markdown`。

## 概述

| 能力 | 说明 |
|------|------|
| CRUD 骨架 | `service.rs` 返回空 `Schema`，无持久化 |

**状态**：演示/脚手架，不参与生产流量。实现真实能力前需：表结构、路由注册、OAS、鉴权策略。

## 路由一览

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| — | — | — | 当前无对外路由 |

## 鉴权说明

未注册；未来若开放，默认挂 `Auth::required()`。

## 数据表

无。

## 实现架构

```
（未挂载）MarkdownModule → MarkdownController → MarkdownService
```

## 接口详情

无对外接口。
