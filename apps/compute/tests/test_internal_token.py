"""内部令牌闸门：服务面唯一的身份检查（健康探针除外）。

两条容易被写错的边界：健康路径必须豁免；令牌错与 traceparent 错要能区分开
——401 在外层先发生，调用方看到的是「身份不对」而不是「头不合法」。
"""

from __future__ import annotations

from httpx import AsyncClient, Response

from compute import errors
from compute.api.health import HEALTH_PATH
from compute.cogito_client import INTERNAL_TOKEN_HEADER
from support import INTERNAL_TOKEN, TRACEPARENT, internal_headers, traceparent_only

PING = "/internal/v1/_test/ping"


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


async def test_missing_token_is_rejected(offline_client: AsyncClient) -> None:
    response = await offline_client.get(PING, headers=traceparent_only())

    assert response.status_code == 401
    assert error_code(response) == errors.ErrorCode.UNAUTHORIZED


async def test_token_with_right_length_but_wrong_value_is_rejected(
    offline_client: AsyncClient,
) -> None:
    headers = {INTERNAL_TOKEN_HEADER: "x" * len(INTERNAL_TOKEN), "traceparent": TRACEPARENT}

    response = await offline_client.get(PING, headers=headers)

    assert response.status_code == 401


async def test_valid_token_passes_the_gate(offline_client: AsyncClient) -> None:
    response = await offline_client.get(PING, headers=internal_headers())

    assert response.status_code == 200
    assert response.json() == {"pong": True}


async def test_token_is_checked_before_traceparent(offline_client: AsyncClient) -> None:
    """两边都错的请求要回 401：不能让人靠试探 traceparent 反推内部规则。"""
    response = await offline_client.get(
        PING, headers={INTERNAL_TOKEN_HEADER: "wrong", "traceparent": "garbage"}
    )

    assert response.status_code == 401


async def test_health_is_exempt_from_the_token(offline_client: AsyncClient) -> None:
    response = await offline_client.get(HEALTH_PATH)

    assert response.status_code != 401


async def test_health_ignores_a_wrong_token(offline_client: AsyncClient) -> None:
    """探针不带身份也要能跑，带了错的身份也不能被拦住。"""
    response = await offline_client.get(HEALTH_PATH, headers={INTERNAL_TOKEN_HEADER: "wrong"})

    assert response.status_code != 401
