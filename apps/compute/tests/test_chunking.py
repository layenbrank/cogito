"""切块器：纯函数，所以这一组不碰数据库、不碰 cogito。

这里真正要守住的是三条不那么显眼的性质：

* **确定性**——幂等重放要求同一份文本两次切出完全一样的块（连偏移都一样）；
* **不空转**——`重叠 >= 上一块长度` 时起点会退到上一块里面，必须仍然严格前进，
  否则 `_spans` 就是一个死循环（这是最容易被写出来、又最难在线上定位的 bug）；
* **不丢正文**——块与块之间不许出现「谁都没装进去」的空洞。
"""

from __future__ import annotations

import pytest

from compute import errors
from compute.rag_ingest import chunking

PARAGRAPH = "被切分出来的正文段落，用来观察块的边界落在哪里。"


def paragraphs(count: int, *, separator: str = "\n\n") -> str:
    return separator.join(f"{PARAGRAPH}{index}" for index in range(count))


def test_empty_text_yields_no_chunks() -> None:
    plan = chunking.split("", chunk_size=100, chunk_overlap=20)

    assert plan.chunks == ()
    assert (plan.chunk_size, plan.chunk_overlap) == (100, 20)


def test_whitespace_only_text_yields_no_chunks() -> None:
    """只有空白不算内容：否则 cogito 会拿到一堆检索得到的空块。"""
    assert chunking.split("   \n\n \t \n", chunk_size=100, chunk_overlap=0).chunks == ()


def test_short_text_is_one_chunk() -> None:
    plan = chunking.split("一句话。", chunk_size=1000, chunk_overlap=0)

    assert [chunk.text for chunk in plan.chunks] == ["一句话。"]
    assert plan.chunks[0].ordinal == 0


def test_offsets_point_back_into_the_source_text() -> None:
    text = paragraphs(12)
    plan = chunking.split(text, chunk_size=200, chunk_overlap=40)

    assert len(plan.chunks) > 1
    for chunk in plan.chunks:
        assert text[chunk.char_start : chunk.char_end] == chunk.text


def test_ordinals_are_contiguous_from_zero() -> None:
    plan = chunking.split(paragraphs(12), chunk_size=200, chunk_overlap=40)

    assert [chunk.ordinal for chunk in plan.chunks] == list(range(len(plan.chunks)))


def test_splitting_is_deterministic() -> None:
    """同输入两次必须逐字节相同——幂等重放靠的就是这个。"""
    text = paragraphs(20)

    first = chunking.split(text, chunk_size=256, chunk_overlap=64)
    second = chunking.split(text, chunk_size=256, chunk_overlap=64)

    assert first == second


def coverage(text: str, plan: chunking.ChunkPlan) -> dict[int, int]:
    """每个非空白字符被多少块覆盖——用来同时验「不丢正文」和「不重复」。"""
    counts = {index: 0 for index, char in enumerate(text) if not char.isspace()}
    for chunk in plan.chunks:
        for index in range(chunk.char_start, chunk.char_end):
            if index in counts:
                counts[index] += 1
    return counts


def test_chunks_align_to_paragraph_boundaries() -> None:
    """零重叠时块边界落在段落之间：块从段落开头起、到段落结尾止（中间的空白不算进块）。"""
    text = paragraphs(8)
    plan = chunking.split(text, chunk_size=200, chunk_overlap=0)

    assert len(plan.chunks) > 1
    assert plan.chunks[0].char_start == 0
    for previous, following in zip(plan.chunks, plan.chunks[1:], strict=False):
        gap = text[previous.char_end : following.char_start]
        assert gap and not gap.strip()  # 块之间只隔着段落空白，没有正文被跳过
        assert text[: following.char_start].endswith("\n\n")


def test_overlap_rewinds_the_next_chunk_into_the_previous_one() -> None:
    """没有自然边界的正文上，重叠量就是「往回退多少」——这里能精确断言偏移。"""
    text = "x" * 3000
    plan = chunking.split(text, chunk_size=1000, chunk_overlap=200)

    assert [chunk.char_start for chunk in plan.chunks] == [0, 800, 1600, 2400]
    assert [len(chunk.text) for chunk in plan.chunks] == [1000, 1000, 1000, 600]


