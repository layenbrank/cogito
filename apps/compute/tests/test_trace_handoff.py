"""跨进程链路贯通：入站的 `traceparent` 必须一路续到 compute 发出去的每一个请求上。

`test_traceparent.py` 钉的是入口那一段（校验、回写、`ContextVar` 真的到了路由），
`test_cogito_client.py` 钉的是出站那一段（沿用当前 trace-id、换新 span-id）。两段各自都对，
**接起来还是可能漏**：中间件设了上下文、某个调用点却没读它（或者换了任务、换了令牌、
换了批次就重开一条链路），照样能通过上面两组测试。

这一条就是在真实能力请求里把两端接上：请求打进来，收走上游调用的每一个 `traceparent`，
再逐条核对。链路的用途只有一个 —— 跨语言排障时两侧日志能对上同一个 trace-id；
span-id 必须各不相同，否则「哪一次调用慢」就分不出来了。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from httpx import AsyncClient, Response

from compute import trace
from compute.cogito_client import ASSET_CONTENT_PATH, EMBEDDINGS_PATH, SERVICE_TOKEN_PATH
from support import (
    ASSET_ID,
    TENANT_ID,
    HandlerClient,
    RagStub,
    internal_headers,
    seed_chunk_set,
)

#: 入站链路（`support.TRACEPARENT` 同款）：非全 0 的十六进制，`01` 表示已采样。
INBOUND_TRACE_ID = "1" * 32
INBOUND_SPAN_ID = "2" * 16
INBOUND = f"00-{INBOUND_TRACE_ID}-{INBOUND_SPAN_ID}-01"

CHUNK_SET_ID = "b7d0c3a1-5e42-4f89-a1b2-3c4d5e6f7a80"
MODEL = "text-embedding-3-small"
DIMENSIONS = 8
TEXTS = tuple(f"第 {index} 块正文。" for index in range(6))
SOURCE = "第一块正文。\n\n第二块正文。"

CHUNKS_ROUTE = f"/internal/v1/assets/{ASSET_ID}/chunks"
EMBEDDINGS_ROUTE = f"/internal/v1/assets/{ASSET_ID}/embeddings"


class TraceRecorder:
    """记下每个出站调用的 `traceparent`，其余照旧交给真正的桩。"""

    def __init__(self, inner: Callable[[httpx.Request], httpx.Response]) -> None:
        self.inner = inner
        self.handoffs: list[str] = []
        self.paths: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        value = request.headers.get(trace.TRACEPARENT_HEADER)
        if value is not None:
            self.handoffs.append(value)
        return self.inner(request)

    def parsed(self) -> list[trace.TraceContext]:
        """出站的链路值必须条条合法，否则「续上链路」这件事本身就没发生。"""
        contexts = [trace.TraceContext.parse(value) for value in self.handoffs]
        assert all(context is not None for context in contexts), (
            f"出站发送了非法链路值：{self.handoffs}"
        )
        return [context for context in contexts if context is not None]

    @property
    def span_ids(self) -> list[str]:
        return [context.span_id for context in self.parsed()]

    def assert_continues(self, inbound: str) -> None:
        """每一个出站请求都在同一条链路上，且各自是一个新 span。"""
        origin = trace.TraceContext.parse(inbound)
        assert origin is not None
        contexts = self.parsed()
        assert contexts, "一个出站请求都没有带 traceparent"

        assert [context.trace_id for context in contexts] == [origin.trace_id] * len(contexts), (
            f"出站的 trace-id 与入站不一致：{self.handoffs}"
        )
        assert [context.flags for context in contexts] == [origin.flags] * len(contexts), (
            f"采样标记被改动：{self.handoffs}"
        )
        assert len(set(self.span_ids)) == len(self.span_ids), (
            f"同一条链路上出现了重复的 span-id，排障时分不出是哪一次：{self.span_ids}"
        )
        assert origin.span_id not in self.span_ids, (
            f"出站复用了入站的 span-id（{origin.span_id}），父子 span 无法区分"
        )


def assert_echoed(response: Response, inbound: str = INBOUND) -> None:
    assert response.headers.get(trace.TRACEPARENT_HEADER) == inbound


async def post_chunks(
    client: AsyncClient, *, traceparent: str | None = INBOUND, key: str = "trace-key-0001"
) -> Response:
    return await client.post(
        CHUNKS_ROUTE,
        json={"schemaVersion": 1, "tenantID": TENANT_ID, "mime": "text/plain", "name": "notes.txt"},
        headers=internal_headers(traceparent=traceparent, idempotency_key=key),
    )


async def post_embeddings(
    client: AsyncClient, *, traceparent: str | None = INBOUND, key: str = "trace-key-0002"
) -> Response:
    return await client.post(
        EMBEDDINGS_ROUTE,
        json={
            "schemaVersion": 1,
            "tenantID": TENANT_ID,
            "chunkSetID": CHUNK_SET_ID,
            "model": MODEL,
            "from": 0,
            "to": len(TEXTS),
        },
        headers=internal_headers(traceparent=traceparent, idempotency_key=key),
    )


async def test_chunk_flow_hands_the_trace_over_on_every_call(
    cogito_backed_client: HandlerClient,
) -> None:
    """分块要换令牌 + 取正文：两次出站都得续上，且各自新开一个 span。"""
    recorder = TraceRecorder(RagStub(SOURCE.encode()))
    client = cogito_backed_client(recorder)

    response = await post_chunks(client)

    assert response.status_code == 200
    assert_echoed(response)
    assert recorder.paths == [SERVICE_TOKEN_PATH, ASSET_CONTENT_PATH.format(asset_id=ASSET_ID)]
    recorder.assert_continues(INBOUND)


async def test_embed_flow_hands_the_trace_over_across_batches(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """分批是一处典型的断点：每批都要读当前上下文，而不是第一次调用时抓一次就不管了。"""
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    recorder = TraceRecorder(RagStub())
    client = cogito_backed_client(recorder, embed_batch_size=2)

    response = await post_embeddings(client)

    assert response.status_code == 200
    assert_echoed(response)
    embed_calls = [path for path in recorder.paths if path == EMBEDDINGS_PATH]
    assert len(embed_calls) == 3, f"6 块 / 每批 2 条应该是 3 批，实际打了 {recorder.paths}"
    recorder.assert_continues(INBOUND)


async def test_token_exchange_is_part_of_the_same_trace(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """换令牌是**链路内**的一跳，不是另起一条：cogito 侧要靠它看清「取正文慢」还是「换令牌慢」。"""
    recorder = TraceRecorder(RagStub(SOURCE.encode()))
    client = cogito_backed_client(recorder)

    await post_chunks(client)

    token_handoff = dict(zip(recorder.paths, recorder.handoffs, strict=True))[SERVICE_TOKEN_PATH]
    assert token_handoff.split("-")[1] == INBOUND_TRACE_ID


@pytest.mark.parametrize(
    ("path", "method"),
    [(CHUNKS_ROUTE, "POST"), (EMBEDDINGS_ROUTE, "POST")],
)
async def test_missing_traceparent_stops_before_any_outbound_call(
    cogito_backed_client: HandlerClient, path: str, method: str
) -> None:
    """缺链路 = 请求本身不合契约：应当在入口就停下，而不是先去 cogito 那边留一圈痕迹。"""
    recorder = TraceRecorder(RagStub(SOURCE.encode()))
    client = cogito_backed_client(recorder)

    response = await client.request(
        method, path, json={}, headers=internal_headers(traceparent=None)
    )

    assert response.status_code == 400
    assert recorder.paths == [], f"校验失败却已经打了上游：{recorder.paths}"


async def test_rejected_traceparent_never_leaks_into_the_outbound_call(
    cogito_backed_client: HandlerClient,
) -> None:
    """全 0 的 id 非法（W3C）：不能「凑合着用」——那样 cogito 侧会把两条无关的请求算成同一条链路。"""
    recorder = TraceRecorder(RagStub(SOURCE.encode()))
    client = cogito_backed_client(recorder)
    illegal = f"00-{'0' * 32}-{INBOUND_SPAN_ID}-01"

    response = await post_chunks(client, traceparent=illegal)

    assert response.status_code == 400
    assert recorder.paths == []


async def test_a_second_request_starts_from_its_own_traceparent(
    cogito_backed_client: HandlerClient,
) -> None:
    """上下文是**每个请求**各自的：第一条链路不能泄进第二条，否则日志会串线。"""
    recorder = TraceRecorder(RagStub(SOURCE.encode()))
    client = cogito_backed_client(recorder)
    second = f"00-{'3' * 32}-{'4' * 16}-01"

    await post_chunks(client, key="trace-key-0003")
    recorder.handoffs.clear()
    await post_chunks(client, traceparent=second, key="trace-key-0004")

    recorder.assert_continues(second)
