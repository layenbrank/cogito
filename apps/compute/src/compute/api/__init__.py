"""HTTP 层：路由与请求/响应的形状。

只放「怎么把契约翻译成 HTTP」，业务逻辑放各自的能力包（`rag_ingest` / `agent_runtime` /
`providers`）。`HEALTH_PATH` 定义在 [`compute.api.health`] 里并被中间件引用，
避免「中间件要豁免哪些路径」散落两处。
"""
