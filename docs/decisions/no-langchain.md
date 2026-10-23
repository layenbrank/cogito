# compute 的 agent 运行时：自持薄层（不采用 LangChain / LangGraph）

> 目标：compute 的 agent 运行时里，「这一步怎么跟模型说话、工具怎么跑、失败怎么喂回去、记忆怎么收拾」
> 需要 Python 生态（PDF 抽取、向量、将来的多格式解析与评测），
> 但**不需要**再有第二个地方来决定「要不要下一步、谁批准、历史存在哪」。
> 结论：**自持一层薄运行时**（`agent_runtime/`，共 1,952 行，运行期依赖只有 pydantic / httpx 与契约本身），
> **不采用** `langchain` / `langgraph` 作为这一层的框架。

> **这是一条补记**。P6b–P10b 落地时只留下了「工具面就是安全边界」这类做法
> （[`../../apps/compute/src/compute/agent_runtime/__init__.py`](../../apps/compute/src/compute/agent_runtime/__init__.py)），
> 没有留下「为什么不用现成 agent 框架」的取舍理由。本记录于 P10b 之后补写，**不改动任何实现**：
> 涉及本仓库的部分以仓库内既有文档与门禁为准；上游事实于 2026-09-28 逐个核对（来源见 §7）。

## 0. 候选对照

| 候选                                            | 形态                                                                                                                            | 结论                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **自持薄层（现状）**                            | 契约形状的 pydantic 模型 + 一个协议翻译层 + 一张工具登记表 + 一个手写 JSON Schema 子集校验器                                     | **采用**，落地在 `apps/compute/src/compute/agent_runtime/`              |
| `langchain` 1.x                                 | 预置 agent 架构 + 模型/工具集成；官方自述 agent 运行**建在 LangGraph 上**                                                       | 不采用，见 §2.1、§2.2                                                      |
| `langgraph`                                     | 低层 agent 编排运行时 + checkpointer                                                                                            | 不采用，见 §2.3：与 durable 编排**职责重叠**                               |
| 只借 `langchain-core`（消息与工具抽象，不带编排） | 「窄依赖」折中                                                                                                                 | 1.x 里这个折中不成立（§2.2）；且它硬拉 `langsmith` / `tenacity`（§2.5）    |
| 只借**单个窄库**（如文本切分、多格式解析、评测） | 一个包解决一个问题                                                                                                              | **不排除**：这是 §5 的窄库通道，需要时单独评估、单独登记                   |

## 1. 五条约束决定了后面每一条理由

| #   | 约束                                                                                                                        | 出处                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **唯一 LLM 出网点 = cogito 的 `gateway`**（唯一计量点、唯一审计点）；compute 不许持有 API Key、base URL、模型清单            | [`providers/__init__.py`](../../apps/compute/src/compute/providers/__init__.py)、[`gateway/README.md`](../../apps/service/src/services/gateway/README.md) |
| 2   | **循环的宿主是 durable 编排**：要不要再来一步、剩余几步、这一步允许哪些工具、历史里有什么，都由 cogito 决定                     | [`agent_runtime/__init__.py`](../../apps/compute/src/compute/agent_runtime/__init__.py)、`orchestrations/agent.rs`（`remaining_steps` / `tools_for_step`） |
| 3   | **人工审批的闸门在编排里**：compute 只负责「申报这次调用要人批」与「批准后真的执行它」                                       | [`approval-channel.md`](./approval-channel.md)                          |
| 4   | **失败分级是契约的一部分**：`ok=false` 是正常结果、只有暂时性故障才 503、审批不合规是终局拒绝（403 + `500509` → 400）        | [`tools.py`](../../apps/compute/src/compute/agent_runtime/tools.py)、[`cogito_client.py`](../../apps/compute/src/compute/cogito_client.py) |
| 5   | 工程门禁：mypy `strict` + `warn_unreachable`、pytest `filterwarnings = ["error"]`、ruff 含 `S`（安全）规则、单一 lock（uv）   | [`pyproject.toml`](../../apps/compute/pyproject.toml)                 |

## 2. 决定性理由

### 2.1 框架的三张主牌，在这套架构里都已经有主

