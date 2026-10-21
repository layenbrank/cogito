# 服务端 agent 运行时

租户级**自治 agent**：给一个目标，它在服务端自己跑完多轮「模型思考 → 调工具 → 再思考」，
最后把结论与过程落进台账。全程无人在环，所以它按**长任务**设计——起任务与查任务是两个接口，
循环本身在可靠执行里（[`orchestrations/agent.rs`](../src/orchestrations/agent.rs)），
由 orchestrator 进程驱动。

它**不是**聊天面：没有 SSE 会话，也不做「问一句答一句」。客户端里那套 agent
（studio 内嵌的 `opencode`：本地工作区、文件编辑、逐步审批）是**另一条链路**，两条不合并，
共同点只有 cogito 网关这一层（配额 / 计量 / 审计）。

本文写的是**跑起来之后**的事：谁在跑、怎么失败、怎么续、怎么看。配置项与长期记忆的投毒面见
[`configuration.md`](configuration.md)；HTTP 契约、入参与鉴权见
[`../src/services/agent/README.md`](../src/services/agent/README.md)；
台账表本身见 [`../crates/agent/README.md`](../crates/agent/README.md)。
同一套「台账 + durable 编排」入口模式也被 RAG 索引长任务复用，见
[`../src/services/rag/README.md`](../src/services/rag/README.md)。

## 三个进程各做什么

| 进程 | 职责 | 为什么在这一侧 |
| --- | --- | --- |
| `api` | 台账的**唯一写者**：起任务建行、查任务渲染进度、终态写回结果 | 台账是业务数据（租户、发起人、结论），必须落 cogito 的业务库 |
| `orchestrator` | 跑 `agent.run`：一步一个活动，管历史、预算与工具白名单 | 确定性编排 + 幂等活动 + 步骤级重试，这是 durable 的地盘 |
| `ai-worker` | **无状态单步**：这次推理怎么跟模型说话、工具怎么跑、失败怎么喂回去 | 模型、工具与向量空间的细节封在 Python 侧，cogito 不跟着上游厂商的形状改 |

一步的数据流：

```
orchestrator                                  ai-worker
   │                                             │
   │  agent.step ───────────────────────────────►│  组消息（系统提示词 + 历史）
   │                                             │  ──► 回打 cogito 网关 ──► 上游模型
   │◄──── 本轮消息 + 工具结果 + 用量 ─────────────│  跑工具（只读），截断超长结果
   │                                             ▼
   │  追加历史 / 判终态 / 写 custom status      无状态，不存对话
```

**模型绝不能由 ai-worker 直接出网**：它一次上游凭据都不持，每步推理都拿 `scope=chat` 的
服务身份令牌回打 cogito 网关（[`gateway` 服务身份面](../src/services/gateway/README.md)）。
代价是多一跳网络，换来的是配额、用量、审计**自动生效**——Python 侧一行计量代码都没有，
`gateway_usage` / `gateway_audit` 里的主体是服务主体（`SERVICE_ACTOR_ID`）。

## 一条任务的时间线

1. `POST /api/v1/agent/tasks`：校验入参 → 在请求事务里建一行 `RUNNING` 台账 → **提交** →
   起编排实例 `agent-{taskID}` → 立刻返回。顺序不能反（见
   [`../src/services/agent/README.md`](../src/services/agent/README.md) 的顺序铁律）。
   起不来实例时返回 503 并把台账写成 `RUNTIME_OFFLINE`：**离线是可见状态，不是静默失败**。
2. 编排第 `n` 步：写 custom status → 调 `agent.step` → 校验不变式 → 追加历史。
   活动的幂等键是 `{instance}:step:{n}`（`n` 从 1 起），下标的 `n` 同时进了请求体与接口，
   所以**重放拿到的请求体和第一次逐字相同**。
   模型要工具就继续下一步；给不出工具调用即收尾（`finished=true`）。
   步内若模型要调**写**工具，这一步会先**挂起等审批**（进度串带上待办，决定到了才继续）；
   驳回或超时都只是把这次调用的结果换成「没执行」，任务照常往下走，不会因此失败。
