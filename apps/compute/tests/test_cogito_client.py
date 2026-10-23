"""回打 cogito 的客户端：换令牌、读资产正文、借网关算嵌入与对话、按审批改可见性，以及错误映射。

错误映射是这里最要紧的部分——它的口径是「cogito 能不能重试」：请求本身不对就回 400 让 cogito
别再试，暂时性的问题回 503/429 让 cogito 重试。映射错了会表现为「cogito 无限重试一个永远失败的请求」
或者「一次网络抖动就让整个活动判失败」，两种都很难从日志里看出来。
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
import pytest

from compute import errors, trace
from compute.cogito_client import (
    APPROVAL_INVALID_CODE,
    ASSET_VISIBILITY_PATH,
    CHAT_PATH,
    EMBEDDINGS_PATH,
    INTERNAL_TOKEN_HEADER,
    SCOPE_ASSET_READ,
    SCOPE_ASSET_WRITE,
    SCOPE_CHAT,
    SCOPE_EMBEDDINGS,
    SERVICE_TOKEN_HEADER,
    SERVICE_TOKEN_PATH,
    CogitoClient,
)
from support import INTERNAL_TOKEN, TRACEPARENT, MakeCogito, make_settings

TENANT = "tenant-a"
ASSET = "asset-1"
MODEL = "text-embedding-3-small"
CONTENT_PATH = f"/api/v1/service/assets/{ASSET}/content"
VISIBILITY_PATH = ASSET_VISIBILITY_PATH.format(asset_id=ASSET)
APPROVAL = "approval-1"


def token_body(
    *,
    scope: str = SCOPE_ASSET_READ,
    asset_id: str = ASSET,
    model: str | None = None,
    approval_id: str | None = None,
    expires_in: int = 300,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "token": f"tok-{scope}",
        "expiresAt": int(time.time()) + expires_in,
        "tenantID": TENANT,
        "scope": scope,
        "assetID": asset_id,
        "tokenType": "service",
    }
    if model is not None:
        body["model"] = model
    if approval_id is not None:
        body["approvalID"] = approval_id  # cogito 会把写令牌的凭据来源回显出来
    return body


def cogito_error(
    status: int, *, code: int = 500204, retry_after: str | None = None
) -> httpx.Response:
    """cogito 服务面的错误信封（`{code, success, msg, timestamp}`），不是我们的那个。

    `code` 在 cogito 侧是 `i32`，所以这里也要发数字：发字符串会让 compute 认不出 500509 这类
    有语义的码，只能退化成「看 HTTP 状态猜」。
    """
    headers = {"Retry-After": retry_after} if retry_after is not None else None
    return httpx.Response(
        status,
        headers=headers,
        json={"code": code, "success": False, "msg": "boom", "timestamp": "x"},
    )


async def test_token_request_matches_the_gateway_contract(make_cogito: MakeCogito) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=token_body())

    client: CogitoClient = make_cogito(handler)

    token = await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)

    assert token.token == f"tok-{SCOPE_ASSET_READ}"
    assert token.tenant_id == TENANT
    assert token.asset_id == ASSET
    assert token.token_type == "service"

    request = requests[0]
    assert (request.method, request.url.path) == ("POST", SERVICE_TOKEN_PATH)
    assert request.headers[INTERNAL_TOKEN_HEADER] == INTERNAL_TOKEN
    assert json.loads(request.content) == {
        "tenantID": TENANT,
        "scope": SCOPE_ASSET_READ,
        "assetID": ASSET,
    }


async def test_ttl_is_sent_only_when_configured(make_cogito: MakeCogito) -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=token_body())

    default_ttl: CogitoClient = make_cogito(handler)
    await default_ttl.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)

    explicit_ttl: CogitoClient = make_cogito(handler, cogito_service_token_ttl_seconds=60)
    await explicit_ttl.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id="asset-2")

    assert "ttlSecs" not in bodies[0]
    assert bodies[1]["ttlSecs"] == 60


async def test_token_is_cached_per_scope_and_asset(make_cogito: MakeCogito) -> None:
    count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal count
        count += 1
        return httpx.Response(200, json=token_body(asset_id=json.loads(request.content)["assetID"]))

    client: CogitoClient = make_cogito(handler)

    await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)
    await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)
    assert count == 1  # 只换一次

    await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id="asset-2")
    assert count == 2  # 作用域不同就是另一枚令牌


async def test_token_is_renewed_before_it_expires(make_cogito: MakeCogito) -> None:
    count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal count
        count += 1
        # 剩余 5 秒 < 默认的 30 秒 skew：宁可提前换，也不要在中途突然过期。
        return httpx.Response(200, json=token_body(expires_in=5))

    client: CogitoClient = make_cogito(handler)

    await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)
    await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)

    assert count == 2


async def test_asset_content_uses_the_scoped_token(make_cogito: MakeCogito) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body())
        seen.append(request)
        return httpx.Response(
            200, content=b"hello bytes", headers={"Content-Type": "application/pdf"}
        )

    client: CogitoClient = make_cogito(handler)

    content = await client.asset_content(tenant_id=TENANT, asset_id=ASSET, max_bytes=1024)

    assert content.data == b"hello bytes"
    # MIME 只能信响应头：调用方以为的 mime 与资产真实的 mime 可能不是一回事。
    assert content.mime == "application/pdf"
    assert (seen[0].method, seen[0].url.path) == ("GET", CONTENT_PATH)
    assert seen[0].headers[SERVICE_TOKEN_HEADER] == f"tok-{SCOPE_ASSET_READ}"


async def test_asset_content_tolerates_a_missing_content_type(make_cogito: MakeCogito) -> None:
    """没有 `Content-Type` 时给空串：抽取器会自己判「不支持」，而不是在这里猜一个类型。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body())
        return httpx.Response(200, content=b"raw")

    client: CogitoClient = make_cogito(handler)

    content = await client.asset_content(tenant_id=TENANT, asset_id=ASSET, max_bytes=1024)

    assert content.mime == ""