| 框架卖什么                            | 本仓库谁在管                                                                                                    | 引入后拿到什么         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **厂商适配**（几十种 LLM / embedding） | Rust `gateway`：`gateway_provider`（`baseURL / apiKeyEnc / status`）、`gateway_model`（能力、配额）、`gateway_usage`、`gateway_audit` | 拿不到。位置是**刻意**留的 |
| **向量库 / 检索器抽象**               | 只有一个库：自己的 Postgres + pgvector，表（`rag_chunk` / `agent_memory` 等）归 compute，跨库边界有测试钉着      | 多一层抽象，少一点确定性 |
| **Agent 循环 / 持久化**               | durable 编排（duroxide + Postgres）：`/agents/steps` 只跑**一步**，`/agents/tool-executions` 只跑**一次已批准的调用** | 第二个控制面（§2.2、§2.3） |

一句话：不是「没必要」，而是**必要性已经被别的东西满足**——而这些「别的东西」正是为了满足 §1 的约束才存在的。

### 2.2 「只用 LangChain 的消息与工具抽象，不碰编排运行时」在 1.x 里不成立

这是本次核对出来的**硬事实**（2026-09-28，PyPI 元数据）：`langchain` 1.4.2 的直接依赖只有三个——

```
langchain-core>=1.6.3
langgraph>=1.2.11      <-- 编排运行时是直接依赖，不是可选 extra
pydantic>=2.7.4
```

而 `langgraph` 1.2.12 的直接依赖里，`langgraph-checkpoint>=4.1.0`、`langgraph-prebuilt`、`langgraph-sdk`
同样是**必装**（不是 extra）。官方 README 的说法与此一致：LangChain 的 agent 建在 LangGraph 之上，
以获得 durable execution / streaming / human-in-the-loop / persistence。

也就是说：**装 `langchain` 就等于把「另有一套持久化与人在环模型」拉进依赖树**。
对照 §1 的约束 2 与 3，这不是「多一个库」，而是多一个与 cogito 抢同三件事（循环、持久化、审批）的运行时。

### 2.3 循环与持久化不能有两个权威

`checkpoint` 与可靠执行的差别，[`durable-execution-engine.md`](./durable-execution-engine.md) 已经在候选表里判过一次
（第 19 行：「框架自带 checkpoint（LangGraph 等）→ 不采用：checkpoint ≠ 可靠执行」）。这里只补三点与本层直接相关的：

- **换进程接着跑**：编排可能在新进程里继续，compute 不持有对话状态（`agent_runtime/__init__.py` 的原话）。
  框架的 checkpointer 假设状态在**它自己的进程/存储**里，这与「一步一个活动、重投能收敛」的形状相反。
- **至少一次重投递**：每个工具的写入用确定性主键收敛，所以 cogito 重投一步安全。框架的「恢复」会带来它自己的一套重放语义。
- **审批窗口**：人在编排还没走到订阅点时就点了批准，是靠**邮箱**接住的（见 approval-channel ADR）。
  框架的 human-in-the-loop 中断/恢复是**它自己的**载体，于是「这次调用还在等审批吗」就会出现第二个真相。

结论：如果将来真的要换，该评估的是 **LangGraph**（问题在编排，不在抽象），而且前提是「循环的宿主已经不在 cogito 了」。

### 2.4 这一层真正要写的东西很少，而且**必须**由我们写

`agent_runtime/` 1,952 行的构成：工具面 751、单步流程 350、记忆 317、契约模型 299、协议翻译 173、能力登记 62。

- **协议翻译**（173 行，[`dialogue.py`](../../apps/compute/src/compute/agent_runtime/dialogue.py)）：
  契约是**扁平**的（`arguments` 是 JSON 字符串，cogito 不必反序列化就能整条存下再回灌），OpenAI 线格式是**嵌套**的。
  模块 docstring 写下的保证是「翻译只发生在一个位置，所以『cogito 看到的历史』和『模型看到的历史』不可能各自漂移」。
  引入框架的消息对象，等于把这句话变成三种表示之间的三方同步。