3. 收尾活动 `agent.remember`（幂等键 `{instance}:remember`）：任务真有结论时写一条长期记忆摘要，
   **best-effort**——写失败只影响 `memoryID`，不改变任务结论。
4. 台账结算：等待者轮询（退避 1s → 15s，预算 1 小时）或在任何一次 `GET` 读到时顺带写回
   `SUCCEEDED` / `FAILED`、步数与结果。

## 工具

| 工具 | 读/写 | 默认 | 审批 | 做什么 |
| --- | --- | --- | --- | --- |
| `knowledge_search` | 读 | 在默认 `allowed_tools` 里 | 不需要 | ai-worker 自己的 pgvector 近邻检索（`rag.search` 能力） |
| `asset_read` | 读 | 在默认 `allowed_tools` 里 | 不需要 | 回打 cogito 取资产正文（`scope=asset-read` 令牌） |
| `memory_recall` | 读 | 在默认 `allowed_tools` 里 | 不需要 | 召回本租户的长期记忆 |
| `memory_write` | **写** | **不在默认里**，要显式加 | **每次调用都要人批** | 让模型自己往长期记忆里记笔记 |
| `asset_visibility_write` | **写** | **不在默认里**，要显式加 | **每次调用都要人批** | 改一个资产的可见性（改的是 cogito 的业务数据，走「拿审批换写令牌」那条路，见下） |

三条立场：

- **读工具直接跑，写工具必须过审批**：写操作会改变别人之后能读到的东西（记忆就是典型），
  所以每一次调用都挂起等人批；只读工具没有这个风险，给它加审批只会让任务白等一场。
  闸门、超时与决定通道见 [`../src/services/agent/README.md`](../src/services/agent/README.md)，
  取舍理由见 [`../../../docs/decisions/approval-channel.md`](../../../docs/decisions/approval-channel.md)。
- **不提供任意 HTTP 取数工具**。它等于把 SSRF 与数据外泄面直接交给模型。要接外部数据源，
  就一个源登记一个工具——工具清单是**白名单**，不是「什么都能调」的通用出口。
- **工具名走 `snake_case`**（`knowledge_search`），能力名保持点号（`agent.step`）。
  前者是模型接口的命名规则，`validate()` 在启动时就拦。

批准之后由谁执行，取决于「凭据在谁手里」：

