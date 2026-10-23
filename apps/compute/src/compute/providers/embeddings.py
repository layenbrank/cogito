"""把一批文本变成向量：分批调用 + 解析 cogito 转发的上游响应（P6b-4）。

上游响应是 **OpenAI 形状**，cogito 原样转发、不套统一信封：

```json
{"data": [{"object": "embedding", "index": 0, "embedding": [0.1, -0.2, ...]}, ...]}
```

这里只做三件事：**校验形状**、**按 `index` 还原顺序**、**分批**。形状不对一律按 503（可重试）
上报：上游半截返回（网关截断、模型侧限流）时，把算出来的一半向量写进库、让 cogito 把整个
资产判成永久失败，代价远大于重试一次。
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from compute import errors
from compute.cogito_client import CogitoClient


@dataclass(frozen=True, slots=True)
class VectorBatch:
    """一批向量：`vectors[i]` 对应输入的第 i 条文本。"""

    vectors: list[list[float]]
    dimensions: int


def parse_embeddings(payload: object, *, expected: int) -> VectorBatch:
    """把上游响应解析成向量列表，顺序按 `index` 还原（上游**不保证**按序返回）。"""
    if not isinstance(payload, dict):
        raise _malformed("响应不是 JSON 对象")
    data = payload.get("data")
    if not isinstance(data, list):
        raise _malformed("响应缺少 data 数组")

    if len(data) != expected:
        raise _malformed(f"data 有 {len(data)} 条，期望 {expected} 条")

    ordered: list[list[float] | None] = [None] * expected
    dimensions: int | None = None
    for item in data:
        if not isinstance(item, dict):
            raise _malformed("data 的元素不是对象")
        index = item.get("index")
        if not isinstance(index, int) or isinstance(index, bool):
            raise _malformed("data[].index 不是整数")
        if not 0 <= index < expected:
            raise _malformed(f"data[].index={index} 越界（期望 0–{expected - 1}）")
        if ordered[index] is not None:
            raise _malformed(f"data[].index={index} 重复")

        vector = _vector(item.get("embedding"))
        if dimensions is None:
            dimensions = len(vector)
        elif len(vector) != dimensions:
            raise _malformed(f"同一批向量的维度不一致（{dimensions} 与 {len(vector)}）")
        ordered[index] = vector

    if dimensions is None:
        raise _malformed("data 为空")

    vectors: list[list[float]] = []
    for position in range(expected):
        found = ordered[position]
        if found is None:
            raise _malformed(f"data 缺少 index={position} 的向量")
        vectors.append(found)
    return VectorBatch(vectors=vectors, dimensions=dimensions)


def _vector(raw: object) -> list[float]:
    if not isinstance(raw, list) or not raw:
        raise _malformed("data[].embedding 不是非空数组")

    vector: list[float] = []
    for value in raw:
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise _malformed("data[].embedding 含非数值元素")
        number = float(value)
        # NaN / Inf 会污染整列（余弦相似度全变成 NaN），在这里拦住比检索时才发现好。
        if not math.isfinite(number):
            raise _malformed("data[].embedding 含 NaN 或 Inf")
        vector.append(number)
    return vector


def _malformed(reason: str) -> errors.ApiError:
    return errors.dependency_unavailable(f"嵌入响应形状不合法：{reason}")


async def embed_texts(
    cogito: CogitoClient,
    *,
    tenant_id: str,
    model: str,
    texts: Sequence[str],
    batch_size: int,
) -> VectorBatch:
    """按 `batch_size` 分批算向量，返回顺序与 `texts` 一致的一批结果。"""
    if not texts:
        return VectorBatch(vectors=[], dimensions=0)

    vectors: list[list[float]] = []
    dimensions: int | None = None
    for start in range(0, len(texts), batch_size):
        window = list(texts[start : start + batch_size])
        payload = await cogito.embeddings(tenant_id=tenant_id, model=model, inputs=window)
        batch = parse_embeddings(payload, expected=len(window))
        if dimensions is None:
            dimensions = batch.dimensions
        elif dimensions != batch.dimensions:
            # 同一个模型在同一批文本上给出两种维度，只可能是上游换了模型/灰度切流，
            # 拼出来的向量列不能混用，重试也一样。
            raise _malformed(f"同一模型的维度前后不一致（{dimensions} 与 {batch.dimensions}）")
        vectors.extend(batch.vectors)

    return VectorBatch(vectors=vectors, dimensions=dimensions or 0)
