"""查询前缀只拼在问句上，空白前缀保持原文。"""

from compute.providers.embeddings import prefix_query

QWEN3_QUERY_PREFIX = (
    "Instruct: Given a web search query, retrieve relevant passages that answer the query\n"
    "Query: "
)


def test_blank_prefix_keeps_the_query() -> None:
    assert prefix_query("退款规则", "") == "退款规则"
    assert prefix_query("退款规则", "   ") == "退款规则"


def test_qwen3_prefix_stays_on_one_instruction_line() -> None:
    text = prefix_query("退款规则", QWEN3_QUERY_PREFIX)
    assert text == f"{QWEN3_QUERY_PREFIX}退款规则"
    assert "Query: 退款规则" in text


def test_prefix_without_trailing_space_gets_a_newline() -> None:
    assert prefix_query("退款规则", "Note") == "Note\n退款规则"
