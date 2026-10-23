"""抽取器：MIME → 纯文本。同样是纯函数，不碰库也不碰 cogito。

这一组要盯住的是「可预测」：编码只按 BOM 判断、归一化必须确定（`textSha` 算在它上面）、
不认识的 MIME 明确拒绝而不是安静地返回空串。
"""

from __future__ import annotations

import codecs
import io
import logging

import pytest
from pypdf import PdfWriter

from compute import errors
from compute.rag_ingest import extract


def test_plain_text_is_decoded_as_utf8() -> None:
    extracted = extract.extract("一段正文".encode(), mime="text/plain")

    assert extracted.text == "一段正文"
    assert extracted.extractor == "text"


def test_charset_parameter_and_case_are_ignored() -> None:
    extracted = extract.extract(b"body", mime="TEXT/PLAIN; charset=utf-8")

    assert extracted.text == "body"


def test_utf8_bom_is_stripped() -> None:
    extracted = extract.extract(codecs.BOM_UTF8 + "正文".encode(), mime="text/plain")

    assert extracted.text == "正文"


def test_utf16_bom_is_honoured() -> None:
    data = codecs.BOM_UTF16_LE + "正文".encode("utf-16-le")

    extracted = extract.extract(data, mime="text/plain")

    assert extracted.text == "正文"


def test_invalid_utf8_bytes_do_not_raise() -> None:
    """坏字节用替换字符兜住：宁可少几个字，也不要整份资产失败。"""
    extracted = extract.extract(b"a\xffb", mime="text/plain")

    assert extracted.text.startswith("a")
    assert extracted.text.endswith("b")


def test_carriage_returns_and_nul_are_normalized() -> None:
    extracted = extract.extract(b"line1\r\nline2\rline3\x00", mime="text/plain")

    assert extracted.text == "line1\nline2\nline3"


def test_trailing_whitespace_per_line_is_dropped() -> None:
    """行尾空白会让 `textSha` 对同一份内容产生不同结果，必须在抽取阶段收敛掉。"""
    extracted = extract.extract(b"a   \nb\t\n\n", mime="text/plain")

    assert extracted.text == "a\nb"


@pytest.mark.parametrize(
    "mime",
    ["text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "application/xml"],
)
def test_text_flavours_share_the_plain_extractor(mime: str) -> None:
    extracted = extract.extract(b"content", mime=mime)

    assert extracted.text == "content"
    assert extracted.extractor == "text"


def test_html_drops_tags_scripts_and_styles() -> None:
    data = b"""<html><head><title>TITLE-TEXT</title><style>p{color:red}</style></head>
    <body><script>var secret = 1;</script><p>para1</p><p>para2</p></body></html>"""

    extracted = extract.extract(data, mime="text/html")

    assert extracted.extractor == "html"
    assert "var secret" not in extracted.text
    assert "color:red" not in extracted.text
    assert "TITLE-TEXT" not in extracted.text
    # 块级元素之间补了空行，切块时才能按段落分段。
    assert "para1\n\n" in extracted.text
    assert "para2" in extracted.text


def test_html_entities_are_decoded() -> None:
    extracted = extract.extract(b"<p>a &amp; b</p>", mime="text/html")

    assert "a & b" in extracted.text


def test_json_is_pretty_printed_before_chunking() -> None:
    extracted = extract.extract('{"名":"值"}'.encode(), mime="application/json")

    assert extracted.extractor == "json"
    assert '"名": "值"' in extracted.text


def test_invalid_json_falls_back_to_the_raw_text() -> None:
    extracted = extract.extract(b"{not json", mime="application/json")

    assert extracted.text == "{not json"
    assert extracted.extractor == "json"


def test_pdf_without_text_layer_yields_empty_text() -> None:
    """扫描件的正常结果：抽出来是空的，不是异常——这页面的活属于 OCR。"""
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)

    extracted = extract.extract(buffer.getvalue(), mime="application/pdf")

    assert extracted.text == ""
    assert extracted.extractor == "pdf"


def test_broken_pdf_raises_instead_of_returning_garbage() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pypdf 的异常类型属于它的实现细节，不锁死
        extract.extract(b"%PDF-1.4 not really a pdf", mime="application/pdf")


@pytest.mark.parametrize("mime", ["image/png", "application/octet-stream", ""])
def test_unsupported_mime_is_rejected_with_the_supported_list(mime: str) -> None:
    with pytest.raises(errors.ApiError) as raised:
        extract.extract(b"payload", mime=mime, name="report.docx")

    assert raised.value.code is errors.ErrorCode.INVALID_REQUEST
    assert raised.value.status == 400
    assert "application/pdf" in raised.value.message
    assert "report.docx" in raised.value.message


def test_empty_payload_is_not_an_error() -> None:
    assert extract.extract(b"", mime="text/plain").text == ""


def test_overlong_extraction_is_truncated_with_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(extract, "MAX_TEXT_CHARS", 10)

    with caplog.at_level(logging.WARNING):
        extracted = extract.extract(b"x" * 100, mime="text/plain")

    assert extracted.text == "x" * 10
    assert "截断" in caplog.text


def test_supported_mimes_is_sorted_and_mentions_pdf() -> None:
    mimes = extract.supported_mimes()

    assert mimes == sorted(mimes)
    assert "application/pdf" in mimes