async def test_asset_content_above_the_limit_is_a_request_error(make_cogito: MakeCogito) -> None:
    """超限重试也只会再超一次，所以判成 400（不可重试）而不是 503。"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body())
        return httpx.Response(200, content=b"way too long")

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.asset_content(tenant_id=TENANT, asset_id=ASSET, max_bytes=4)

    assert raised.value.code is errors.ErrorCode.INVALID_REQUEST
    assert raised.value.status == 400


@pytest.mark.parametrize(
    ("cogito_status", "expected_status", "expected_code"),
    [
        (400, 400, errors.ErrorCode.INVALID_REQUEST),
        (404, 400, errors.ErrorCode.INVALID_REQUEST),
        (401, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        (403, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        (429, 429, errors.ErrorCode.RATE_LIMITED),
        (500, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        (503, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
    ],
)
async def test_content_errors_are_mapped_by_retryability(
    make_cogito: MakeCogito,
    cogito_status: int,
    expected_status: int,
    expected_code: errors.ErrorCode,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body())
        return cogito_error(cogito_status, retry_after="7" if cogito_status == 429 else None)

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.asset_content(tenant_id=TENANT, asset_id=ASSET, max_bytes=1024)

    assert raised.value.status == expected_status
    assert raised.value.code is expected_code
    if cogito_status == 429:
        assert raised.value.headers["Retry-After"] == "7"


async def test_rate_limit_without_a_usable_retry_after_is_tolerated(
    make_cogito: MakeCogito,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body())
        return httpx.Response(429, text="slow down", headers={"Retry-After": "soon"})

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.asset_content(tenant_id=TENANT, asset_id=ASSET, max_bytes=1024)

    assert raised.value.status == 429
    assert "Retry-After" not in raised.value.headers


async def test_non_json_error_body_does_not_crash(make_cogito: MakeCogito) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body())
        return httpx.Response(502, text="<html>bad gateway</html>")

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.asset_content(tenant_id=TENANT, asset_id=ASSET, max_bytes=1024)

    assert raised.value.code is errors.ErrorCode.DEPENDENCY_UNAVAILABLE


async def test_token_exchange_failure_is_reported_as_dependency(make_cogito: MakeCogito) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return cogito_error(401)

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)

    assert raised.value.code is errors.ErrorCode.DEPENDENCY_UNAVAILABLE


async def test_network_failure_is_reported_as_dependency(make_cogito: MakeCogito) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)

    assert raised.value.status == 503


async def test_outbound_requests_continue_the_current_trace(make_cogito: MakeCogito) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=token_body())

    client: CogitoClient = make_cogito(handler)
    parent = trace.TraceContext.parse(TRACEPARENT)
    assert parent is not None
    token = trace.set_current(parent)
    try:
        await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)
    finally:
        trace.reset_current(token)

    sent = requests[0].headers["traceparent"]
    version, trace_id, span_id, flags = sent.split("-")
    assert (version, flags) == ("00", "01")
    assert trace_id == parent.trace_id  # 同一条链路
    assert span_id != parent.span_id  # 新的 span


async def test_outbound_requests_omit_traceparent_without_a_current_context(
    make_cogito: MakeCogito,
) -> None:
    """没有上游链路时不硬造一个：cogito 那边会自己补，凭空编一个只会污染日志。"""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=token_body())

    client: CogitoClient = make_cogito(handler, cogito_timeout_seconds=1.0)
    await client.service_token(tenant_id=TENANT, scope=SCOPE_ASSET_READ, asset_id=ASSET)

    assert "traceparent" not in requests[0].headers


async def test_embeddings_request_matches_the_gateway_contract(make_cogito: MakeCogito) -> None:
    """嵌入走 `scope=embeddings` + `model` 的令牌：`model` 同时是 cogito 侧的模型自检。"""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body(scope=SCOPE_EMBEDDINGS, model=MODEL))
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.1, 0.2]}]})

    client: CogitoClient = make_cogito(handler)

    payload = await client.embeddings(tenant_id=TENANT, model=MODEL, inputs=["a", "b"])

    assert payload == {"data": [{"index": 0, "embedding": [0.1, 0.2]}]}  # 裸 JSON，不套信封
    token_request, embed_request = requests
    assert json.loads(token_request.content) == {
        "tenantID": TENANT,
        "scope": SCOPE_EMBEDDINGS,
        "model": MODEL,
    }
    assert (embed_request.method, embed_request.url.path) == ("POST", EMBEDDINGS_PATH)
    assert embed_request.headers[SERVICE_TOKEN_HEADER] == f"tok-{SCOPE_EMBEDDINGS}"
    # 不传 dimensions：不少模型不认这个参数，传了直接 400；维度按响应里向量的长度读。
    assert json.loads(embed_request.content) == {"model": MODEL, "input": ["a", "b"]}


@pytest.mark.parametrize(
    ("cogito_status", "expected_status", "expected_code"),
    [
        (400, 400, errors.ErrorCode.INVALID_REQUEST),
        (401, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        (429, 429, errors.ErrorCode.RATE_LIMITED),
        (503, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
    ],
)
async def test_embedding_errors_are_mapped_by_retryability(
    make_cogito: MakeCogito,
    cogito_status: int,
    expected_status: int,
    expected_code: errors.ErrorCode,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body(scope=SCOPE_EMBEDDINGS, model=MODEL))
        return cogito_error(cogito_status, retry_after="7" if cogito_status == 429 else None)

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.embeddings(tenant_id=TENANT, model=MODEL, inputs=["a"])

    assert raised.value.status == expected_status
    assert raised.value.code is expected_code


async def test_embedding_tokens_are_not_shared_across_models(make_cogito: MakeCogito) -> None:
    """换模型就是换一枚令牌：拿 A 模型的令牌去算 B 模型，cogito 侧会当成越权。"""
    minted: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            body: dict[str, Any] = json.loads(request.content)
            minted.append(body)
            return httpx.Response(
                200, json=token_body(scope=SCOPE_EMBEDDINGS, model=str(body["model"]))
            )
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.5]}]})

    client: CogitoClient = make_cogito(handler)

    await client.embeddings(tenant_id=TENANT, model=MODEL, inputs=["a"])
    await client.embeddings(tenant_id=TENANT, model=MODEL, inputs=["a"])
    await client.embeddings(tenant_id=TENANT, model="another-model", inputs=["a"])

    assert [body["model"] for body in minted] == [MODEL, "another-model"]


CHAT_MODEL = "gpt-4o-mini"
MESSAGES: list[dict[str, Any]] = [{"role": "user", "content": "你好"}]
TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {"name": "knowledge_search", "parameters": {}}}
]


async def test_chat_request_matches_the_gateway_contract(make_cogito: MakeCogito) -> None:
    """对话走 `scope=chat` + `model` 的令牌，报文是 OpenAI 线格式的原样透传。"""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body(scope=SCOPE_CHAT, model=CHAT_MODEL))
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant"}}]})

    client: CogitoClient = make_cogito(handler)

    payload = await client.chat(tenant_id=TENANT, model=CHAT_MODEL, messages=MESSAGES, tools=TOOLS)

    assert payload == {"choices": [{"message": {"role": "assistant"}}]}  # 裸 JSON，不套信封
    token_request, chat_request = requests
    assert json.loads(token_request.content) == {
        "tenantID": TENANT,
        "scope": SCOPE_CHAT,
        "model": CHAT_MODEL,
    }
    assert (chat_request.method, chat_request.url.path) == ("POST", CHAT_PATH)
    assert chat_request.headers[SERVICE_TOKEN_HEADER] == f"tok-{SCOPE_CHAT}"
    assert json.loads(chat_request.content) == {
        "model": CHAT_MODEL,
        "messages": MESSAGES,
        "tools": TOOLS,
    }


async def test_chat_omits_tools_when_there_are_none(make_cogito: MakeCogito) -> None:
    """没有工具时**不要**发一个空数组：有些上游把空 `tools` 当成非法参数直接 400。"""
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body(scope=SCOPE_CHAT, model=CHAT_MODEL))
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": []})

    client: CogitoClient = make_cogito(handler)

    await client.chat(tenant_id=TENANT, model=CHAT_MODEL, messages=MESSAGES)
    await client.chat(tenant_id=TENANT, model=CHAT_MODEL, messages=MESSAGES, tools=[])

    assert [sorted(body) for body in bodies] == [["messages", "model"], ["messages", "model"]]


@pytest.mark.parametrize(
    ("cogito_status", "expected_status", "expected_code"),
    [
        (400, 400, errors.ErrorCode.INVALID_REQUEST),
        (401, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        (429, 429, errors.ErrorCode.RATE_LIMITED),
        (503, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
    ],
)
async def test_chat_errors_are_mapped_by_retryability(
    make_cogito: MakeCogito,
    cogito_status: int,
    expected_status: int,
    expected_code: errors.ErrorCode,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(200, json=token_body(scope=SCOPE_CHAT, model=CHAT_MODEL))
        return cogito_error(cogito_status, retry_after="7" if cogito_status == 429 else None)

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.chat(tenant_id=TENANT, model=CHAT_MODEL, messages=MESSAGES)

    assert raised.value.status == expected_status
    assert raised.value.code is expected_code


async def test_chat_and_embedding_tokens_are_not_interchangeable(make_cogito: MakeCogito) -> None:
    """受众不同就是两枚令牌：共用会让审计把「对话」记到「嵌入」上，作用域也互相越权。"""
    scopes: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            body: dict[str, Any] = json.loads(request.content)
            scopes.append(str(body["scope"]))
            return httpx.Response(
                200, json=token_body(scope=str(body["scope"]), model=str(body["model"]))
            )
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.5]}]})

    client: CogitoClient = make_cogito(handler)

    await client.chat(tenant_id=TENANT, model=MODEL, messages=MESSAGES)
    await client.embeddings(tenant_id=TENANT, model=MODEL, inputs=["a"])
    await client.chat(tenant_id=TENANT, model=MODEL, messages=MESSAGES)

    assert scopes == [SCOPE_CHAT, SCOPE_EMBEDDINGS]


async def test_visibility_write_matches_the_gateway_contract(make_cogito: MakeCogito) -> None:
    """改可见性：拿审批号换一枚 `scope=asset-write` 的令牌，写请求**连 body 都没有**。

    「改什么」不在这条线路上传：cogito 从审批台账里读出原文，签发令牌时就钉进 claims，写端点只按
    令牌办事。所以这里多传一个字段不是「冗余」，而是让 cogito 有机会去比对两处说法是否一致。
    """
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(
                200,
                json=token_body(scope=SCOPE_ASSET_WRITE, asset_id=ASSET, approval_id=APPROVAL),
            )
        return httpx.Response(
            200,
            json={"id": ASSET, "visibility": "RESTRICTED", "viewers": ["viewer-1"]},
        )

    client: CogitoClient = make_cogito(handler)

    landed = await client.asset_visibility_write(
        tenant_id=TENANT, approval_id=APPROVAL, asset_id=ASSET
    )

    assert landed == {"id": ASSET, "visibility": "RESTRICTED", "viewers": ["viewer-1"]}
    token_request, write_request = requests
    assert json.loads(token_request.content) == {
        "tenantID": TENANT,
        "scope": SCOPE_ASSET_WRITE,
        "assetID": ASSET,
        "approvalID": APPROVAL,
    }
    assert (write_request.method, write_request.url.path) == ("PUT", VISIBILITY_PATH)
    assert write_request.headers[SERVICE_TOKEN_HEADER] == f"tok-{SCOPE_ASSET_WRITE}"
    assert write_request.content == b""


@pytest.mark.parametrize("failing_path", [SERVICE_TOKEN_PATH, VISIBILITY_PATH])
async def test_an_invalid_approval_is_mapped_to_a_request_error(
    make_cogito: MakeCogito, failing_path: str
) -> None:
    """`403 + 500509` 是终局拒绝：换令牌和写这两条腿上都得翻成 400，不能按 503 报上去。

    503 会被 cogito 当成「暂时性故障」一遍遍重试同一个永远不会通过的写；400 才是让工具把
    `ok=false` 喂回模型、让它在对话里收手。
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH and failing_path != SERVICE_TOKEN_PATH:
            return httpx.Response(
                200,
                json=token_body(scope=SCOPE_ASSET_WRITE, asset_id=ASSET, approval_id=APPROVAL),
            )
        return cogito_error(403, code=APPROVAL_INVALID_CODE)

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.asset_visibility_write(tenant_id=TENANT, approval_id=APPROVAL, asset_id=ASSET)

    assert raised.value.status == 400
    assert raised.value.code is errors.ErrorCode.INVALID_REQUEST


