"""健康探针：契约里唯一不需要令牌的端点，也是 cogito 决定「还要不要派人过来」的依据。"""

from __future__ import annotations

from httpx import AsyncClient

from compute import __version__, capabilities
from compute.api.health import HEALTH_PATH


async def test_health_needs_no_credentials(client: AsyncClient) -> None:
    response = await client.get(HEALTH_PATH)  # 不带令牌、不带 traceparent

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_health_body_is_exactly_the_contract_shape(client: AsyncClient) -> None:
    body = (await client.get(HEALTH_PATH)).json()

    assert set(body) == {"status", "version", "capabilities"}
    assert body["version"] == __version__


async def test_health_reports_degraded_when_database_is_unreachable(
    offline_client: AsyncClient,
) -> None:
    response = await offline_client.get(HEALTH_PATH)

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


async def test_health_capabilities_reflect_registry(client: AsyncClient) -> None:
    body = (await client.get(HEALTH_PATH)).json()

    assert body["capabilities"] == capabilities.registry.names()
