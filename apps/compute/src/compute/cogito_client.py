"""回打 cogito 的客户端：换服务令牌 + 读资产正文 + 借 cogito 的网关算嵌入与对话 + 按审批写可见性。

compute 是叶子进程：不直连模型厂商、不碰 cogito 的对象存储布局、不持长期云凭据。
要算力、要字节，或要改 cogito 里的一份元数据，只能回打 cogito 的服务身份面（语义见
`apps/service/src/services/gateway/README.md#服务身份apiv1service`）。两道门：

1. `POST /api/v1/service/token`，头 `X-Internal-Token`（值 = cogito 的 `compute.token`）
   → 换一枚**带作用域**的短期令牌（`scope=asset-read` + `assetID`、
   `scope=embeddings` + `model`、`scope=chat` + `model`，或 `scope=asset-write` +
   `assetID` + `approvalID`）；
2. 拿这枚令牌去消费：内容端点用 `X-Service-Token`，嵌入端点是
   `POST /api/v1/service/embeddings`，对话端点是
   `POST /api/v1/service/chat/completions`（两者的响应都是上游的**裸 JSON**，不套统一信封），
   写端点是 `PUT /api/v1/service/assets/{id}/visibility`（**没有请求体**：改什么在换令牌
   那一步就定死了，见 `asset_visibility_write`）。

令牌**必须缓存**：cogito 的配额与审计都记在出网调用上，但换令牌本身不便宜
（要查租户、查资产可读性、查审批），按 `(scope, tenantID, assetID, model, approvalID)`
缓存并在过期前 `refresh_skew_seconds` 续签。

错误映射的口径是「cogito 能不能重试」：4xx（请求本身不对）原样变成 400，让 cogito 别浪费重试；
401/403 说明**我们自己**配错或写错（密钥不对 / 受众用错），记 `error` 日志并按 503 上报；
429 原样透出限流；其余网络与 5xx 都是暂时的 503。唯一的例外是审批不合规
（403 + `approval_invalid`）：那是一次**终局拒绝**而不是配置错误，翻成 400 让工具回 `ok=false`。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, NoReturn

import httpx

from compute import errors, telemetry, trace
from compute.config import Settings

logger = logging.getLogger(__name__)

INTERNAL_TOKEN_HEADER = "X-Internal-Token"  # noqa: S105 - HTTP 头名，不是密钥
SERVICE_TOKEN_HEADER = "X-Service-Token"  # noqa: S105 - HTTP 头名，不是密钥

SERVICE_TOKEN_PATH = "/api/v1/service/token"  # noqa: S105 - 路径常量，不是密钥
ASSET_CONTENT_PATH = "/api/v1/service/assets/{asset_id}/content"
ASSET_VISIBILITY_PATH = "/api/v1/service/assets/{asset_id}/visibility"
EMBEDDINGS_PATH = "/api/v1/service/embeddings"
CHAT_PATH = "/api/v1/service/chat/completions"

SCOPE_ASSET_READ = "asset-read"
SCOPE_EMBEDDINGS = "embeddings"
SCOPE_CHAT = "chat"
SCOPE_ASSET_WRITE = "asset-write"

#: cogito 在「审批凭据不合规」时回的稳定错误码（HTTP 403）。命中它说明这次调用是**终局失败**：
#: 审批过期了、被驳回了、批的不是这个资产……它不是我们配错了，也不是 cogito 暂时不可用，
#: 所以不能按 503 报上去让 cogito 重试整步（见 `_raise_for_status`）。
APPROVAL_INVALID_CODE = 500509

_READ_CHUNK_BYTES = 64 * 1024


@dataclass(frozen=True, slots=True)
class ServiceToken:
    """cogito 签发的短期令牌（裸结构，`expiresAt` 是 Unix 秒）。"""

    token: str
    expires_at: int
    tenant_id: str
    scope: str
    token_type: str
    model: str | None = None
    asset_id: str | None = None
    #: 写令牌的凭据来源（审批号）。读令牌没有这个字段，cogito 也不回它。
    approval_id: str | None = None

    def expires_at_datetime(self) -> datetime:
        return datetime.fromtimestamp(self.expires_at, tz=UTC)


@dataclass(frozen=True, slots=True)
class AssetContent:
    """资产正文与它自报的类型。

    `mime` 取自响应头（cogito 的内容端点用 `asset.mime` 当 `Content-Type`），
    **不能**用请求里带的那个值顶替：读一个「调用方以为是 text/plain」的 PDF 时，
    选错抽取器会得到一堆乱码而不是一个明确的 400。带 `; charset=` 也照收，
    `rag_ingest.extract` 自己会归一化。
    """

    data: bytes
    mime: str


class CogitoClient:
    """cogito 服务身份面的薄封装。一个进程一份，随 app 生命周期关闭。"""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = settings
        # 内部端点直连：httpx 判定 `allow_env_proxies = trust_env and transport is None`，所以显式
        # 给一个 transport 就等于关掉「环境变量 + Windows 注册表」里的代理，同时保住 `trust_env`
        # 带来的 `SSL_CERT_FILE` / `SSL_CERT_DIR`（用 `trust_env=False` 会连证书路径一起丢）。
        if transport is None and not settings.cogito_use_system_proxy:
            transport = httpx.AsyncHTTPTransport()
        self._client = httpx.AsyncClient(
            base_url=settings.cogito_base_url,
            timeout=httpx.Timeout(settings.cogito_timeout_seconds),
            transport=transport,
        )
        self._tokens: dict[tuple[str, str, str, str, str], ServiceToken] = {}
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        await self._client.aclose()

    async def asset_content(self, *, tenant_id: str, asset_id: str, max_bytes: int) -> AssetContent:
        """取资产原始字节与它的 MIME。超限直接判为请求问题（不重试），因为重试也只会再超一次。"""
        token = await self.service_token(
            tenant_id=tenant_id, scope=SCOPE_ASSET_READ, asset_id=asset_id
        )
        path = ASSET_CONTENT_PATH.format(asset_id=asset_id)
        headers = self._headers(service_token=token)

        async with (
            telemetry.outbound_span("GET", path, headers),
            self._client.stream("GET", path, headers=headers) as response,
        ):
            if response.status_code >= 400:
                await self._raise_for_status(response, action=f"读取资产 {asset_id} 内容")
            mime = response.headers.get("content-type", "")
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes(_READ_CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    message = (
                        f"资产正文超过 {max_bytes} 字节上限，请先在 cogito 侧裁剪或降低上限配置"
                    )
                    raise errors.invalid_request(message)
                chunks.append(chunk)

        return AssetContent(data=b"".join(chunks), mime=mime)

    async def embeddings(self, *, tenant_id: str, model: str, inputs: Sequence[str]) -> Any:
        """算一批文本的嵌入，返回上游的**裸 JSON**（OpenAI 形状，`data[].embedding`）。

        两个刻意的取舍：

        - `model` 只是**自检**：cogito 一律用令牌作用域里的模型覆盖请求体里的 `model`，
          传错了会在 cogito 侧 400，而不是悄悄换成另一个模型；
        - 不传 `dimensions`：不少模型不认这个参数（传了就 400），维度差距按响应里向量的
          实际长度读，比「向 cogito 要一个数字」更可信。

        形状校验交给 `compute.providers.embeddings`，这里只负责传输与错误映射。
        """
        token = await self.service_token(tenant_id=tenant_id, scope=SCOPE_EMBEDDINGS, model=model)
        response = await self._request(
            "POST",
            EMBEDDINGS_PATH,
            json={"model": model, "input": list(inputs)},
            headers=self._headers(service_token=token),
            action=f"计算 {len(inputs)} 条文本的嵌入",
        )
        return response.json()

    async def chat(
        self,
        *,
        tenant_id: str,
        model: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]] | None = None,
    ) -> Any:
        """借 cogito 的网关调一次对话模型，返回上游的**裸 JSON**（OpenAI 形状）。

        `messages` / `tools` 都按 OpenAI 线格式**原样透传**：cogito 的网关不做语义改写
        （它只做受众校验、非流式强制与计量），所以这里能收到的 `choices[0].message`
        与厂商给的形状一致，工具调用轮次的形状校验交给
        `compute.agent_runtime.dialogue`。

        `model` 与 `embeddings` 一样只是**自检**：cogito 用令牌作用域里的模型覆盖请求体，
        传错了会在 cogito 侧 400，而不是悄悄换成另一个模型。
        """
        token = await self.service_token(tenant_id=tenant_id, scope=SCOPE_CHAT, model=model)
        payload: dict[str, object] = {"model": model, "messages": list(messages)}
        if tools:
            payload["tools"] = list(tools)
        response = await self._request(
            "POST",
            CHAT_PATH,
            json=payload,
            headers=self._headers(service_token=token),
            action="执行一步对话模型调用",
        )
        return response.json()

    async def asset_visibility_write(
        self, *, tenant_id: str, approval_id: str, asset_id: str
    ) -> Any:
        """按一次人工批准改写资产的可见性，返回 cogito 落地后的资产**裸 JSON**。

        这是审批通道的最后一跳：拿审批号换一枚只能写**这一个**资产的短期写令牌，再用它调
        写端点。可见性与可见名单**不在这两个请求里传**——它们在换令牌时由 cogito 从审批台账里
        读出来钉进令牌，写端点连请求体都不收（`json=None` 就是不带 body）。所以哪怕调用方
        临时改了主意，写下去的仍然是批准时的那一份。

        返回的 `visibility` / `viewers` 是**落地值**，调用方应当照它描述结果，而不是照自己
        请求时说的那份。
        """
        token = await self.service_token(
            tenant_id=tenant_id,
            scope=SCOPE_ASSET_WRITE,
            asset_id=asset_id,
            approval_id=approval_id,
        )
        response = await self._request(
            "PUT",
            ASSET_VISIBILITY_PATH.format(asset_id=asset_id),
            headers=self._headers(service_token=token),
            action=f"按审批改写资产 {asset_id} 的可见性",
        )
        return response.json()

    async def service_token(
        self,
        *,
        tenant_id: str,
        scope: str,
        asset_id: str | None = None,
        model: str | None = None,
        approval_id: str | None = None,
    ) -> ServiceToken:
        """取（必要时换）一枚短期令牌。

        `approval_id` 只对写作用域有意义，且**必须进缓存键**：写令牌是「一张单子一份能力」，
        两次不同审批换来的令牌不能互相顶替。
        """
        cache_key = (scope, tenant_id, asset_id or "", model or "", approval_id or "")
        cached = self._tokens.get(cache_key)
        if cached is not None and not self._is_stale(cached):
            return cached

        async with self._lock:
            cached = self._tokens.get(cache_key)
            if cached is not None and not self._is_stale(cached):
                return cached
            token = await self._mint_token(
                tenant_id=tenant_id,
                scope=scope,
                asset_id=asset_id,
                model=model,
                approval_id=approval_id,
            )
            self._tokens[cache_key] = token
            return token

    async def _mint_token(
        self,
        *,
        tenant_id: str,
        scope: str,
        asset_id: str | None,
        model: str | None,
        approval_id: str | None,
    ) -> ServiceToken:
        payload: dict[str, object] = {"tenantID": tenant_id, "scope": scope}
        if asset_id is not None:
            payload["assetID"] = asset_id
        if model is not None:
            payload["model"] = model
        if approval_id is not None:
            payload["approvalID"] = approval_id
        if self._settings.cogito_service_token_ttl_seconds is not None:
            payload["ttlSecs"] = self._settings.cogito_service_token_ttl_seconds

        response = await self._request(
            "POST",
            SERVICE_TOKEN_PATH,
            json=payload,
            headers=self._headers(internal_token=True),
            action="换取服务身份令牌",
        )
        data = response.json()
        return ServiceToken(
            token=data["token"],
            expires_at=int(data["expiresAt"]),
            tenant_id=data["tenantID"],
            scope=data["scope"],
            token_type=data["tokenType"],
            model=data.get("model"),
            asset_id=data.get("assetID"),
            approval_id=data.get("approvalID"),
        )

    def _is_stale(self, token: ServiceToken) -> bool:
        remaining = (token.expires_at_datetime() - datetime.now(UTC)).total_seconds()
        return remaining <= self._settings.cogito_token_refresh_skew_seconds

    def _headers(
        self, *, internal_token: bool = False, service_token: ServiceToken | None = None
    ) -> dict[str, str]:
        headers = {"accept": "application/json"}
        if internal_token:
            headers[INTERNAL_TOKEN_HEADER] = self._settings.internal_token
        if service_token is not None:
            headers[SERVICE_TOKEN_HEADER] = service_token.token
        # 把本进程的 trace-id 续下去：cogito 的日志与这里的日志能按同一条链路对上。
        context = trace.current()
        if context is not None:
            headers[trace.TRACEPARENT_HEADER] = trace.child_of(context).raw
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: object | None = None,
        headers: dict[str, str],
        action: str,
    ) -> httpx.Response:
        try:
            async with telemetry.outbound_span(method, path, headers):
                response = await self._client.request(method, path, json=json, headers=headers)
        except httpx.HTTPError as exc:
            logger.warning("%s失败（网络层）：%s", action, exc)
            raise errors.dependency_unavailable(f"{action}失败：cogito 不可达") from exc

        if response.status_code >= 400:
            await self._raise_for_status(response, action=action)
        return response

    async def _raise_for_status(self, response: httpx.Response, *, action: str) -> NoReturn:
        status = response.status_code
        # 流式响应此时正文还没读进内存；错误体很小，读出来才能看到 cogito 说的原因。
        await response.aread()
        detail = _error_detail(response)
        message = f"{action}失败：cogito 返回 {status}（{detail}）"

        if status == 403 and _error_code(response) == APPROVAL_INVALID_CODE:
            # 审批不合规是**这一次调用的终局**（过期、被驳回、批的不是这个资产……）：
            # 既不是我们配错了，也不是 cogito 暂时不可用。按 503 上报会让 cogito 重试整步，
            # 而重试一百次也是同一个 403。翻成 400 让工具回 `ok=false`，模型据此收手。
            logger.info("%s被审批拒绝：%s", action, message)
            raise errors.invalid_request(message)
        if status in (401, 403):
            # 只可能是我们自己配错/用错（内部令牌不符、受众用错），重试没有意义，必须有人看日志。
            logger.error("%s（疑似配置或作用域错误，非暂时性）：%s", action, message)
            raise errors.dependency_unavailable(message)
        if status == 429:
            raise errors.rate_limited(message, retry_after_seconds=_retry_after(response))
        if status >= 500:
            logger.warning("%s（cogito 侧故障）：%s", action, message)
            raise errors.dependency_unavailable(message)
        raise errors.invalid_request(message)


def _error_code(response: httpx.Response) -> Any:
    """cogito 错误信封里的机器码。读不出形状就给 `None`（那样只按状态码分类）。"""
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get("code") if isinstance(body, dict) else None


def _error_detail(response: httpx.Response) -> str:
    """cogito 的错误信封是 `{code, success, msg, timestamp}`，只取 `code` 与 `msg`。"""
    try:
        body = response.json()
    except ValueError:
        return "响应体不是 JSON"
    if not isinstance(body, dict):
        return "响应体形状不可识别"
    code = body.get("code")
    msg = body.get("msg")
    return f"code={code}, msg={msg}"


def _retry_after(response: httpx.Response) -> int | None:
    raw = response.headers.get("Retry-After")
    if raw is None:
        return None
    try:
        return max(0, int(raw))
    except ValueError:
        return None
