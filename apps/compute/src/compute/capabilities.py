"""能力登记表。

健康探针里的 `capabilities` 说的是「这台实例真的能干什么」，所以它**不能**靠扫描目录/装饰器
自动发现——那会把「代码写了一半」也报成「能力可用」。因此每落地一项能力，都要在这里显式登记一次：

* P6b-2：空表（只有骨架）；
* P6b-3：`rag.chunk`；
* P6b-4：`rag.embed`、`rag.index`；
* P9b：`agent.step`（一步推理 + 只读工具）、`rag.search`（只被 agent 步内部调用的检索面）。

登录点在各能力包的 `__init__.py` 里（由 [`compute.app.create_app`] 导入触发），
`implemented_in` 记录归属，排查时不用再猜这个能力住哪。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Capability:
    name: str
    implemented_in: str


class Registry:
    """进程内的能力登记表。重复登记即报错——能力名是契约的一部分。"""

    def __init__(self) -> None:
        self._items: dict[str, Capability] = {}

    def register(self, name: str, *, implemented_in: str) -> Capability:
        if name in self._items:
            message = f"能力 {name!r} 已登记在 {self._items[name].implemented_in}"
            raise ValueError(message)
        capability = Capability(name=name, implemented_in=implemented_in)
        self._items[name] = capability
        return capability

    def names(self) -> list[str]:
        """排序后返回，健康探针的输出对同一份代码保持稳定。"""
        return sorted(self._items)

    def all(self) -> tuple[Capability, ...]:
        return tuple(self._items[name] for name in self.names())


registry = Registry()
