"""测试公共设施：配置工厂与请求头工具（保持 `conftest.py` 只管夹具）。"""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from uuid import UUID

import httpx
from httpx import AsyncClient

from compute.cogito_client import (
    ASSET_VISIBILITY_PATH,
    CHAT_PATH,
    EMBEDDINGS_PATH,
    SCOPE_ASSET_READ,
    SERVICE_TOKEN_PATH,
    CogitoClient,
)
from compute.config import Settings
from compute.db import Database
from compute.rag_ingest import store

#: `conftest.make_cogito` 的类型：传进来的第一个参数是 `httpx.MockTransport` 的 handler。
MakeCogito = Callable[..., CogitoClient]

INTERNAL_TOKEN = "test-internal-token-0123456789abcdef"
#: 本地 pgvector 容器（见 README 的 `docker run` 一行）；CI 用同一个端口。
DEFAULT_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:55433/compute_test"
#: `.invalid` 是 RFC 2606 保留的不可解析 TLD：防止测试意外打到真实的 cogito。
UNREACHABLE_COGITO_URL = "http://cogito.invalid:3000"
#: 必然连不上的库（端口 1 上不会有人监听），用来验证降级路径。
UNREACHABLE_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/compute_test"

#: 合法的最小 traceparent（全 0 非法，所以这里用非零十六进制）。
TRACEPARENT = "00-11111111111111111111111111111111-2222222222222222-01"

#: compute 自己的表，**顺序即清空顺序**（子表在前，避免外键报错）。
#: `tests/test_db_boundary.py` 用它反证「这库里没有 cogito 的业务表」。
OWNED_TABLES = (
    "agent_memory",
    "rag_embedding",
    "rag_index",
    "rag_chunk",
    "rag_chunk_set",
    "idempotency_key",
)


def database_url() -> str:
    return os.environ.get("COMPUTE_TEST_DATABASE_URL", DEFAULT_DATABASE_URL)


def make_settings(**overrides: Any) -> Settings:
    """构造测试配置：显式值优先于环境变量，避免被开发机上的 `COMPUTE_*` 污染。"""
    values: dict[str, Any] = {
        "environment": "test",
        "log_level": "WARNING",
        "internal_token": INTERNAL_TOKEN,
        "database_url": database_url(),
        "cogito_base_url": UNREACHABLE_COGITO_URL,
        "db_connect_timeout_seconds": 2.0,
        "db_reconnect_interval_seconds": 0.0,
    }
    values.update(overrides)
    return Settings(**values)


def internal_headers(
    *,
    token: str = INTERNAL_TOKEN,
    traceparent: str | None = TRACEPARENT,
    idempotency_key: str | None = None,
) -> dict[str, str]:
    headers = {"X-Internal-Token": token}
    if traceparent is not None:
        headers["traceparent"] = traceparent
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def traceparent_only(traceparent: str = TRACEPARENT) -> dict[str, str]:
    """只要 traceparent：用来证明「缺的确实是令牌」而不是别的头。"""
    return {"traceparent": traceparent}


def echo_payload(tag: str = "a") -> dict[str, str]:
    return {"tag": tag}


#: cogito 的「剧本」：`httpx.MockTransport` 的 handler，决定 cogito 怎么回应每次调用。
CogitoHandler = Callable[[httpx.Request], httpx.Response]

#: `conftest.cogito_backed_client` 的类型：传一个 cogito 剧本，拿回一个可用的异步客户端。
HandlerClient = Callable[..., AsyncClient]


def service_token_body(
    *,
    scope: str = SCOPE_ASSET_READ,
    tenant_id: str = "tenant-a",
    asset_id: str | None = None,
    model: str | None = None,
    approval_id: str | None = None,
    expires_in: int = 300,
) -> dict[str, Any]:
    """cogito `POST /api/v1/service/token` 的成功响应体（`CogitoClient` 就按这些键解）。"""
    body: dict[str, Any] = {
        "token": f"tok-{scope}",
        "expiresAt": int(time.time()) + expires_in,
        "tenantID": tenant_id,
        "scope": scope,
        "tokenType": "service",
    }
    if asset_id is not None:
        body["assetID"] = asset_id
    if model is not None:
        body["model"] = model
    if approval_id is not None:
        body["approvalID"] = approval_id
    return body


def cogito_error(
    status: int, *, retry_after: str | None = None, code: int = 500204
) -> httpx.Response:
    """cogito **服务面**的错误信封（`{code, success, msg, timestamp}`），别和我们的混淆。

    `code` 必须是**数字**：cogito 的信封是 `code: i32`，而 compute 会拿它分辨「审批不合规」
    这种有语义的 403（传 `code=cogito_client.APPROVAL_INVALID_CODE`）。
    """
    return httpx.Response(
        status,
        headers={"Retry-After": retry_after} if retry_after is not None else None,
        json={"code": code, "success": False, "msg": "boom", "timestamp": "x"},
    )