- **工具面**（751 行，[`tools.py`](../../apps/compute/src/compute/agent_runtime/tools.py)）：
  说明书与校验**共用同一份声明**（给模型看的 `parameters` 就是校验器读的那份，所以不会出现「写着 1–20、代码允许 1000」）。
  这一条框架也能做（Pydantic `args_schema`），但它**承载不了这里的语义**：
  审批占位（`awaitingApproval=true` 是 200 的稳定机器码）、失败分级（`ok=false` 喂回模型 vs 暂时性故障才 503）、
  写预算、结果截断、以及**能被模型读懂的中文错误文案**（测试按这些片段断言）。
- **手写 JSON Schema 子集**：`jsonschema` 只在 dev 依赖里，运行时不可用——这是刻意的，运行时校验器必须自己可控、可测。

### 2.5 采用成本（可验证，不是审美）

| #   | 成本                                                                                                                              | 依据                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `langchain-core` **硬依赖 `langsmith>=0.3.45`**：面向第三方平台的观测 SDK 进依赖树，而本仓观测口径已定在 OTel + cogito 的计量与审计 | PyPI 元数据（2026-09-28）                                           |
| 2   | `langchain-core` **硬依赖 `tenacity`**：重试/退避在这个框架里是一等公民，与本仓「重试与否由 cogito 决定」的口径会有两个来源         | PyPI 元数据；本仓口径见 [`cogito_client.py`](../../apps/compute/src/compute/cogito_client.py) 的错误映射注释 |
| 3   | pytest `filterwarnings = ["error"]`：第三方 deprecation 会让测试套**直接红**，等于把 CI 稳定性外包给框架的发版节奏                  | [`pyproject.toml`](../../apps/compute/pyproject.toml)             |
| 4   | `langgraph-sdk` 是 `langgraph` 的必装依赖：它面向 LangGraph 平台/服务端，而本仓没有、也不打算有那个服务端                           | PyPI 元数据                                                         |
| 5   | mypy `strict` + `warn_unreachable`：框架把大量行为放在运行时（Pydantic / `Any` 泄漏），要额外写 override 才过得去                   | `pyproject.toml`                                                    |

顺带澄清一个**不成立**的反对理由：`langchain` 的 `requires_python` 是 `>=3.10,<4.0`、
classifiers 覆盖到 3.14，与本仓的 `>=3.12,<3.13` 不冲突。**Python 版本不是这条决定的理由**，理由是上面五条与 §2.1–§2.3。

## 3. 引入之后会破掉的不变量（逐条核对）

| #   | 不变量                                          | 引入之后会发生什么                                                             |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 唯一出网点 = `gateway`                          | 框架的 provider 抽象鼓励在本地配 `base_url` / `api_key`，「本包不会有 API Key」的承诺失效 |
| 2   | 循环宿主 = durable 编排                         | 框架自带 executor / 循环判定，「下一步谁说了算」变成两个地方                    |
| 3   | 审批闸门在编排里                                | 框架的 human-in-the-loop 带自己的中断/恢复载体，出现第二套「谁在等」的真相      |
| 4   | 重试由 cogito 决定                                | `tenacity` 在依赖树里，重试语义可能有两个来源                                   |
| 5   | 契约唯一源（`internal.yaml` + pydantic）        | 框架的消息/工具对象是第三份表示，§2.4 的那句保证被打散                          |
| 6   | 计量与审计在 cogito                               | 框架的 callback / tracing 把一部分观测引向它自己的平台，观测口径分裂            |
| 7   | `filterwarnings = ["error"]` 下的门禁稳定性     | 框架的 deprecation 直接让测试套变红（成本项，非语义项）                         |

## 4. 我们接受的代价（自持这一层的账）

- 上游线格式变化要自己跟（好处是**只有一处**要改：`dialogue.py`）；没有现成的结构化输出解析与解析失败重试。
- 没有现成的多格式文档加载器：目前只有 `pypdf`（纯 Python、无系统库依赖），
  新增格式是「加一条 `_register(...)`」的显式登记（见 [`extract.py`](../../apps/compute/src/compute/rag_ingest/extract.py)）。
- 没有 LangSmith 那类评测 / 回放平台：要做评测集回归得自己搭，或单独评估窄工具。
- 厂商适配要 cogito 那边加 provider——这是**正确的位置**，不是代价。
- Python 侧没有 `cargo deny` 那样的「封禁依赖」门禁，所以这条决定只能靠文档 + `pyproject.toml` 的显式审阅来守。

