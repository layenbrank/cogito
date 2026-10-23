"""`/internal/v1/assets/{assetID}/*` 三个端点的请求/响应模型。

字段名直接抄契约 `spec/internal.yaml`（camelCase，别名而不是 `alias_generator`：
契约里是 `tenantID` / `chunkSetID`，通用的驼峰转换会生成 `tenantId`，对不上）。

`extra="forbid"` 是刻意的：cogito 与这里的契约是一对一编译期生成的，多出来的字段只可能是
**版本不一致**，静默忽略会让这种不一致一直藏到线上。未知字段 → 400。
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

_CONTRACT = ConfigDict(extra="forbid", populate_by_name=True)


class ChunkRequest(BaseModel):
    """契约 `ChunkRequest`。`chunkSize`/`chunkOverlap` 缺省时用服务端默认值。"""

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tenant_id: str = Field(alias="tenantID", min_length=1)
    mime: str = Field(min_length=1)
    name: str | None = None
    chunk_size: int | None = Field(default=None, alias="chunkSize", ge=1)
    chunk_overlap: int | None = Field(default=None, alias="chunkOverlap", ge=0)


class ChunkResponse(BaseModel):
    """契约 `ChunkResponse`。`textSha` 是可选的，这里总是带上以便审计。"""

    model_config = _CONTRACT

    chunk_set_id: UUID = Field(alias="chunkSetID", serialization_alias="chunkSetID")
    chunk_count: int = Field(alias="chunkCount", serialization_alias="chunkCount", ge=0)
    text_sha: str | None = Field(default=None, alias="textSha", serialization_alias="textSha")

    @classmethod
    def from_parts(cls, *, chunk_set_id: UUID, chunk_count: int, text_sha: str) -> ChunkResponse:
        """按**属性名**构造。

        不直接用关键字构造是因为 pydantic 的 mypy 插件按**别名**校验构造参数
        （`ChunkResponse(chunkSetID=...)` 才是它眼里的合法写法），这里绕开这个偏差。
        """
        return cls.model_validate(
            {"chunk_set_id": chunk_set_id, "chunk_count": chunk_count, "text_sha": text_sha}
        )

    def wire(self) -> dict[str, object]:
        """按契约字段名导出（字段上的 `serialization_alias` 就是契约名）。

        `mode="json"` 不是可选项：`chunk_set_id` 是 UUID 对象，`JSONResponse` 用的是
        不带 `default=` 的 `json.dumps`，直接送进去会在渲染响应时炸成 500。
        """
        return self.model_dump(by_alias=True, mode="json")


class EmbedRequest(BaseModel):
    """契约 `EmbedRequest`：请为块集的 `[from, to)` 区间算向量。

    `from` / `to` 是 Python 关键字，属性名只能是 `start` / `end`；别名保持契约原样，
    所以请求体依旧是 `{"from": 0, "to": 16}`。
    """

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tenant_id: str = Field(alias="tenantID", min_length=1)
    chunk_set_id: UUID = Field(alias="chunkSetID")
    model: str = Field(min_length=1)
    start: int = Field(alias="from", ge=0)
    end: int = Field(alias="to", ge=0)

    @model_validator(mode="after")
    def _require_forward_range(self) -> EmbedRequest:
        """空区间没有任何意义（cogito 的分批循环也不会发出空区间），判为请求问题。"""
        if self.end <= self.start:
            raise ValueError(f"to 必须大于 from，当前是 [{self.start}, {self.end})")
        return self


class EmbedResponse(BaseModel):
    """契约 `EmbedResponse`：`embedded` 是**本次实际写入**的向量数（幂等命中时为 0）。"""

    model_config = _CONTRACT

    start: int = Field(alias="from", serialization_alias="from", ge=0)
    end: int = Field(alias="to", serialization_alias="to", ge=0)
    embedded: int = Field(ge=0)
    dimensions: int = Field(ge=0)

    @classmethod
    def from_parts(cls, *, start: int, end: int, embedded: int, dimensions: int) -> EmbedResponse:
        """按**属性名**构造（同 `ChunkResponse.from_parts`：绕开 mypy 插件按别名校验的偏差）。"""
        return cls.model_validate(
            {"start": start, "end": end, "embedded": embedded, "dimensions": dimensions}
        )

    def wire(self) -> dict[str, object]:
        return self.model_dump(by_alias=True, mode="json")


class IndexRequest(BaseModel):
    """契约 `IndexRequest`：把块集的当前版本物化进检索索引。

    `dimensions` **允许 0**：空块集（空文件、纯图片 PDF）同样要走这一步把旧版本替换掉，
    此时 cogito 压根没跑嵌入循环，传下来的就是 0。
    """

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tenant_id: str = Field(alias="tenantID", min_length=1)
    chunk_set_id: UUID = Field(alias="chunkSetID")
    chunk_count: int = Field(alias="chunkCount", ge=0)
    model: str = Field(min_length=1)
    dimensions: int = Field(ge=0)


class IndexResponse(BaseModel):
    """契约 `IndexResponse`：`indexed` 是索引里的块数（幂等命中时返回首次结果，不叠加）。"""

    model_config = _CONTRACT

    indexed: int = Field(ge=0)
    collection: str = Field(min_length=1)

    @classmethod
    def from_parts(cls, *, indexed: int, collection: str) -> IndexResponse:
        return cls.model_validate({"indexed": indexed, "collection": collection})

    def wire(self) -> dict[str, object]:
        return self.model_dump(by_alias=True, mode="json")