def test_zero_overlap_visits_every_character_exactly_once() -> None:
    text = paragraphs(12)
    plan = chunking.split(text, chunk_size=200, chunk_overlap=0)

    assert set(coverage(text, plan).values()) == {1}
    for previous, following in zip(plan.chunks, plan.chunks[1:], strict=False):
        assert following.char_start >= previous.char_end


def test_text_without_any_whitespace_is_cut_hard_without_losing_content() -> None:
    text = "x" * 5000
    plan = chunking.split(text, chunk_size=1000, chunk_overlap=0)

    assert len(plan.chunks) == 5
    assert "".join(chunk.text for chunk in plan.chunks) == text


def test_chunk_may_overshoot_but_not_without_packing_one_third() -> None:
    """允许超目标大小去凑一个自然边界，但上限是 `+1/3`（否则短文本会被撑成巨块）。"""
    text = f"{'y' * 900}\n\n{'z' * 900}"
    plan = chunking.split(text, chunk_size=1000, chunk_overlap=0)

    assert plan.chunks[0].text == "y" * 900  # 收在段落边界上，没有把两段塞进一块
    for chunk in plan.chunks:
        assert len(chunk.text) <= 1000 + 1000 // 3


def test_short_paragraphs_with_huge_overlap_still_make_progress() -> None:
    """回归：上一块比重叠还短时，旧实现会把起点算到上一块之前，`_spans` 直接死循环。"""
    text = "\n\n".join(f"# {index}" for index in range(30))

    plan = chunking.split(text, chunk_size=8, chunk_overlap=7)

    assert len(plan.chunks) <= len(text)
    assert [chunk.ordinal for chunk in plan.chunks] == list(range(len(plan.chunks)))
    for chunk in plan.chunks:
        assert text[chunk.char_start : chunk.char_end] == chunk.text


def test_tiny_text_with_overlap_equal_to_size_minus_one_terminates() -> None:
    plan = chunking.split("a\n\nb", chunk_size=2, chunk_overlap=1)

    assert [chunk.text for chunk in plan.chunks] == ["a", "b"]


def test_every_character_is_covered_by_some_chunk() -> None:
    """有重叠时不许出现「谁都没装进去」的空洞。"""
    text = paragraphs(15, separator="\n\n")
    plan = chunking.split(text, chunk_size=120, chunk_overlap=30)

    assert min(coverage(text, plan).values()) >= 1


@pytest.mark.parametrize(
    ("chunk_size", "chunk_overlap"),
    [(0, 0), (-1, 0), (chunking.MAX_CHUNK_SIZE + 1, 0), (100, 100), (100, 101), (100, -1)],
)
def test_illegal_parameter_combinations_are_rejected(chunk_size: int, chunk_overlap: int) -> None:
    with pytest.raises(errors.ApiError) as raised:
        chunking.validate_params(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    assert raised.value.code is errors.ErrorCode.INVALID_REQUEST
    assert raised.value.status == 400


@pytest.mark.parametrize(
    ("chunk_size", "chunk_overlap"),
    [(1, 0), (chunking.MAX_CHUNK_SIZE, chunking.MAX_CHUNK_SIZE - 1), (1200, 200), (100, 0)],
)
def test_legal_parameter_combinations_are_accepted(chunk_size: int, chunk_overlap: int) -> None:
    chunking.validate_params(chunk_size=chunk_size, chunk_overlap=chunk_overlap)


def test_single_character_chunks_are_allowed() -> None:
    """`chunk_size=1` 是合法输入（契约只给了下界 1），不能把它变成死循环。"""
    plan = chunking.split("abc", chunk_size=1, chunk_overlap=0)

    assert [chunk.text for chunk in plan.chunks] == ["a", "b", "c"]
