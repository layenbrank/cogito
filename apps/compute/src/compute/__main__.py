"""进程入口：`compute` 命令行脚本与 `python -m compute` 都走这里。

`log_config=None` 是关键：否则 uvicorn 会用自带格式覆盖我们刚装好的 JSON handler，
出现两种日志格式混在同一个流里。access 日志则顺带走 root handler
（`uvicorn.access` 已改为向 root 传播）。
"""

from __future__ import annotations

import uvicorn

from compute import __version__, telemetry
from compute.app import create_app
from compute.config import get_settings
from compute.logging_setup import configure_logging


def main() -> None:
    settings = get_settings()
    configure_logging(level=settings.log_level, service="compute", version=__version__)
    telemetry.setup(settings, version=__version__)
    try:
        uvicorn.run(
            create_app(settings),
            host=settings.host,
            port=settings.port,
            log_config=None,
        )
    finally:
        # 退出前把队列里剩下的 span 冲出去，否则最后几个请求在 Jaeger 里会缺一段。
        telemetry.shutdown()


if __name__ == "__main__":
    main()
