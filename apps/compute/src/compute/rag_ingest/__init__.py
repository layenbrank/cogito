"""RAG 摄入与检索：把 cogito 的资产正文变成可检索的分块与向量，再按查询取回最相近的块。

三个阶段各自一个模块、各自一个路由，`ROUTER` 把它们聚成一个能力包：

* 分块 `rag.chunk`（**P6b-3**）：`POST /internal/v1/assets/{assetID}/chunks`；
* 嵌入 `rag.embed`（**P6b-4**）：`POST /internal/v1/assets/{assetID}/embeddings`；
* 落索引 `rag.index`（**P6b-4**）：`PUT /internal/v1/assets/{assetID}/index`；
* 检索 `rag.search`（**P6b-5**）：`POST /internal/v1/rag/search`。

检索面与前三者不同：它**只读**，不进幂等账本。同样的 `search.find()` 被两个消费者用着 ——
服务端 agent 步在进程内直接调它（检索是模型的一次工具调用），客户端知识库经 cogito
`POST /api/v1/rag/search` 转进来（检索是用户点的按钮）。所以 `rag.search` **有**端点，
它是客户端云通道的入口。

一个能力包只暴露一个 `ROUTER`（`app.create_app` 按这个名字取），所以新增路由要在这里聚合，
不能各自往 `app` 上挂。

各文件的分工是「一层的错只在一个文件里」：

* `extract.py` —— 字节 → 纯文本（按 MIME 选抽取器，抽不动就 400）；
* `chunking.py` —— 纯文本 → 块（纯函数、确定性，幂等重放的前提）；
* `store.py` —— 块集 / 向量 / 索引版本 → 数据库（按 `chunk_set_id`、`(tenant, asset)` 幂等写入）；
* `search.py` —— 查询文本 → 相近块（读路径，只读不写）；
* `router.py` / `embed.py` / `index.py` —— 按各自的 HTTP 语义串起来，管住幂等与错误码映射。

能力在这里登记（由 [`compute.app.create_app`] 导入本包触发）。**登记了能力就必须真有路由**，
`tests/test_route_surface.py` 会对着契约核一遍。
"""

from __future__ import annotations

from fastapi import APIRouter

from compute import capabilities
from compute.rag_ingest import embed, index, router, search

ROUTER = APIRouter()
ROUTER.include_router(router.ROUTER)
ROUTER.include_router(embed.ROUTER)
ROUTER.include_router(index.ROUTER)
ROUTER.include_router(search.ROUTER)

#: 登记进健康探针的能力名（契约词汇，别改拼写）。
registry = capabilities.registry.register("rag.chunk", implemented_in="compute.rag_ingest")
registry_embed = capabilities.registry.register("rag.embed", implemented_in="compute.rag_ingest")
registry_index = capabilities.registry.register("rag.index", implemented_in="compute.rag_ingest")
registry_search = capabilities.registry.register(
    "rag.search", implemented_in="compute.rag_ingest.search"
)

__all__ = [
    "ROUTER",
    "registry",
    "registry_embed",
    "registry_index",
    "registry_search",
]