def stub_cogito(content: bytes, *, content_status: int = 200) -> CogitoHandler:
    """最小 cogito 桩：换令牌 → 给正文。`content_status` 非 200 时改回错误信封。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=service_token_body())
        if content_status != 200:
            return cogito_error(content_status, retry_after="7" if content_status == 429 else None)
        return httpx.Response(200, content=content)

    return handler


def embedding_vector(text: str, dimensions: int) -> list[float]:
    """把文本压成一个**确定性**向量：同样的输入必得同样的输出，测试才能按文本断言。"""
    digest = hashlib.sha256(text.encode()).digest()
    return [(digest[position % len(digest)] - 128) / 128.0 for position in range(dimensions)]


class RagStub:
    """RAG 三端点共用的 cogito 桩：换令牌、给正文、算嵌入。

    两个刻意的行为，用来盯住真实上游会犯的错：

    * **返回顺序倒置**：上游不保证 `data[]` 按输入顺序返回，桩一律倒序，逼实现按 `index` 还原；
    * **`dimensions` 可以是函数**：按调用序号给不同维度，用来测「同一模型两种维度」。

    要造畸形响应就用 `embedding_response`（收本批输入与调用序号，返回任意 JSON）。
    """

    def __init__(
        self,
        content: bytes = b"",
        *,
        content_status: int = 200,
        content_type: str | None = None,
        dimensions: int | Callable[[int], int] = 8,
        embedding_response: Callable[[list[str], int], Any] | None = None,
        embed_status: int = 200,
    ) -> None:
        self.content = content
        self.content_status = content_status
        #: 正文响应里的 `Content-Type`。**默认不给**（旧的用例据此验证「mime 缺失」的路径）；
        #: 但 `asset_read` 这种以响应头为准的用例必须设它，否则抽取器无从选择。
        self.content_type = content_type
        self.dimensions = dimensions
        self.embedding_response = embedding_response
        #: 嵌入端点的**错误**状态（429/503）：写路径要证明暂时性故障是整体重试，不是 `ok=false`。
        self.embed_status = embed_status
        self.paths: list[str] = []
        self.token_bodies: list[dict[str, Any]] = []
        self.embed_inputs: list[list[str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.paths.append(path)
        if path == SERVICE_TOKEN_PATH:
            return self._token(request)
        if path == EMBEDDINGS_PATH:
            return self._embeddings(request)
        if self.content_status != 200:
            return cogito_error(
                self.content_status, retry_after="7" if self.content_status == 429 else None
            )
        return httpx.Response(
            200,
            content=self.content,
            headers={"Content-Type": self.content_type} if self.content_type else None,
        )

    def _token(self, request: httpx.Request) -> httpx.Response:
        body: dict[str, Any] = json.loads(request.content)
        self.token_bodies.append(body)
        return httpx.Response(
            200,
            json=service_token_body(
                scope=body["scope"],
                tenant_id=body["tenantID"],
                asset_id=body.get("assetID"),
                model=body.get("model"),
                # 真 cogito 会把审批号回显出来（写令牌），这里照做：调用方要读得到它。
                approval_id=body.get("approvalID"),
            ),
        )

    def _embeddings(self, request: httpx.Request) -> httpx.Response:
        inputs: list[str] = json.loads(request.content)["input"]
        call = len(self.embed_inputs)
        self.embed_inputs.append(inputs)
        if self.embed_status != 200:
            return cogito_error(
                self.embed_status, retry_after="7" if self.embed_status == 429 else None
            )
        if self.embedding_response is not None:
            return httpx.Response(200, json=self.embedding_response(inputs, call))

        dimensions = self.dimensions(call) if callable(self.dimensions) else self.dimensions
        data = [
            {"object": "embedding", "index": index, "embedding": embedding_vector(text, dimensions)}
            for index, text in enumerate(inputs)
        ]
        data.reverse()  # 见类文档：上游不保证顺序
        return httpx.Response(200, json={"object": "list", "data": data, "model": "stub"})

    @property
    def embed_calls(self) -> int:
        return len(self.embed_inputs)

    @property
    def embedded_texts(self) -> list[str]:
        """所有被送去嵌入的文本，按调用顺序摊平。"""
        return [text for batch in self.embed_inputs for text in batch]


def completion(
    content: str | None = None,
    *,
    tool_calls: list[dict[str, Any]] | None = None,
    usage: dict[str, int] | None = None,
) -> dict[str, Any]:
    """上游对话响应（OpenAI 形状）。`tool_calls` 非空时 `finish_reason` 也跟着变。"""
    message: dict[str, Any] = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {
        "id": "chatcmpl-stub",
        "object": "chat.completion",
        "model": "stub",
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if tool_calls else "stop",
            }
        ],
        "usage": usage or {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18},
    }


def tool_call(
    name: str = "knowledge_search",
    arguments: Any = '{"query":"退款政策"}',
    *,
    call_id: str = "call-1",
    kind: str = "function",
) -> dict[str, Any]:
    """一次工具调用。`arguments` 故意是 `Any`：真实上游偶尔会直接给对象。"""
    return {
        "id": call_id,
        "type": kind,
        "function": {"name": name, "arguments": arguments},
    }


class AgentStub(RagStub):
    """`RagStub` + 对话端点 + 可见性写端点：

    * `replies` 按**调用序号**依次消费（用尽后再被调用就是测试写漏了）；
    * `visibility_*` 三个参数描述 cogito 对「按审批改可见性」的回答。

    记录 `chat_bodies`（原始请求体）而不是解析后的结构：断言要能看见「我们真发给上游什么」，
    包括 `tools[]` 的形状与 `messages` 的翻译结果。可见性写同理只记原始 `httpx.Request`
    ——写端点**不该**带 body，这个事实只有原始请求能证明。
    """

    def __init__(
        self,
        content: bytes = b"",
        *,
        replies: Sequence[dict[str, Any]] | None = None,
        chat_status: int = 200,
        visibility_response: Mapping[str, Any] | None = None,
        visibility_status: int = 200,
        visibility_code: int = 500204,
        **kwargs: Any,
    ) -> None:
        super().__init__(content, **kwargs)
        self.replies: list[dict[str, Any]] = list(replies or [])
        self.chat_status = chat_status
        self.chat_bodies: list[dict[str, Any]] = []
        #: 可见性写端点的响应体。默认给一份「私密化」的落地值：真实 cogito 落到什么由**审批台账**
        #: 决定，跟这一次请求里说的可以不同——用例正是靠这个差别验证「描述用的是落地值」。
        self.visibility_response = visibility_response
        #: 可见性写端点的错误状态与错误码：`403 + 500509` 是「审批不合规」那条特殊路径。
        self.visibility_status = visibility_status
        self.visibility_code = visibility_code
        #: 可见性写端点的原始请求：方法、路径、以及「有没有 body」都要看得见。
        self.visibility_writes: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == CHAT_PATH:
            self.paths.append(request.url.path)
            return self._chat(request)
        if request.url.path.endswith(_VISIBILITY_SUFFIX):
            self.paths.append(request.url.path)
            return self._visibility(request)
        return super().__call__(request)

    def _chat(self, request: httpx.Request) -> httpx.Response:
        self.chat_bodies.append(json.loads(request.content))
        if self.chat_status != 200:
            return cogito_error(
                self.chat_status, retry_after="7" if self.chat_status == 429 else None
            )
        if not self.replies:
            raise AssertionError("AgentStub 的回复用完了：用例少准备了一条 reply")
        return httpx.Response(200, json=self.replies.pop(0))

    def _visibility(self, request: httpx.Request) -> httpx.Response:
        self.visibility_writes.append(request)
        if self.visibility_status != 200:
            return cogito_error(self.visibility_status, code=self.visibility_code)
        asset_id = _asset_id_of(request.url.path)
        body: dict[str, Any] = (
            dict(self.visibility_response)
            if self.visibility_response is not None
            else {"visibility": "PRIVATE", "viewers": []}
        )
        body.setdefault("id", asset_id)
        return httpx.Response(200, json=body)

    @property
    def chat_calls(self) -> int:
        return len(self.chat_bodies)

    @property
    def last_chat(self) -> dict[str, Any]:
        return self.chat_bodies[-1]

    @property
    def visibility_urls(self) -> list[str]:
        return [request.url.path for request in self.visibility_writes]


#: 可见性写端点的路径后缀，用来把请求分流到 `AgentStub._visibility`。
_VISIBILITY_SUFFIX = "/visibility"


def _asset_id_of(path: str) -> str:
    """从 `/api/v1/service/assets/{id}/visibility` 里抠出资产 id（按声明的模板切，不猜段号）。"""
    prefix, suffix = ASSET_VISIBILITY_PATH.split("{asset_id}")
    return path.removeprefix(prefix).removesuffix(suffix)


#: 向量与索引用例的默认归属：任意 UUID 即可，只要各文件保持一致。
TENANT_ID = "tenant-a"
ASSET_ID = "8f14e45f-ceea-467a-9a3e-1b7c2d5e9f01"


async def seed_chunk_set(
    database: Database,
    *,
    chunk_set_id: str,
    texts: Sequence[str],
    tenant_id: str = TENANT_ID,
    asset_id: str = ASSET_ID,
    name: str | None = "notes.txt",
) -> store.ChunkSet:
    """直接往库里写一份块集（不走 HTTP）。

    嵌入与索引的用例只关心自己那一层，没必要每次都先跑一遍分块端点——那样一个用例
    会因为另一层的问题而红，排查时反而要多想一层。
    """
    joined = "\n\n".join(texts)
    chunk_set = store.ChunkSet(
        chunk_set_id=UUID(chunk_set_id),
        tenant_id=tenant_id,
        asset_id=UUID(asset_id),
        mime="text/plain",
        name=name,
        text_sha=hashlib.sha256(joined.encode()).hexdigest(),
        chunk_count=len(texts),
        chunk_size=64,
        chunk_overlap=0,
        extractor="text",
        source_bytes=len(joined.encode()),
    )
    chunks = [
        store.StoredChunk(ordinal=ordinal, text=text, char_start=0, char_end=len(text))
        for ordinal, text in enumerate(texts)
    ]
    async with database.acquire() as connection:
        await store.save(connection, chunk_set=chunk_set, chunks=chunks)
    return chunk_set


async def save_embeddings(
    database: Database,
    *,
    chunk_set_id: str,
    items: Sequence[tuple[int, Sequence[float]]],
    model: str,
) -> None:
    """直接写一批向量，维度按每条自己的长度（用来造「维度不一致」这类库内状态）。"""
    async with database.acquire() as connection:
        for ordinal, vector in items:
            await store.save_embeddings(
                connection,
                chunk_set_id=UUID(chunk_set_id),
                model=model,
                dimensions=len(vector),
                items=[(ordinal, vector)],
            )


async def seed_indexed_asset(
    database: Database,
    *,
    chunk_set_id: str,
    texts: Sequence[str],
    model: str,
    tenant_id: str = TENANT_ID,
    asset_id: str = ASSET_ID,
    dimensions: int = 8,
) -> store.ChunkSet:
    """造一个**可检索**的资产：块集 + 向量 + 索引行（向量由 `embedding_vector` 确定性算出）。

    检索用例必须能自己控制「哪一块最相近」：查询文本与某个块的文本一致时余弦距离为 0，
    所以「取回来的第一条是不是期望那块」是确定性的，不依赖任何模型行为。
    """
    chunk_set = await seed_chunk_set(
        database, chunk_set_id=chunk_set_id, texts=texts, tenant_id=tenant_id, asset_id=asset_id
    )
    await save_embeddings(
        database,
        chunk_set_id=chunk_set_id,
        items=[(ordinal, embedding_vector(text, dimensions)) for ordinal, text in enumerate(texts)],
        model=model,
    )
    async with database.acquire() as connection:
        await store.save_index(
            connection,
            entry=store.IndexEntry(
                tenant_id=tenant_id,
                asset_id=UUID(asset_id),
                chunk_set_id=UUID(chunk_set_id),
                model=model,
                dimensions=dimensions,
                chunk_count=len(texts),
                collection=f"stub-{tenant_id}",
            ),
        )
    return chunk_set


async def stored_vectors(
    database: Database, *, chunk_set_id: str, model: str
) -> list[tuple[int, list[float]]]:
    """读回向量本身（`store` 层刻意不提供，只有测试需要核对具体数值）。

    pgvector 的 decoder 给的是 `Vector` 对象，且内部是 float32，断言时用 `approx`。
    """
    async with database.acquire() as connection:
        rows = await connection.fetch(
            "SELECT ordinal, embedding FROM rag_embedding"
            " WHERE chunk_set_id = $1 AND model = $2 ORDER BY ordinal",
            UUID(chunk_set_id),
            model,
        )
    return [
        (row["ordinal"], [float(value) for value in row["embedding"].to_list()]) for row in rows
    ]


async def stored_index_row(
    database: Database, *, tenant_id: str = TENANT_ID, asset_id: str = ASSET_ID
) -> dict[str, Any] | None:
    async with database.acquire() as connection:
        row = await connection.fetchrow(
            "SELECT * FROM rag_index WHERE tenant_id = $1 AND asset_id = $2",
            tenant_id,
            UUID(asset_id),
        )
    return None if row is None else dict(row)


async def stored_index_count(database: Database) -> int:
    """索引表里的行数：一个资产只该有一行（旧版本被替换，不是并存）。"""
    async with database.acquire() as connection:
        return int(await connection.fetchval("SELECT count(*) FROM rag_index"))