@pytest.mark.parametrize(
    ("cogito_status", "cogito_code", "expected_status", "expected_code"),
    [
        # 403 但不是审批不合规：别的越权原因照样是暂时性/环境性故障，不能跟着一起判终局。
        (403, 500204, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        (401, 300002, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        # 资产不存在或看不见：再试一次也还是看不见。
        (404, 500204, 400, errors.ErrorCode.INVALID_REQUEST),
        (503, 500204, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
    ],
)
async def test_write_errors_are_mapped_by_retryability(
    make_cogito: MakeCogito,
    cogito_status: int,
    cogito_code: int,
    expected_status: int,
    expected_code: errors.ErrorCode,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            return httpx.Response(
                200,
                json=token_body(scope=SCOPE_ASSET_WRITE, asset_id=ASSET, approval_id=APPROVAL),
            )
        return cogito_error(cogito_status, code=cogito_code)

    client: CogitoClient = make_cogito(handler)

    with pytest.raises(errors.ApiError) as raised:
        await client.asset_visibility_write(tenant_id=TENANT, approval_id=APPROVAL, asset_id=ASSET)

    assert raised.value.status == expected_status
    assert raised.value.code is expected_code


# ── 代理 ────────────────────────────────────────────────────────────────────────
#
# 内网地址被系统代理接走时的症状最不好认：502、响应体为空、cogito 侧连一条访问记录都没有。
# 下面用两个最小 HTTP 桩把「请求到底发给了谁」变成可判定的事实：一个扮演行为可疑的本机代理
# （回 502 空响应），一个扮演 cogito（回令牌）。


async def _start_stub(status: str, body: bytes = b"") -> tuple[asyncio.Server, int, list[str]]:
    """只回一条固定响应的 HTTP 桩。第三个返回值是它收到的请求行，用来判断谁被访问了。"""
    hits: list[str] = []

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        hits.append((await reader.readline()).decode("latin-1").strip())
        length = 0
        while True:
            line = await reader.readline()
            if line in (b"\r\n", b""):
                break
            if line.lower().startswith(b"content-length:"):
                length = int(line.split(b":", 1)[1])
        if length:
            await reader.readexactly(length)
        head = f"HTTP/1.1 {status}\r\ncontent-length: {len(body)}\r\nconnection: close\r\n\r\n"
        writer.write(head.encode() + body)
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    sockets = server.sockets
    assert sockets is not None  # 监听成功就一定有套接字
    return server, int(sockets[0].getsockname()[1]), hits


async def _close_stubs(*servers: asyncio.Server) -> None:
    for server in servers:
        server.close()
    for server in servers:
        await server.wait_closed()


def _ambient_proxy(monkeypatch: pytest.MonkeyPatch, port: int) -> None:
    """把环境变量代理指向本机的桩；`NO_PROXY` 也要清掉，否则测试可能因为「代理被豁免」而变绿。"""
    monkeypatch.setenv("HTTP_PROXY", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{port}")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)


async def test_cogito_calls_ignore_an_ambient_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    """回打 cogito 一律直连：环境变量代理与 Windows 注册表里的系统代理都不该接管它。"""
    proxy, proxy_port, proxy_hits = await _start_stub("502 Bad Gateway")
    body = json.dumps(token_body(scope=SCOPE_EMBEDDINGS, model=MODEL)).encode()
    upstream, upstream_port, upstream_hits = await _start_stub("200 OK", body)
    _ambient_proxy(monkeypatch, proxy_port)

    client = CogitoClient(make_settings(cogito_base_url=f"http://127.0.0.1:{upstream_port}"))
    try:
        token = await client.service_token(tenant_id=TENANT, scope=SCOPE_EMBEDDINGS, model=MODEL)
    finally:
        await client.close()
        await _close_stubs(proxy, upstream)

    assert token.token == f"tok-{SCOPE_EMBEDDINGS}"
    assert proxy_hits == []  # 代理一次都没被访问
    assert len(upstream_hits) == 1  # cogito 那边确实收到了


async def test_system_proxy_is_used_only_when_the_switch_is_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """反向控制：开关打开时代理确实会接走请求。

    没有这一条，上面那条断言可能只是因为「代理从来没生效过」——那时测试是绿的，问题还在。
    """
    proxy, proxy_port, proxy_hits = await _start_stub("502 Bad Gateway")
    body = json.dumps(token_body(scope=SCOPE_EMBEDDINGS, model=MODEL)).encode()
    upstream, upstream_port, upstream_hits = await _start_stub("200 OK", body)
    _ambient_proxy(monkeypatch, proxy_port)

    client = CogitoClient(
        make_settings(
            cogito_base_url=f"http://127.0.0.1:{upstream_port}", cogito_use_system_proxy=True
        )
    )
    try:
        with pytest.raises(errors.ApiError) as raised:
            await client.service_token(tenant_id=TENANT, scope=SCOPE_EMBEDDINGS, model=MODEL)
    finally:
        await client.close()
        await _close_stubs(proxy, upstream)

    # 代理回的 502 是空响应体：这正是线上那次的原始症状。
    assert raised.value.code is errors.ErrorCode.DEPENDENCY_UNAVAILABLE
    assert "cogito 返回 502" in raised.value.message
    assert len(proxy_hits) == 1
    assert SERVICE_TOKEN_PATH in proxy_hits[0]
    assert upstream_hits == []