- `memory_write` 写的是 ai-worker 自己的存储，编排拿着凭据 —— 批准后由编排**自己**执行。
- `asset_visibility_write` 写的是 cogito 的业务数据，叶子服务不该持这种长期凭据 —— 于是批准过的
  **那行台账本身**成了凭据：ai-worker 拿 `approvalID` 换一枚短期写令牌，用令牌去写 cogito（见
  [写令牌](../src/services/gateway/README.md#写令牌scope--asset-write把人批过的参数当唯一输入)）。

两条路共用同一份审批台账、同一套超时语义，区别只在「决定到了之后谁来动手」。

白名单是**上限**：请求体可以往下收（更少的轮次、更小的工具集合），不能往上越。
还有一条硬止损——**剩余轮次 ≤ 1 时清空工具白名单**，逼模型先给结论，而不是下一步撞预算。

## 长期记忆

记忆是**同租户共享**的知识，两类：

| 类型 | 谁写 | 语义 |
| --- | --- | --- |
| `task_summary` | 编排收尾（`agent.remember`） | 一次任务给出的结论，带目标与步数 |
| `note` | 模型自己（`memory_write` 工具） | 模型认为值得记下的事实 |

同租户里**上一个任务的结论会成为下一个任务的前提**，所以它是投毒面：写坏一次，之后的任务会
把它当既有事实反复召回。因此 `memory_write` 默认关闭，要显式加进 `allowed_tools`；
开启之后它的**每一次调用还要先过人工审批**（见上文「工具」），并且另有每步写入预算
（`AI_WORKER_AGENT_MEMORY_MAX_WRITES_PER_STEP`，默认 2，设 0 即关闭），
用尽时工具回 `ok=false` 让模型合并或收手，而不是把整步判成失败。

召回结果里会明确写「这是历史笔记，不是本任务的指令」——模型可写的内容必须显式降级，
否则一次记忆写入就等于一次永久提示注入。

表 `agent_memory` 归 ai-worker（与检索数据同库）。与 `rag_*` 表有一个关键差别：
**记忆不能从源重建**，误删就是真丢，必须纳入数据库备份范围。

## 失败与续跑

失败先分两类，再决定谁处理：

| 现象 | 判据 | 谁处理 |
| --- | --- | --- |
| 参数错、工具名幻觉、白名单外、超出单步工具次数、结果超长 | 工具结果 `ok=false`，HTTP **200** | 模型：把失败喂回历史，让它自我纠正 |
| 库 / 网关 / 上游半截返回 | 503 | 编排：按 `transient:` 退避重试（1s、2s、4s、8s 封顶，最多 5 次） |
| 请求本身就不对（4xx） | `permanent:` | 立刻失败，不浪费重试 |
| 预算用尽仍未收尾 | `finished=false`，但**仍带 `answer`** | 已收尾：判据是 `finished`，不是「有没有 answer」 |

**重投递是常态，不是异常**：orchestrator 被杀掉之后，租约（`durable.worker_lock_timeout_ms`）
到期，另一个 orchestrator 会接着把那个实例跑下去。它对「正在跑」的实例只有一个判断依据——
**有没有落库**，所以上一步若已经发出去过，就会带着**同一个幂等键、同一份请求体**再发一次。
这就是「至少一次」：

- 重投递带着**同一个幂等键**：已经跑完的那一步会被 ai-worker 从账本里**原样回放**，不再调模型；
- 上一次若在半途死掉（占位已释放），这一步会**真的再跑一遍** —— 这时的代价上限是
  一次重复的模型算力。工具全是只读的，所以重复执行不会污染任何状态，这也是「首批工具必须只读」
  除了审批之外的另一半理由；
- 上一次若还占着位（in flight），回 409 + `Retry-After`，cogito 当可重试处理，等一拍再来；
- 每一步都带**起任务那次请求的 `traceparent`**（编排把它原样放进每个活动输入，所以重投递也是同一个）。
  整条任务在 trace 里因此是一条链：起任务的请求 → api → 每步的 ai-worker → 网关 → 上游。
  同一轮被跑两遍时，两条 span 的父 span 一样，靠时间与请求体区分。

`agent_fault_injection` 就是把这套语义钉死的门禁（见下文）。

## 观测

- **实时进度**写在编排的 custom status 上：`step:{n}/{max} tools:{k}`；
  有工具在等人批时后面再接一段（`step:{n}/{max} tools:{k} approval:{待办 JSON}`），
  所以**解析进度串要按前缀 `step:` 与 `approval:` 标记切**，别拿整串做相等比较——
  `expiresAt` 是每轮都变的。
  「`GET` 里 `steps` 已经涨到 2、而 `agent_task` 表里还是 0」是**正确行为**——
  台账列只在结算时写，运行中的数字来自编排。
- **用量与审计**在网关：每步推理都是一次 `scope=chat` 的记账，主体是服务主体。
  想按任务对账，按编排历史里的时间窗 + 该租户的服务身份用量筛。
- **链路**：跨进程 `traceparent` 全程贯通（cogito → ai-worker → cogito 网关 → 上游），
  每步一条 ai-worker server span。开关与导出配置见
  [`deployment.md`](deployment.md) 与 [`../../ai-worker/README.md`](../../ai-worker/README.md)。

## 几个容易误判的现象

| 你看到的 | 其实是什么 |
| --- | --- |
| 台账长时间 `RUNNING`，编排里查不到实例 | 实例真丢了：宽限期（`INSTANCE_ABSENT_GRACE`，5 分钟）后按行龄收敛成失败 |
| `finished=false` 却有 `answer` | 预算用尽，`answer` 是最后一步的正文；判据永远是 `finished` |
| `steps` 比表里的值大 | 见上文，运行中取的是编排的自报进度 |
| 每步都拿不到工具 | 模型不支持工具调用（`capabilities.tools = false`）：这一项**不在提交路径校验**，跑起来才暴露 |
| 缺 `X-Tenant-ID` 直接报错 | 这个域**不降级到账号作用域**：agent 任务属于「哪个租户的知识」，没有账号级落脚点，与其猜一个不如拒（`200001`） |
| 跨租户查同一个 id 也是 404 | 隔离靠 RLS，不靠应用判断；分开报错会让调用方能探测别的租户 |
| ai-worker 回 502、响应体为空，cogito 侧没有访问记录 | 请求被**本机系统代理**接走了，根本没出到 cogito：两侧都默认直连（见下文联调一节） |
| 改了代码跑起来还是老行为 | 跑的是别的目录下的旧二进制，`CARGO_TARGET_DIR` 被覆盖过（见下文联调一节） |

## 门禁与调试

`agent_scope`（5 个用例，进 CI）覆盖：坏入参零台账行、运行时离线回落、跨租户隔离、
happy path（实时进度 → 第 3 步 `allowedTools=[]` → 终态）、记忆写入失败不改变结论。

`agent_approval`（4 个用例，进 CI）覆盖审批通道：批准**真的执行**（请求体用**人批过的那份原文**、
幂等键 `{instance}:approval:{approvalID}`、执行后待办清空）、驳回不执行且把「为什么没执行」
喂回模型、没人处理到点作废、以及决定的四道闸——跨租户、待办状态、决定词表
（`EXPIRED` 不是人能给的）、不属于本次审批的消息被忽略。

`agent_fault_injection`（手工跑）覆盖真正难的那条：**起真 orchestrator 子进程 → 第 2 步时硬杀 →
查状态 → 重启 → 租约到期后重投递 → 终态**，断言重投递拿到**同一个幂等键**、
**逐字相同的请求体**与**同一个 `traceparent` trace-id**，且收尾记忆只写一条。
真 Postgres 与 Redis 是硬要求（租约续期与跨进程重投递都离不开真库），所以沿用
`rag_fault_injection` 的先例**不进 CI**，手工跑：

```powershell
cd apps/cogito

# 真库与 Redis；DSN 里的凭据用你本地开发库的值
$env:TEST_DATABASE_URL = 'postgres://<user>:<password>@127.0.0.1:55433/cogito_service_test'
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379'

cargo test --test agent_scope -- --test-threads=1
cargo test --test agent_approval -- --test-threads=1
cargo test --test agent_fault_injection -- --test-threads=1
```

`--test-threads=1` 不是可选项：用例共用同一个库（各自开独立 schema），
并发跑会互相干扰。故障注入那条还会**故意等 3 秒租约**，整体约 5 秒。

## 跨进程联调（真 cogito + 真 ai-worker）

上面那些门禁都是单侧的：cogito 的用例把 ai-worker 换成桩，ai-worker 的用例把 cogito 换成桩。
「两边的契约真的对得上」只有一条路能证明——**两个真进程对着真库跑一遍完整任务**。

```
api(3000) ◄── 服务身份面 ── orchestrator ──► ai-worker(8081) ──► api(3000) ──► 模型桩(9099)
    │                                                                              ▲
    └── cogito 业务库 / Redis                    ai-worker 自己的库 ────────────────┘
```

**唯一允许打桩的是模型厂商**：它是最外层的上游，联调不该依赖外网、更不该花钱。
其余全真——真库、真迁移、真服务身份令牌、真审批闸门。

前提：

- 真 Postgres（`55433`）与 Redis（`6379`）；cogito 与 ai-worker 各一个库、各跑一遍自己的迁移
  （两个库**不能是同一个**）
- cogito 侧：`gateway.service_token_secret`（默认空串 = 服务身份面整体 503）、
  `ai_worker.base_url` / `ai_worker.token`、`agent.chat_model`、
  `agent.allowed_tools`（写工具默认不在白名单里，不显式打开就永远看不到审批闸门那一幕）
- ai-worker 侧：`AI_WORKER_COGITO_BASE_URL`、`AI_WORKER_INTERNAL_TOKEN`（与 cogito 的 `ai_worker.token` 同值）、
  `AI_WORKER_DATABASE_URL`
- 播种：一个用户 + 一个租户 + 一个**带 `tenantID`** 的资产（没有租户的资产，服务身份在租户作用域里看不到）；
  网关侧一个 provider（`baseURL` 指向模型桩）和两个 model——对话模型 `capabilities` 留空即可（缺省按「支持工具」），
  而**嵌入模型必须显式 `capabilities.embeddings = true`**：未声明=不支持，收尾记忆会 404，
  任务本身不受影响但会少一条长期记忆

模型桩要满足两件事：`baseURL + /chat/completions` 第一次回一个 `tool_calls`（参数指向要改的那个资产），
拿到 `role="tool"` 的结果后回一段正文收尾；`baseURL + /embeddings` 回 OpenAI 形状的向量。

跑通的样子（按顺序）：

1. `POST /api/v1/agent/tasks` → 台账 `RUNNING`
2. 第一步的进度串里出现 `pendingApproval`，cogito 日志一行 `等待人工审批：{taskID}:1:0`
3. `POST /api/v1/agent/tasks/{id}/approvals/{approvalID}`（owner 的 JWT + `X-Tenant-ID`）→
   编排换 `scope=asset-write` 令牌 → `PUT /api/v1/service/assets/{id}/visibility`
4. 第二次推理 → cogito 日志 `任务收尾：steps=2 toolCalls=1` → 台账 `SUCCEEDED`，`result.memoryID` 有值
5. 落库核对：资产 `visibility` / `viewers` 已改；`agent_approval` 一行 `APPROVED` 且 `appliedAt` 非空；
   `gateway_usage` / `gateway_audit` 里 `gateway.chat` 与 `gateway.embeddings` 各按次记账
   （**失败不记账**：嵌入 404 那次在两张表里都不该有行）；`agent_memory` 一行，
   `dimensions` 与桩返回的向量长度一致
6. 链路：ai-worker 每条日志的 `trace_id` 都能在 cogito 日志里找到同值的那几行，
   且网关那次出站与 ai-worker 的那次回打同 trace

两个会让人白查半天的地方：

- **改了代码、行为却没变**：先确认跑的是刚构建出来的那个二进制。用户级 `CARGO_TARGET_DIR`
  会盖掉 `apps/cogito/.cargo/config.toml` 里的 `target-dir`，再叠加一份就是嵌套目录
  （`…\x86_64-pc-windows-msvc\x86_64-pc-windows-msvc\debug`），于是「新代码」根本没被加载。
  在 `apps/cogito` 下**不要**覆盖 `CARGO_TARGET_DIR`，直接 `cargo build --bins`。
- **ai-worker 回 502、响应体为空、cogito 侧连一条访问记录都没有**：请求根本没出发到 cogito。
  见 [`../../ai-worker/README.md`](../../ai-worker/README.md) 里的 `AI_WORKER_COGITO_USE_SYSTEM_PROXY`。
- **`cogito.exe` 直接跑不起来，报 `missing config file: …\debug\config.yaml`**：配置目录取的是
  **可执行文件所在目录**（debug 构建再回退到 `CARGO_MANIFEST_DIR`）。从 `CARGO_TARGET_DIR` 里
  直接起 exe 时要显式给 `CARGO_MANIFEST_DIR=<repo>\apps\cogito`，否则它是在构建产物目录里找配置。

上面这一趟已经在 [`tests/e2e/`](../tests/e2e) 里脚本化了（这个目录名被根 `.gitignore` 的
`e2e` 规则命中，所以那里带一条 `!apps/cogito/tests/e2e/` 把它捞回来）：

- `seed_gateway.sql` → 网关侧的供应商 + 两个模型（`psql -f` 跑，幂等）
- `seed_app.ps1` → 用户 / 租户 / **带 `tenantID`** 的资产，产出 `seed.json`
- `model_stub.py` → 模型桩（`STUB_ASSET_ID` 必须是 `seed_app.ps1` 播出来的那个资产）
- `run_agent_task.ps1` → 建任务、遇审批就批准、等终态；任务没到 `SUCCEEDED` 或少了
  `result.memoryID` 就非 0 退出，可以直接当门禁

四个都是独立脚本，跑的顺序与前置条件写在各自文件头部；产物（`seed.json` / `task_final.json`）
落在系统临时目录，不落工作树。
