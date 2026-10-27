"""路由面：把「契约里写了什么」和「这个进程真的暴露了什么」钉在一起。

这是唯一一条跨包的测试：它读 `apps/service/spec/internal.yaml`（契约唯一源）。值得这么做，
因为两侧最容易犯的错不是逻辑错，而是**路径或方法对不上**——那是静默的 404，
cogito 只会看到一次莫名的失败重试。

规则：**已登记的能力必须真的有路由**（否则测试红），且**不许有契约之外的路由**
（否则就是绕过契约开了个后门）。所以 P6b-3/P6b-4 登记能力时，这里会自动跟着收紧。

`rag.search` 也有一条端点：它同时服务两个消费者 —— 服务端 agent 步在进程内直调，
客户端知识库经 cogito 转进来，所以静态路径也算它的路由。
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from starlette.routing import BaseRoute, Route

from compute import capabilities
from compute.api.health import HEALTH_PATH

SPEC_PATH = Path(__file__).resolve().parents[2] / "service" / "spec" / "internal.yaml"

#: 骨架自己就有的路由（不属于任何可选能力）。
BASELINE_ROUTES = {("GET", HEALTH_PATH)}

#: 能力名 → 该能力落地时必须存在的路由。与 `capabilities.registry` 的取值一一对应。
#: 一个能力可以有不止一条路径：`agent.step` 同时收单步推理与审批通过后的工具执行。
CAPABILITY_ROUTES: dict[str, set[tuple[str, str]]] = {
    "rag.chunk": {("POST", "/internal/v1/assets/{}/chunks")},
    "rag.embed": {("POST", "/internal/v1/assets/{}/embeddings")},
    "rag.index": {("PUT", "/internal/v1/assets/{}/index")},
    "rag.search": {("POST", "/internal/v1/rag/search")},
    "agent.step": {
        ("POST", "/internal/v1/agents/steps"),
        ("POST", "/internal/v1/agents/tool-executions"),
        ("POST", "/internal/v1/agents/tool-invocations"),
    },
    "agent.memory": {("POST", "/internal/v1/agents/memories")},
}

_PATH_PARAM = re.compile(r"\{[^}]*\}")
_IGNORED_METHODS = {"HEAD", "OPTIONS"}


def normalize(path: str) -> str:
    """参数名两侧写法不同（`{assetID}` vs `{asset_id}`），比较前统一成一个占位符。"""
    return _PATH_PARAM.sub("{}", path)


def contract_routes() -> set[tuple[str, str]]:
    spec = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
    return {
        (method.upper(), normalize(path))
        for path, operations in spec["paths"].items()
        for method in operations
    }


def app_routes(app: FastAPI) -> set[tuple[str, str]]:
    return {
        (method, normalize(route.path))
        for route in iter_routes(app.routes)
        if isinstance(route, Route) and route.methods
        for method in route.methods
        if method not in _IGNORED_METHODS
    }


def iter_routes(routes: Iterable[BaseRoute]) -> Iterator[BaseRoute]:
    """展开 `include_router` 的结果。

    Starlette 1.x 不再把被包含的路由平铺进 `app.routes`，而是塞一个包装节点，
    真实路由挂在它的 `original_router` 上（更老的版本没有这层包装，所以是鸭子类型判断）。
    """
    for route in routes:
        included = getattr(route, "original_router", None)
        if included is None:
            yield route
        else:
            yield from iter_routes(included.routes)


@pytest.fixture(autouse=True)
def _require_contract() -> None:
    if not SPEC_PATH.is_file():
        pytest.skip(f"找不到契约文件（只做局部检出时会跳过）：{SPEC_PATH}")


def test_route_matching_normalizes_path_parameters() -> None:
    assert normalize("/internal/v1/assets/{assetID}/chunks") == "/internal/v1/assets/{}/chunks"
    assert normalize("/internal/v1/assets/{asset_id}/chunks") == "/internal/v1/assets/{}/chunks"


def test_exposed_routes_are_all_in_the_contract(bare_app: FastAPI) -> None:
    extra = app_routes(bare_app) - contract_routes()

    assert extra == set(), f"暴露了契约之外的端点：{sorted(extra)}"


def test_registered_capabilities_have_their_routes(bare_app: FastAPI) -> None:
    expected = set(BASELINE_ROUTES)
    for name in capabilities.registry.names():
        assert name in CAPABILITY_ROUTES, f"能力 {name!r} 没有登记对应的路由映射"
        expected |= CAPABILITY_ROUTES[name]

    assert app_routes(bare_app) == expected


def test_every_contract_path_is_accounted_for() -> None:
    """契约新增路径时这条会红：提醒去 `CAPABILITY_ROUTES` 里认领它。"""
    known = set(BASELINE_ROUTES) | set().union(*CAPABILITY_ROUTES.values())

    assert contract_routes() == known


def test_capability_route_mapping_matches_registry_vocabulary() -> None:
    """能力名的拼写必须两边一致——它出现在健康探针的响应里，是契约的一部分。"""
    documented = {"rag.chunk", "rag.embed", "rag.index", "rag.search", "agent.step", "agent.memory"}

    assert set(CAPABILITY_ROUTES) == documented
    assert set(capabilities.registry.names()) <= documented
