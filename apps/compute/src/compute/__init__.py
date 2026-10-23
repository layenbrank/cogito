"""compute：cogito 的叶子计算服务（RAG 摄取 / agent 运行时）。

模块只做定义，不在 import 期建立连接或启动后台任务；进程入口是 [`compute.__main__`](__main__.py)。
"""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("compute")
except PackageNotFoundError:  # 源码目录直接运行（未安装）时的兜底
    __version__ = "0.0.0+unknown"

__all__ = ["__version__"]