## 5. 什么情况下重新考虑

不是「以后再说」，而是有明确的触发形状：

1. **循环的宿主从 Rust 编排搬回 Python**（cogito 不再持有「下一步」）→ 此时要评估的是 **LangGraph**，不是 LangChain；
   并且要先回答：幂等键、租户策略、审批闸门由谁承担。
2. **需要图状 / 多智能体工作流**（条件分叉、并行分支、子图复用、可视化调试）→ 先问「这该不该落在 cogito 的 durable 编排里」；
   只有确认循环整体在 Python 进程内才考虑引入编排运行时。
3. **RAG 需要多格式或复杂切分** → 走**窄库通道**：只引那一个包（如文本切分、多格式解析），
   登记进 `pyproject.toml`，不引整栈。这正是「Python 生态」在本仓的正确用法。
4. **需要评测集 / 数据回放平台** → 单独评估，不与运行时绑在一起。

四条里任何一条成立时，都必须先回答同一个问题：**它会不会成为第二个控制面。**

## 6. 后向指针

| 位置                                                                                                        | 说明                                                     |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`agent_runtime/__init__.py`](../../apps/compute/src/compute/agent_runtime/__init__.py)                  | 三个端点、与 cogito 的分工（谁是循环宿主）                 |
| [`tools.py`](../../apps/compute/src/compute/agent_runtime/tools.py)                                      | 工具面三条硬边界 + 审批声明（`requires_approval`）        |
| [`dialogue.py`](../../apps/compute/src/compute/agent_runtime/dialogue.py)                                | 契约 ↔ OpenAI 线格式的唯一翻译点                         |
| [`cogito_client.py`](../../apps/compute/src/compute/cogito_client.py)                                        | 唯一出网点；错误映射口径（谁能重试）                     |
| [`providers/__init__.py`](../../apps/compute/src/compute/providers/__init__.py)                          | 「本包不会有 API Key，也不会有 base_url」                |
| [`gateway/README.md`](../../apps/service/src/services/gateway/README.md)                                        | 厂商适配 / 配额 / 审计 / 写令牌                          |
| [`durable-execution-engine.md`](./durable-execution-engine.md)                                               | 可靠执行的形状；候选表里已判过框架 checkpoint            |
| [`approval-channel.md`](./approval-channel.md)                                                               | 审批闸门在编排、决定走邮箱                               |
| [`../apps/service/guide/agent-runtime.md`](../../apps/service/guide/agent-runtime.md)                              | 三进程分工、工具表、三条立场                             |
| [`../../apps/compute/README.md`](../../apps/compute/README.md)                                           | 「设计决策」小节（与「为什么不用 Alembic？」并列）        |

## 7. 上游来源（2026-09-28 核对）

- **langchain**：PyPI `langchain 1.4.2`（MIT，Development Status: Production/Stable，
  `requires_python >=3.10,<4.0`）；`requires_dist` 中非 extra 的直接依赖为
  `langchain-core>=1.6.3`、`langgraph>=1.2.11`、`pydantic>=2.7.4`；
  README 自述「LangChain agents are built on top of LangGraph in order to provide durable execution,
  streaming, human-in-the-loop, persistence」，并建议复杂需求直接使用 LangGraph。
- **langgraph**：PyPI `langgraph 1.2.12`（`requires_python >=3.10`）；非 extra 的直接依赖为
  `langchain-core>=1.4.7`、`langgraph-checkpoint>=4.1.0`、`langgraph-prebuilt>=1.1.0`、
  `langgraph-sdk>=0.4.2`、`pydantic>=2.7.4`、`xxhash>=3.5.0`。
  PyPI 的 `license` 字段为空，**许可证未参与本决策**（记录于此，说明不是漏查）。
- **langchain-core**：PyPI `langchain-core 1.6.5`（MIT）；非 extra 的直接依赖含
  `httpx`、`jsonpatch`、`langchain-protocol`、`langsmith>=0.3.45`、`packaging`、`pydantic`、
  `pyyaml`、`tenacity>=8.1.0`、`typing-extensions`、`uuid-utils`。
- 本仓库事实（行数、文件、表名）以本次提交时的 `master` 为准，未引用任何外部版本号。
