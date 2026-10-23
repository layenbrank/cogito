"""从资产原始字节里抽出纯文本。

抽取器按 **mime** 选（契约 `ChunkRequest.mime` 是 cogito 的 `asset.mime`，内容端点的
``content-type`` 与它同一来源），这是唯一可靠的选择依据：文件名会被用户改，字节里也没有
统一的自述类型，而 mime 在 cogito 上传时就定下来了。

抽不出来就**明确拒绝**（400 `invalid_request`），不要静默返回空文本：空文本会切出 0 块，
cogito 那边看起来「成功了」，但检索永远命中不了这个资产——这类静默失败比一个 400 贵得多。

注册表是显式的：新增一种格式 = 加一条 `_register(...)`。不做按扩展名的兜底猜测。
"""

from __future__ import annotations

import codecs
import io
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser

from compute import errors

logger = logging.getLogger(__name__)

#: 单个抽取器最多产出多少字符。超长资产（例如一本 PDF）切块后再乘重叠会把内存顶穿，
#: 而 cogito 侧的超时更短，所以这里先截断并明确记日志，而不是让进程被 OOM 杀掉。
MAX_TEXT_CHARS = 8 * 1024 * 1024

_BOM_ENCODINGS: tuple[tuple[bytes, str], ...] = (
    (codecs.BOM_UTF8, "utf-8-sig"),
    (
        codecs.BOM_UTF32_LE,
        "utf-32",
    ),  # 必须排在 UTF-16 前面：UTF-32-LE 的前两字节也是 UTF-16-LE 的 BOM
    (codecs.BOM_UTF32_BE, "utf-32"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)


@dataclass(frozen=True, slots=True)
class Extracted:
    """抽取结果。`text` 已做换行归一化，`extractor` 只用于日志与落库排查。"""

    text: str
    extractor: str


def extract(data: bytes, *, mime: str, name: str | None = None) -> Extracted:
    """按 `mime` 抽文本。不支持的格式抛 400，而不是返回空串。"""
    extractor = _EXTRACTORS.get(_normalize_mime(mime))
    if extractor is None:
        supported = "、".join(sorted(_EXTRACTORS))
        label = f"{mime}（{name}）" if name else mime
        message = f"暂不支持从 {label} 抽取文本；已支持的 MIME 类型：{supported}"
        raise errors.invalid_request(message)

    extracted = extractor(data)
    if len(extracted.text) > MAX_TEXT_CHARS:
        logger.warning(
            "抽取结果 %d 字符，超过 %d 上限，已截断（更长的资产请先在 cogito 侧切分再上传）",
            len(extracted.text),
            MAX_TEXT_CHARS,
        )
        return Extracted(text=extracted.text[:MAX_TEXT_CHARS], extractor=extracted.extractor)
    return extracted


def normalize_text(text: str) -> str:
    """切块前的归一化：统一换行、丢掉 NUL 与行尾空白。

    这一步必须是**确定性**的（同一份字节永远得到同一份文本），因为 `textSha` 算在它上面，
    而幂等核对依赖 `textSha` 稳定。所以这里只做字符级替换，不做任何依赖环境的处理。
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return text.strip("\n")


def decode_text(data: bytes) -> str:
    """按 BOM 探测编码，没有 BOM 就按 UTF-8 解，坏字节用替换字符兜住。

    不用 `chardet` 那类探测：它会在短文本上猜错，而猜错的代价是文本被换成乱码
    ——「有 BOM 就信 BOM，否则信 UTF-8」是唯一可预测的规则。
    """
    for bom, encoding in _BOM_ENCODINGS:
        if data.startswith(bom):
            return data.decode(encoding, errors="replace")
    return data.decode("utf-8", errors="replace")


def _normalize_mime(mime: str) -> str:
    """去掉 `; charset=...` 之类的参数并转小写。"""
    return mime.split(";", 1)[0].strip().lower()


def _extract_plain(data: bytes) -> Extracted:
    return Extracted(text=normalize_text(decode_text(data)), extractor="text")


def _extract_json(data: bytes) -> Extracted:
    """JSON 重新缩进后再切：紧凑的一整行 JSON 会被当成一个「超长段落」硬切，缩进后语义边界更好。"""
    raw = decode_text(data)
    try:
        parsed = json.loads(raw)
    except ValueError:
        # 非法 JSON 也照原文切：能索引一部分比整份资产失败好，格式问题由调用方自己发现。
        logger.debug("application/json 解析失败，按原文处理")
        return Extracted(text=normalize_text(raw), extractor="json")
    return Extracted(
        text=normalize_text(json.dumps(parsed, ensure_ascii=False, indent=2)),
        extractor="json",
    )


class _TextCollector(HTMLParser):
    """把 HTML 里的可见文本收集出来，丢掉 `script` / `style` 与所有标签。

    用标准库而不是引 HTML 解析依赖：这里只需要「要文本」，不需要 DOM、不需要容错渲染，
    而块边界本来就在下一步（切块）才确定。
    """

    _SKIPPED = frozenset({"script", "style", "head", "noscript"})
    _BLOCK = frozenset(
        {
            "address",
            "article",
            "blockquote",
            "br",
            "dd",
            "div",
            "dl",
            "dt",
            "figcaption",
            "figure",
            "footer",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "header",
            "hr",
            "li",
            "main",
            "nav",
            "ol",
            "p",
            "pre",
            "section",
            "table",
            "tbody",
            "td",
            "tfoot",
            "th",
            "thead",
            "tr",
            "ul",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIPPED:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            # 块级元素之间补一个空行：切块按空行分段，这样段落边界才不会被压成一行。
            self._parts.append("\n\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIPPED:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in self._BLOCK:
            self._parts.append("\n\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    @property
    def text(self) -> str:
        return "".join(self._parts)


def _extract_html(data: bytes) -> Extracted:
    parser = _TextCollector()
    parser.feed(decode_text(data))
    parser.close()
    return Extracted(text=normalize_text(parser.text), extractor="html")


def _extract_pdf(data: bytes) -> Extracted:
    """PDF 抽文本。`pypdf` 是纯 Python 实现，没有系统库依赖。

    扫描件（图片型 PDF）抽出来是空的，这里当**成功但 0 字符**处理并警告：那是 OCR 的活，
    不是抽取器的 bug，硬报错只会让「有文字层的 PDF」和「扫描件」在错误码上混在一起。
    """
    from pypdf import PdfReader  # 只有走 PDF 分支才需要，不拖慢其它格式

    reader = PdfReader(io.BytesIO(data))
    pages: list[str] = []
    for index, page in enumerate(reader.pages):
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # 单页坏掉不该让整份文档失败；坏页留空，位置仍在
            logger.warning("PDF 第 %d 页抽取失败，该页留空", index + 1)
            pages.append("")
    text = normalize_text("\n\n".join(pages))
    if not text:
        logger.warning("PDF 抽不出任何文本（很可能是扫描件，需要 OCR 而不是抽取器）")
    return Extracted(text=text, extractor="pdf")


_EXTRACTORS: dict[str, Callable[[bytes], Extracted]] = {}


def _register(*mimes: str, extractor: Callable[[bytes], Extracted]) -> None:
    for mime in mimes:
        _EXTRACTORS[mime] = extractor


_register(
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "text/csv",
    "text/tab-separated-values",
    "text/xml",
    "application/xml",
    extractor=_extract_plain,
)
_register("text/html", "application/xhtml+xml", extractor=_extract_html)
_register("application/json", "application/ld+json", extractor=_extract_json)
_register("application/pdf", extractor=_extract_pdf)


def supported_mimes() -> list[str]:
    """已登记 MIME 的排序快照（错误信息与文档共用一份事实）。"""
    return sorted(_EXTRACTORS)
