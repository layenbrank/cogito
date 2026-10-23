"""切块：把抽取后的纯文本切成检索用的块。

**纯函数，确定性**：同样的文本 + 同样的参数永远得到同样的块（含 `char_start`/`char_end`）。
幂等重放要靠它——cogito 会在超时后原样重发同一个步骤，两次切分必须给出一模一样的结果，
否则「重放」出来的块集在检索侧看起来就是另一个版本。

策略是「按段落贪婪装箱」而不是「每 N 个字符硬切」：

1. 尽量让块收在**段落边界**上（空行）；段落太长就退而求其次收在句子边界，再不行收在
   空白/标点边界。硬切是最后一招，不是默认行为——从半个句子中间切开，检索命中时看到的是
   一段没有主语的正文。
2. 为了收在自然边界上，允许块**略超**目标大小（最多 `+1/3`），但只在结果至少装到一半时
   才这么做；否则宁可硬切，免得短文本被撑成巨块。
3. 相邻块之间留 `chunk_overlap` 个字符的重叠（取上一块的尾部、起点对齐到自然边界），
   这是为了「答案刚好跨在块边界上」时不至于完全丢失上下文。

`char_start`/`char_end` 指向**归一化后的文本**（见
[`compute.rag_ingest.extract.normalize_text`]），不是原始字节偏移。正文会重叠，所以区间
也重叠；它们的用途是将来把检索命中的块映射回原文位置。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from compute import errors

logger = logging.getLogger(__name__)

#: 单块上限，防止调用方给一个「一块装整本书」的值把内存与嵌入请求顶穿。
#: 部署级的默认值在 `config.Settings`（`default_chunk_size` / `default_chunk_overlap`）里，
#: 这里只回答「什么样的参数组合是不合法的」。
MAX_CHUNK_SIZE = 32_000
#: 对齐起点的搜索窗口（字符）：重叠本来就只有几百字符，跑太远等于不重叠。
_ALIGN_WINDOW = 200

#: 边界按「语义强度」从强到弱；切块时依次尝试，前一个找得到就不再退。
_BOUNDARIES: tuple[re.Pattern[str], ...] = (
    re.compile(r"\n{2,}"),
    re.compile(r"(?<=[。！？!?；;])\s*|(?<=\.)\s+|\n"),
    re.compile(r"\s|(?<=[，,、：:)）】」》])"),
)


@dataclass(frozen=True, slots=True)
class Chunk:
    """一块。`ordinal` 从 0 开始，`char_end` 不含。"""

    ordinal: int
    text: str
    char_start: int
    char_end: int


@dataclass(frozen=True, slots=True)
class ChunkPlan:
    """一次切分的全部产物。参数是**实际生效**的值（缺省已解析）。"""

    chunks: tuple[Chunk, ...]
    chunk_size: int
    chunk_overlap: int


def validate_params(*, chunk_size: int, chunk_overlap: int) -> None:
    """校验生效后的分块参数。契约只给了单字段下界，跨字段的约束在这里补齐。"""
    if not 1 <= chunk_size <= MAX_CHUNK_SIZE:
        message = f"chunkSize 必须在 1–{MAX_CHUNK_SIZE} 之间，当前是 {chunk_size}"
        raise errors.invalid_request(message)
    if not 0 <= chunk_overlap < chunk_size:
        message = (
            f"chunkOverlap 必须在 0–{chunk_size - 1} 之间（必须小于 chunkSize），"
            f"当前是 {chunk_overlap}"
        )
        raise errors.invalid_request(message)


def split(text: str, *, chunk_size: int, chunk_overlap: int) -> ChunkPlan:
    """切分 `text`（应是归一化后的文本）。块数为 0 是正常结果（空文本）。"""
    chunks: list[Chunk] = []
    for start, end in _spans(text, chunk_size=chunk_size, chunk_overlap=chunk_overlap):
        raw = text[start:end]
        body = raw.strip()
        if not body:
            continue
        # strip 之后正文缩进去了，区间要跟着缩进，否则 `text[char_start:char_end] != text`。
        lead = len(raw) - len(raw.lstrip())
        trail = len(raw) - len(raw.rstrip())
        chunks.append(
            Chunk(
                ordinal=len(chunks),
                text=body,
                char_start=start + lead,
                char_end=end - trail,
            )
        )
    return ChunkPlan(chunks=tuple(chunks), chunk_size=chunk_size, chunk_overlap=chunk_overlap)


def _spans(text: str, *, chunk_size: int, chunk_overlap: int) -> list[tuple[int, int]]:
    """给出每块的 `[start, end)`，严格前进，绝不空转。"""
    if not text:
        return []

    spans: list[tuple[int, int]] = []
    start = 0
    while True:
        end = _fit(text, start, chunk_size)
        spans.append((start, end))
        if end >= len(text):
            return spans
        start = _advance(text, prev_start=start, end=end, chunk_overlap=chunk_overlap)


def _advance(text: str, *, prev_start: int, end: int, chunk_overlap: int) -> int:
    """下一块的起点：从 `end` 往回退 `chunk_overlap`，再对到最近的边界上。

    两条硬约束，顺序不能换：

    * **必须前进**：上一块比 `chunk_overlap` 还短时（短段落 + 大重叠），`end - chunk_overlap`
      会退到上一块里面，照它走就是原地打转的死循环。所以锚点先抬到 `prev_start + 1` 以上。
    * **不许跳过正文**：起点最多到 `end - 1`，否则 `[end, 新起点)` 这段正文不会进任何块。
    """
    if chunk_overlap == 0:
        return end

    anchor = max(end - chunk_overlap, prev_start + 1)
    target = anchor
    window = text[anchor : anchor + _ALIGN_WINDOW]
    for pattern in _BOUNDARIES:
        match = pattern.search(window)
        if match is not None:
            target = anchor + match.end()
            break

    return max(min(target, end - 1), prev_start + 1)


def _fit(text: str, start: int, chunk_size: int) -> int:
    """从 `start` 起装一块，尽量收在自然边界上。"""
    hard = start + chunk_size
    if hard >= len(text):
        return len(text)

    # 先试「不超过目标大小」的边界；再试「允许超 1/3」的边界，但结果至少要装到一半。
    soft = min(hard + chunk_size // 3, len(text))
    floor = start + chunk_size // 2
    for pattern in _BOUNDARIES:
        within, beyond = _boundary_ends(pattern, text, start, hard, soft)
        if within is not None:
            return within
        if beyond is not None and beyond >= floor:
            return beyond
    return hard


def _boundary_ends(
    pattern: re.Pattern[str], text: str, start: int, hard: int, soft: int
) -> tuple[int | None, int | None]:
    """返回「目标大小内最靠后的边界」与「允许超出范围内最靠后的边界」，都是绝对偏移。"""
    within: int | None = None
    beyond: int | None = None
    for match in pattern.finditer(text, start, soft):
        position = match.end()
        if position > hard:
            beyond = position
        elif position > start:
            within = position
    return within, beyond
