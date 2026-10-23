"""OpenAI 兼容的模型桩：跨进程联调里唯一允许打桩的那一环。

cogito 的网关把 `POST /api/v1/service/chat/completions` 原样转发到
`gateway_provider.baseURL + /chat/completions`，所以本桩只要在这条路径上按 OpenAI 线格式
回答即可。`/embeddings` 同理（长期记忆的嵌入出口），回确定性伪向量，
让「写长期记忆」这条腿也能走到绿。

脚本化行为：历史里还没有 `role="tool"` 的结果时，先要一次 `asset_visibility_write`；
拿到工具结果后给一条纯文本结论。这样才会经过审批闸门，而不是一路直行。

    python apps/service/tests/e2e/model_stub.py      # 默认监听 127.0.0.1:9099

环境变量：

    STUB_ASSET_ID    必填。工具参数里要改的那个资产（必须是 seed_app.ps1 播出来的那个）
    STUB_VISIBILITY  可选，默认 RESTRICTED
    STUB_VIEWERS     可选，逗号分隔的用户 id（可见性名单）
    STUB_PORT        可选，默认 9099
    STUB_EMBED_DIM   可选，默认 8（伪向量维度；与 `agent_memory.dimensions` 对得上）
"""

from __future__ import annotations

import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

ASSET_ID = os.environ["STUB_ASSET_ID"]
VISIBILITY = os.environ.get("STUB_VISIBILITY", "RESTRICTED")
VIEWERS = [v for v in os.environ.get("STUB_VIEWERS", "").split(",") if v]
PORT = int(os.environ.get("STUB_PORT", "9099"))

CALL_ID = "call_stub_1"


def _arguments() -> str:
    payload: dict[str, Any] = {"assetID": ASSET_ID, "visibility": VISIBILITY}
    if VIEWERS:
        payload["viewers"] = VIEWERS
    return json.dumps(payload, ensure_ascii=False)


def _has_tool_result(messages: list[Any]) -> bool:
    return any(isinstance(m, dict) and m.get("role") == "tool" for m in messages)


EMBED_DIM = int(os.environ.get("STUB_EMBED_DIM", "8"))


def _embedding(text: str) -> list[float]:
    """确定性伪向量：同一段文本永远得到同一个向量（可复现），各分量互不相同。"""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [round((digest[i] / 255.0) * 2 - 1, 6) for i in range(EMBED_DIM)]


def _embeddings_reply(body: dict[str, Any]) -> dict[str, Any]:
    raw = body.get("input")
    texts = [raw] if isinstance(raw, str) else list(raw or [])
    return {
        "object": "list",
        "model": body.get("model", "e2e-stub-embedding"),
        "data": [
            {"object": "embedding", "index": i, "embedding": _embedding(str(text))}
            for i, text in enumerate(texts)
        ],
        "usage": {"prompt_tokens": 8 * len(texts), "total_tokens": 8 * len(texts)},
    }


def _reply(body: dict[str, Any]) -> dict[str, Any]:
    messages = body.get("messages")
    messages = messages if isinstance(messages, list) else []
    model = body.get("model", "e2e-stub-model")

    if _has_tool_result(messages):
        message: dict[str, Any] = {
            "role": "assistant",
            "content": "资产可见性已按审批结果落地，任务结束。",
        }
        finish = "stop"
    else:
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": CALL_ID,
                    "type": "function",
                    "function": {
                        "name": "asset_visibility_write",
                        "arguments": _arguments(),
                    },
                }
            ],
        }
        finish = "tool_calls"

    return {
        "id": "chatcmpl-stub",
        "object": "chat.completion",
        "model": model,
        "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        "usage": {"prompt_tokens": 64, "completion_tokens": 16, "total_tokens": 80},
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler 的命名约定
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"error": {"message": "invalid json"}})
            return
        if self.path.endswith("/embeddings"):
            self._send(200, _embeddings_reply(body))
            return
        if self.path.endswith("/chat/completions"):
            self._send(200, _reply(body))
            return
        self._send(404, {"error": {"message": f"unexpected path {self.path}"}})

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[model-stub] {fmt % args}", flush=True)


if __name__ == "__main__":
    print(f"[model-stub] listening on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
