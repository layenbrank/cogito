"""Agent 运行时：单步推理 + 工具（Python 生态在这里才无可替代）。

三个端点，都只服务 cogito：

* `POST /internal/v1/agents/steps` —— **一步**：多轮循环的宿主是 cogito 的可靠执行
  （一步一个活动，重投能收敛），本服务不持有对话状态；
* `POST /internal/v1/agents/tool-executions` —— **审批通道的执行半边**：`steps` 遇到需要
  人工审批的工具只留占位结果（`awaitingApproval=true`），cogito 拿到批准后再从这条路径把那次
  调用真的跑掉。两条路径同属 `agent.step` 能力，执行入口只有一个；
* `POST /internal/v1/agents/memories` —— **收尾记一笔**：任务有结论时把结论写进长期记忆，
  供**之后的任务**按语义召回。同样是 cogito 发起的（`agent.remember` 活动），
  所以「谁写了什么记忆」在 cogito 的编排历史里可查。

分工是刻意的：

* cogito 决定「要不要再来一步、预算还剩多少、这一步允许哪些工具、历史里有什么」——
  这些问题都需要任务状态与租户策略，那是 cogito 的地盘；
* compute 决定「这一步怎么跟模型说话、工具怎么跑、失败怎么喂回去、记忆怎么收拾」——
  模型、工具与向量空间的细节都封在这里，cogito 不必跟着上游厂商的形状改。

登记三个能力（词汇见 `apps/service/spec/internal.yaml`）：

* `agent.step` —— 单步端点与审批执行端点；
* `rag.search` —— 单步的工具所用的检索面（向量相似度在 compute 自己的 pgvector 上做）。
  它由 [`compute.rag_ingest`] 登记且**不单独开端点**：检索不该是别人能直接调的能力，
  它只能作为模型的一次工具调用发生，这样「谁在什么租户下查了什么」永远有一条完整因果链；
* `agent.memory` —— 长期记忆面（`memories` 端点 + `memory_recall` / `memory_write` 两个工具）。
  和 `rag.search` 不同，它**有**端点：写入必须由 cogito 的编排驱动——那是唯一知道
  「任务真的收尾了」的地方，不能让模型自己宣称任务完成。

模块分工：

* `schemas.py` —— 契约形状的 pydantic 模型（含导出时 `exclude_none` 的理由）；
* `dialogue.py` —— 契约的扁平消息 ↔ OpenAI 线格式的翻译，以及上游响应的解析；
* `tools.py` —— 工具登记表、参数校验、失败语义、结果截断；
* `router.py` —— 单步端点的流程（校验 → 幂等 → 调模型 → 跑工具 → 记账）与审批执行端点的
  准入（工具声明了需要审批 + 在白名单里）；
* `memory.py` —— 长期记忆：存储与召回、摘要组装、`memories` 端点。
"""

from __future__ import annotations

from fastapi import APIRouter

from compute import capabilities
from compute.agent_runtime.memory import ROUTER as MEMORY_ROUTER
from compute.agent_runtime.router import ROUTER as STEP_ROUTER

__all__ = ["ROUTER", "memory_registry", "registry"]

# 能力包对外只暴露一个 `ROUTER`，所以这里把两条子路由合成一个
# （`app.create_app()` 只按 `CAPABILITY_MODULES` 里的 `ROUTER` 名字取路由）。
ROUTER = APIRouter()
ROUTER.include_router(STEP_ROUTER)
ROUTER.include_router(MEMORY_ROUTER)

registry = capabilities.registry.register(
    "agent.step", implemented_in="compute.agent_runtime.router"
)
memory_registry = capabilities.registry.register(
    "agent.memory", implemented_in="compute.agent_runtime.memory"
)
