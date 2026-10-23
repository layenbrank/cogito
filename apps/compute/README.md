# compute

`cogito`（Rust）的**叶子计算服务**。它不面向终端用户、不出网、不持有业务真值，只做两件事：

1. **RAG 摄取**：把 `cogito` 交给它的资产正文切成块、算嵌入、写进自己的向量库；
2. **agent 运行时**：跑「一步推理 + 工具」——多轮循环的宿主是 cogito 的可靠执行，
   这里只做无状态的单步（模型对话、工具执行、长期记忆收尾）。

服务身份、租户、资产、计费、对外 API 全部留在 `cogito`。compute 是纯函数式的算力车间：**输入是 cogito 给的数据 + 令牌，输出是结果 + 落库**。

```
        ┌──────────── cogito (Rust, 唯一对外 API) ────────────┐
        │  api  ·  orchestrator  ·  业务表  ·  gateway 出网  │
        └───────┬───────────────────────────────▲───────────┘
   X-Internal-Token + HTTP 调用                  │ HTTP 回打（取正文 / 要模型算力）
                ▼                               │
        ┌───────┴───────────────────────────────┴───────────┐
        │  compute (Python)   POST /internal/v1/rag/*      │
        │  ─ 自己的 Postgres schema（pgvector）              │
        │  ─ agent 单步与长期记忆：/internal/v1/agents/*     │
        │  ─ 不直连 cogito 的业务库，不持有业务真值             │
        └───────────────────────────────────────────────────┘
```

## 契约

**唯一契约源是 `apps/service/spec/internal.yaml`**（OpenAPI）。本服务只实现其中列出的路径与字段，
既不新增对外路径，也不吞掉未知字段。`cogito` 侧的实现见 `apps/service/src/clients/compute.rs`，
两侧不一致时**以 `spec/internal.yaml` 为准**。

除契约中明确允许的五条例外，compute **不得**对 cogito 发起任何其他请求：

| 用途 | 端点 | 鉴权 |
| --- | --- | --- |
| 换取短期服务令牌 | `POST /api/v1/service/token` | `X-Internal-Token` |
| 读取资产正文 | `GET /api/v1/service/assets/{assetID}/content` | `X-Service-Token`（`scope=asset-read`） |
| 请求嵌入算力 | `POST /api/v1/service/embeddings` | `X-Service-Token`（`scope=embeddings` + `model`） |
| 请求对话 / 工具模型算力 | `POST /api/v1/service/chat/completions` | `X-Service-Token`（`scope=chat` + `model`） |
| 按审批改动资产可见性 | `PUT /api/v1/service/assets/{assetID}/visibility` | `X-Service-Token`（`scope=asset-write` + `approvalID`） |

第四条是 agent 运行时的腿：**模型绝不能由本服务直接出网**，一步推理就是一次 `scope=chat` 的网关调用，
所以配额、用量、审计在 Python 侧不写一行代码也自动生效。

第五条是唯一一条写链路，且**写请求没有 body**：「改什么」由 cogito 从人工审批台账里读出来、在签发令牌时
钉进 claims，compute 只是拿审批号换一枚一次一用的写令牌。因此这条路径可以随时被吊销在审批侧，而不是
靠 Python 侧自觉只发「被批准的那次改动」。

### 两种令牌，别搞混

- **`X-Internal-Token`**：compute → cogito 的「我是内部服务」声明。值 = cogito 配置里的
  `compute.token`（cogito 侧由 `src/guards/service.rs::verify_internal` 比对）。
- **`X-Service-Token`**：cogito 签发的短期服务令牌，**由 compute 用上面那把令牌去换**。
  换来的令牌带 `scope` / `tenantID` / `assetID` / `approvalID` / `ttlSecs`，只能用于对应端点和对应受众
  （一件受众一件事，跨端点即 401）。compute **不需要**也不应该拿到 `gateway.service_token_secret`。

## 目录

```
src/compute/
├── __main__.py        # 入口：uvicorn.run(create_app(...))，无 import 期副作用
├── app.py             # create_app(settings)：装配中间件与路由
├── config.py          # Settings（pydantic-settings，前缀 COMPUTE_，可选 .env）
├── errors.py          # 统一错误体 {error:{code,message}} 与错误码枚举
├── trace.py           # W3C traceparent 解析/生成 + ContextVar（内置，默认路径）
├── telemetry.py       # OTel 装配：server/client span + OTLP/HTTP 导出（默认关闭）
├── logging_setup.py   # JSON 行日志（带 trace_id）
├── middleware.py      # 裸 ASGI 中间件：内部令牌闸门 + traceparent
├── db.py              # asyncpg 连接池 + pgvector 注册
├── migrations.py      # 启动时按 sql/NNNN_*.sql 顺序迁移
├── idempotency.py     # Idempotency-Key 预定/重放/冲突
├── capabilities.py    # 能力注册表（健康探针据此上报）
├── cogito_client.py     # 唯一的出站客户端：token / 资产正文 / 嵌入
├── api/
│   └── health.py      # GET /internal/v1/health
├── rag_ingest/
│   ├── extract.py     # MIME → 纯文本（plain / json / html / pdf）
│   ├── chunking.py    # 纯函数切块器：尽量落在段落/句子边界，块可回溯原文偏移
│   ├── store.py       # 块集/块/向量/索引落库（按 chunk_set_id 与 (tenant, asset) 幂等覆盖）
│   ├── schemas.py     # 请求/响应模型
│   ├── router.py      # POST /internal/v1/assets/{assetID}/chunks
│   ├── embed.py       # POST /internal/v1/assets/{assetID}/embeddings
│   └── index.py       # PUT  /internal/v1/assets/{assetID}/index
├── providers/
│   └── embeddings.py  # 上游嵌入响应的严格校验与分批
├── sql/
│   ├── 0001_init.sql  # 迁移脚本（随包分发）
│   ├── 0002_rag_chunk.sql
│   ├── 0003_rag_embedding.sql
│   └── 0004_agent_memory.sql
└── agent_runtime/
    ├── __init__.py    # 分工说明与包边界（本包只做「一步」，循环在 cogito）
    ├── schemas.py     # 契约形状（单步请求/响应、记忆请求/响应）
    ├── dialogue.py    # 契约的扁平消息 ↔ OpenAI 线格式；上游响应解析
    ├── tools.py       # 工具登记表、参数校验、失败语义、结果截断、写预算
    ├── router.py      # POST /internal/v1/agents/steps、/agents/tool-executions
    └── memory.py      # 长期记忆：存取与召回、摘要组装、POST /internal/v1/agents/memories
```

## 本地开发

```bash
cd apps/compute
uv sync                                  # 建 .venv 并装依赖（含 dev 组）
cp .env.example .env                     # 按需改端口/令牌
uv run compute                         # 监听 :8081
```

测试需要一个**带 pgvector 的 Postgres**：

```bash
docker run -d --name compute-test-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=compute_test \
  -p 55433:5432 pgvector/pgvector:pg18

uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run mypy
```

默认测试库是 `postgres://postgres:postgres@127.0.0.1:55433/compute_test`，
可用 `COMPUTE_TEST_DATABASE_URL` 覆盖。连不上数据库时测试会 **skip 并说明原因**，而不是假装通过。

## 与 cogito 联调

两个进程、两个库：cogito 连着业务库（`database.url`），compute 连着自己那个带 pgvector 的库。
**compute 不直连 cogito 的业务库**，这条边界由 `tests/test_db_boundary.py` 反证（库里只有
`OWNED_TABLES` 那几张表）。

两侧的取值必须对上，对不上就是 401/503，而且报错信息不会告诉你「是哪一个没对上」：

| compute 侧 | cogito 侧 | 说明 |
| --- | --- | --- |
| `COMPUTE_INTERNAL_TOKEN` | `compute.token` | 请求头 `X-Internal-Token` 的值（cogito `config.yaml` 默认 `change-me-internal-token`；生产禁用占位值） |
| `COMPUTE_COGITO_BASE_URL` | `server.port` | cogito 默认监听 3000（**不是** 8080，8080 是 gocaptcha 侧车） |
| —— | `gateway.service_token_secret` | 必须显式给值：`config.yaml` 默认空串 = `/api/v1/service/**` 整体 503 |

第三个必填项 `COMPUTE_DATABASE_URL` 没有对应的 cogito 配置：它就是 compute 自己的库，
**不能**填成 cogito 的业务库。

还有一条不在这张表里、但能让人排查很久的开关：`COMPUTE_COGITO_USE_SYSTEM_PROXY`（默认 `false`）。
关着时回打 cogito 的请求一律直连——httpx 除了读 `HTTP_PROXY` 这类环境变量，在 Windows 上还会读
**注册表里的系统代理**，本机代理软件（如 `127.0.0.1:7892`）会把内网地址一起接走，症状是
compute 拿到 **502 且响应体为空**，而 cogito 侧连一条访问记录都没有（请求根本没到）。cogito 侧
对应的开关是 `compute.use_system_proxy`，默认同样是直连。

```bash
# ── cogito ──（cwd: apps/service）
cp config.local.yaml.example config.local.yaml   # 至少填 gateway.service_token_secret
cargo run -p migration -- up
cargo run --bin cogito                          # :3000

# ── compute ──（cwd: apps/compute）
uv sync
cp .env.example .env                             # 填三个必填项：内部令牌 / 自己的库 / cogito 基址
uv run compute                                 # :8081
```

先看 compute 自己活没活（`capabilities` 里应出现 `rag.chunk` / `rag.embed` / `rag.index` /
`rag.search` / `agent.step` / `agent.memory`）：

```bash
curl -s -H 'X-Internal-Token: change-me-internal-token' http://127.0.0.1:8081/internal/v1/health
```

再打一条真实的摄取链路。注意 `Idempotency-Key` 有 **8–200 字符**的长度约束，太短会得到 400；
`tenantID` / `assetID` 由 cogito 在编排里传下来，这里手工发就得自己编。前提是 cogito 的库里
**已经有一个带正文的资产**，且 cogito 的 gateway 能真的连上嵌入模型（`compute.embed_model`，
默认 `text-embedding-3-small`）——否则第三步（嵌入）会卡在上游：

```bash
ASSET=8f14e45f-ceea-467a-9a3e-1b7c2d5e9f01
H=(-H 'X-Internal-Token: change-me-internal-token'
   -H 'Idempotency-Key: local-run-0001'
   -H "traceparent: 00-$(openssl rand -hex 16)-$(openssl rand -hex 8)-01"
   -H 'Content-Type: application/json')

# 1) 切块：正文由 compute 反向调 cogito 的 /api/v1/service/assets/{id}/content 取
curl -s "${H[@]}" -X POST "http://127.0.0.1:8081/internal/v1/assets/$ASSET/chunks" \
  -d '{"schemaVersion":1,"tenantID":"tenant-a","mime":"text/plain","name":"local.txt"}'

# 2) 嵌入：以返回的 chunkSetID / chunkCount 继续（区间左闭右开，to 必须大于 from）
SET=$(...); N=$(...)
curl -s "${H[@]}" -X POST "http://127.0.0.1:8081/internal/v1/assets/$ASSET/embeddings" \
  -d "{\"schemaVersion\":1,\"tenantID\":\"tenant-a\",\"chunkSetID\":\"$SET\",\
\"model\":\"text-embedding-3-small\",\"from\":0,\"to\":$N}"

# 3) 落索引
curl -s "${H[@]}" -X PUT "http://127.0.0.1:8081/internal/v1/assets/$ASSET/index" \
  -d "{\"schemaVersion\":1,\"tenantID\":\"tenant-a\",\"chunkSetID\":\"$SET\",\
\"chunkCount\":$N,\"model\":\"text-embedding-3-small\",\"dimensions\":1536}"
```

带同一个 `Idempotency-Key` 再发一次第二步，会回 200 且 `embedded == 0`（幂等命中，不重复计费、
不重复写库）——这条不是猜的，`tests/test_contract_conformance.py` 把它钉住了。

真实联调的推荐姿势不是手工 curl，而是让 **cogito 自己发起**：起 `cargo run --bin orchestrator`
（长任务宿主）后触发 `rag.index-asset` 编排，它会按 `compute.embed_batch_size` 分批调
compute，进度写进 custom status（`chunked:<n>` / `embedded:<to>` / `indexed`）。

agent 那条链路的完整一趟（服务身份令牌 → 审批闸门 → 写工具 → 收尾记忆）连同要看的观测点，
写在 [`../service/guide/agent-runtime.md`](../service/guide/agent-runtime.md) 的「跨进程联调」一节。

> 仓库里的 `apps/service/tests/rag_index.rs` 用的是 `StubCompute` 桩，**跨语言真实报文漂移它抓不到**；
> 下面两个测试文件补的就是这个空档。

### 契约一致性（`tests/test_contract_conformance.py`）

直接读 cogito 的契约文件 `apps/service/spec/internal.yaml`（`SPEC_PATH` 从仓库根定位），用
`referencing.Registry` + `jsonschema.Draft202012Validator` 校验 compute 的真实响应报文：

- 状态码必须在该操作的 `responses` 里（多一个没声明的码就红）；
- 报文必须过对应 schema（`$ref` 指向 `#/components/schemas/*`）；
- 错误体的 `code` 必须是 `errors.ErrorCode` 认识的码；
- cogito 真实发出的请求体必须先过 `ChunkRequest` / `EmbedRequest` / `IndexRequest` / `AgentStepRequest`；
- 有一组**自检**用例专门证明这套校验器抓得住错形状——否则 schema 一变宽松，整组测试会静默空转。

契约文件不在（比如只 checkout 了 `apps/compute`）时整个文件 **skip**，不假装通过。

### 跨进程链路贯通（`tests/test_trace_handoff.py`）

用一个记账桩记录**每一次**出站请求带的 `traceparent`，断言：trace-id 与采样标记与入站一致、
每次出站的 span-id 都是全新的（既不复用入站的，彼此也不重复）。这条断言就是「cogito 的链路
真的接到了 compute，再接到 compute 打回 cogito 的那一跳」的机器判据；缺 `traceparent`
的请求必须 400 **且一个字节都不出网**。

## agent 运行时

**这里只做「一步」，循环的宿主是 cogito 的可靠执行**（一步一个活动：重投能收敛、进度可写进
custom status、重试粒度最细）。所以本服务不持有对话状态，三个端点都由 cogito 发起：

| 端点 | 做什么 | 发起方 |
| --- | --- | --- |
| `POST /internal/v1/agents/steps` | 一步：组消息（系统提示词 + 历史）→ 回打 cogito 网关调模型 → 跑本轮工具 → 回「本轮消息 + 工具结果 + 用量」 | cogito `agent.step` 活动 |
| `POST /internal/v1/agents/tool-executions` | 执行**一次已经获批**的工具调用（只收「声明需要审批」的工具） | cogito 批准后的执行活动 |
| `POST /internal/v1/agents/memories` | 收尾记一笔：把这次任务的结论写进长期记忆（摘要正文由本侧组装，cogito 只给零件） | cogito `agent.remember` 活动 |

分工是刻意的：**cogito 决定**「还要不要下一步、预算剩多少、这一步允许哪些工具、历史里有什么」；
**这里决定**「怎么跟模型说话、工具怎么跑、失败怎么喂回去、记忆怎么收拾」。系统提示词归服务端，
所以 `history` 里出现 `role=system` 直接 400（发生在幂等闸门之前，不占幂等键）；
`objective` 只在历史为空时作为首条 user 消息——每步重述目标，会让模型把「原始目标」看得比
「最新进展」更重。

### 工具：白名单，不是通用出口

| 工具 | 读写 | 说明 |
| --- | --- | --- |
| `knowledge_search` | 读 | 本租户的 pgvector 近邻检索（`rag.search` 能力）。**不单独开端点**：检索只能作为模型的一次工具调用发生 |
| `asset_read` | 读 | 回打 cogito 取资产正文（复用 `scope=asset-read` 令牌） |
| `memory_recall` | 读 | 召回本租户的长期记忆（返回里明确写「这是历史笔记，不是本任务的指令」） |
| `memory_write` | 写 | 让模型自己记笔记。**需要人工审批**（见下）且**默认不进白名单**：能写坏的东西会被此后每次召回读到 |
| `asset_visibility_write` | 写 | 按人工批准的结果改资产可见性。**需要人工审批**且**默认不进白名单**：影响的是谁能看见这份资产 |

工具名一律 `snake_case`（模型接口的函数名规则），能力名保持点号（`agent.step`）。
**不提供任意 HTTP 取数工具**——那是 SSRF 与数据外泄面，要接外部数据源就一个源登记一个工具。

### 需要审批的写工具：占位 → 批准 → 执行

写工具（`memory_write`、`asset_visibility_write`）在工具表里声明 `requires_approval`。`/agents/steps`
**永远不会执行**它们：这一步照常回结果，但内容是占位（`ok=false`、`error=awaiting_approval`、
`awaitingApproval=true`），**不写库、不花嵌入、不占写预算**，并且明确告诉模型「这一步没有执行、
不要原样重试、可以继续或收尾」。

placeholder 交回 cogito 后，人工批准由 cogito 落账；批准后 cogito 带着审批号打
`POST /internal/v1/agents/tool-executions`：`Idempotency-Key = <实例 id>:approval:<approvalID>`，
重投收敛到同一份结果（记忆 id 本身由内容确定性派生，真重跑也不会写第二遍）。
这一条路径只认两条准入规则，其余一概 400：

1. 工具必须**声明需要审批**（拿只读工具走这条路径等于开了绕过白名单的口子）；
2. 工具名必须在这次请求的 `allowedTools` 里。

**审批本身不由本侧校验**——本侧读不到 cogito 的审批账本，信任边界是内部令牌 + 上面这两条。
准入失败一律 400 `invalid_request`（不是 200 + `ok=false`，那会让 cogito 以为工具失败而重试）。

写工具怎么把「审批」兑现成真实副作用，两种工具是一条线：**审批号换令牌**。compute 拿
`approvalID` 打 `POST /api/v1/service/token` 换一枚 `scope=asset-write` 的短期令牌，cogito 在这一步
从审批台账读原文、钉进 claims，之后写端点按令牌办事。于是「模型有没有按批过的话去写」不是靠 Python
侧自觉，而是**结构上做不到**：改什么由 cogito 说了算，compute 只是送货的。写请求不带 body，并且
`403 + 500509`（审批过期、被驳回、批的不是这个资产）被翻成 400 的终局拒绝，让工具把 `ok=false`
喂回模型而不是让 cogito 一遍遍重试同一个永远不会通过的写。

失败分级（结果形状都是 200 + 该条 `ok=false`，让模型自我纠正，不是把整步判失败）：

- 参数错 / 工具名幻觉 / 白名单外；
- 单步工具调用次数超上限 `COMPUTE_AGENT_MAX_TOOL_CALLS_PER_STEP`（默认 8）——超出的调用不执行，
  只回失败结果，让模型下一轮再补；
- 结果超过 `COMPUTE_AGENT_TOOL_RESULT_MAX_CHARS`（默认 8000）被截断。

只有库、网关、上游半截返回才向上抛（503，可重试）。模型在没有工具可用时仍要工具（幻觉）时，
本侧剥掉调用、判 `finished=true` 并保留正文，而不是把幻觉写进历史。

### 长期记忆

`agent_memory`（pgvector 同库，见 `sql/0004_agent_memory.sql`）只存两类，靠 `CHECK` 分开：
`task_summary`（任务结论，必须有 `taskID`）与 `note`（模型笔记，必须没有）。主键由内容确定性
派生（`uuid5`），所以重投同一个任务是「读回既有那行」，不重复嵌入、不重复计费。

写预算 `COMPUTE_AGENT_MEMORY_MAX_WRITES_PER_STEP`（默认 2，设 0 即关闭写入）用尽时回
`ok=false`，让模型合并或收手。批准后的执行**同样**受这条开关约束——审批通道不是绕过运维开关的路子。
**记忆是投毒面**：同租户里上一个任务的结论会成为下一个任务的前提，
写坏一次会被反复召回，所以写入必须由运维显式启用。
记忆**不能从源重建**（与 `rag_*` 表不同），要纳入备份范围——见 cogito 侧的
[`guide/configuration.md`](../service/guide/configuration.md)。

### 手工打一条

前提：cogito 已起（`:3000`）、`gateway.service_token_secret` 有值、`agent.chat_model` 指到的模型
**支持工具调用**，否则每步都拿不到工具。`Idempotency-Key` 同样受 8–200 字符约束：

```bash
curl -s -H 'X-Internal-Token: change-me-internal-token' \
  -H 'Idempotency-Key: local-step-0001' \
  -H "traceparent: 00-$(openssl rand -hex 16)-$(openssl rand -hex 8)-01" \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8081/internal/v1/agents/steps \
  -d '{"schemaVersion":1,"tenantID":"tenant-a","objective":"总结本租户的入职文档",
       "model":"deepseek-chat","embedModel":"text-embedding-3-small",
       "history":[],"allowedTools":["knowledge_search"],"remainingSteps":3}'
```

`finished=false` 且 `message.toolCalls` 非空即「还要下一轮」：把这一轮的消息与工具结果追加进
`history` 再发一次就是第二步——cogito 的编排就是这么做的，整条链路（含进度、续跑、记忆）见
[`apps/service/guide/agent-runtime.md`](../service/guide/agent-runtime.md)。

审批通道同理，只是要带上审批号（`approvalID` 与 `taskID` 都是必填）：

```bash
curl -s -H 'X-Internal-Token: change-me-internal-token' \
  -H 'Idempotency-Key: local-approval-0001' \
  -H "traceparent: 00-$(openssl rand -hex 16)-$(openssl rand -hex 8)-01" \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8081/internal/v1/agents/tool-executions \
  -d '{"schemaVersion":1,"tenantID":"tenant-a","taskID":"<任务 id>","approvalID":"<审批 id>",
       "embedModel":"text-embedding-3-small","allowedTools":["memory_write"],
       "toolCall":{"id":"call-1","name":"memory_write","arguments":"{\"content\":\"运费由买家承担。\"}"}}'
```

## 链路追踪接入（OTel → OTLP/HTTP）

**默认关闭**：`COMPUTE_TELEMETRY_ENABLED=false` 时进程里不注册任何 OTel 全局状态、不联网，
跨进程仍靠内置的 W3C 实现透传 `traceparent`（`trace.py`），行为与接入前逐字一致。

打开后与 cogito 共用一套约定（参照实现：`apps/service/src/utils/telemetry.rs`）：

| 项 | 取值 | 为什么 |
| --- | --- | --- |
| 资源 | `service.name` / `service.version` / `deployment.environment.name` | 后端按它筛服务与版本 |
| 采样 | `ParentBased(TraceIdRatioBased)` | 上游已定就跟随上游，只有根 span 才掷骰子 |
| 传播 | W3C `traceparent` | cogito 发来的 span-id 成为本进程 server span 的父 span |
| 导出 | OTLP/HTTP `POST {endpoint}/v1/traces` | 与 cogito 送到同一个 collector |

- **server span**：按「方法 + 路径」命名（`GET /internal/v1/assets/{id}/chunks`），带
  `http.request.method` / `url.path` / `http.response.status_code`；**5xx 记 Error，4xx 只记属性**
  （调用方的问题不该让 trace 里满屏红色）。
- **client span**：每次出站（换服务令牌 / 取正文 / 要嵌入算力 / 要对话算力）各开一个，且**线路上的
  `traceparent` 就是导出 span 自己的标识** —— Jaeger 里的父子关系与 cogito 收到的头是同一份事实。
- **响应头仍然回入站原值**（cogito 的日志按它对上）：回显语义归 `trace.py`，OTel 只多导出一份。
- 健康探针没有上游链路，自成一条根 span，不会给后端塞悬空的父 span。

本地想看一条真实的跨语言 trace（已并进仓库根的 `compose.yaml`）：

```bash
docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:2.9.0
# compute 侧：COMPUTE_TELEMETRY_ENABLED=true，ENDPOINT 用 http://127.0.0.1:4318
# cogito 侧同步打开，UI 在 http://127.0.0.1:16686
```

## 设计决策

**为什么是独立的 uv 项目，而不是 uv workspace？**
本目录只有一个包。uv workspace 的价值在多包共享一把 `uv.lock`，单包时只剩一层间接；
等到 `providers` 之类需要拆包时再升格，成本很低（加一行 `[tool.uv.workspace]`）。
它同样**不进 pnpm workspace**（`pnpm-workspace.yaml` 里显式 `!apps/compute`），
理由与 `apps/service` 一致：Python 的依赖由 uv 管，混进 pnpm 只会让两边都变脆。

**为什么不用 Alembic？**
compute 的表是自己的私有数据（幂等表、块表、向量表），schema 变更只有 compute 一个消费者，
不需要「离线生成 diff / 分支合并」这类协作能力。按 `sql/NNNN_*.sql` 顺序执行 + `schema_migration`
记账（40 行）就够，且迁移在启动时完成、多副本用 `pg_advisory_xact_lock` 串行化。
反过来说，`cogito` 的业务迁移仍然用它自己那套（`apps/service/migration`），两边互不知情。

**为什么不引入 LangChain / LangGraph？**
agent 运行时要的三件事都已经有主：循环宿主是 cogito 的 durable 编排（`/agents/steps` 只跑一步）、
持久化是 duroxide + Postgres、审批闸门在编排里，而厂商适配与密钥在 cogito 的 `gateway`。
更硬的一条：`langchain` 1.x **直接依赖 `langgraph`**，连 `langgraph-checkpoint` / `langgraph-sdk`
都是必装，「只用抽象、不碰编排」这个折中不存在。所以这一层是自持的薄运行时（`agent_runtime/`，
约 1,950 行，运行期依赖只有 pydantic / httpx 与契约本身）。
完整取舍（候选对照、会破掉的不变量、推翻条件）见
[`no-langchain.md`](../../docs/decisions/no-langchain.md)。

**为什么健康探针不探测 cogito？**
`spec/internal.yaml` 的边界规则是「除五条例外，compute 不得对 cogito 发起任何请求」——
健康探针每几秒一次，会稳稳地把这条规则压成噪音。而且方向本就该反过来：**cogito 探 compute**
（`ComputeClient::health`），compute 只在被探时如实上报自己这一侧的状态。
RAG 与 agent 的每次出站都是 cogito 发起的编排活动，cogito 拿不到令牌 / 网关 503 时编排自己会失败重试，
compute 只是没被调用而已——替它报 `degraded` 是假信号。
探针返回 `ok` 或 `degraded`；**自己这一侧**（数据库、pgvector 扩展）坏掉时回 **503**，
响应体仍是契约里的同一 schema，具体哪一项坏了写进日志，不写进响应体。

**为什么能力注册表从空列表长成这样？**
能力要能被 cogito 的编排按名字发现，而「注册了但没实现」的功能会让编排跑到一半才发现 404。
所以注册表是**显式登记**的：P6b-2 为空，P6b-3 登记 `rag.chunk`，P6b-4 登记 `rag.embed`、`rag.index`，
P9b/P9d 登记 `agent.step`、`agent.memory`（外加作为工具发生的 `rag.search`）。
`agent.memory` 的**写**路径同样只由 cogito 的编排驱动（`agent.remember` 收尾活动）——
它不是一个对外开放的记忆写入接口，而是任务收尾的一步。

**幂等为什么要落库？**
编排会重试活动。同一个 `Idempotency-Key` 重放必须返回**和第一次完全相同**的结果
（包括那次分配的 `chunkSetID`），否则重试会在向量库里留下两套平行数据。
所以先 `INSERT` 预定，跑完后把状态与响应体写回；同键不同载荷 → 409，同键仍在跑 → 409 + `Retry-After`。

**`chunkSetID` 为什么是推导出来的，而不是随机生成？**
`uuid5(endpoint, 幂等键, 载荷指纹)`。这样「块已经写进库、账本那一行还没写、进程被杀」的半截状态
会在重跑时落到**同一个** `chunkSetID` 上：`store.save()` 按 `chunk_set_id` 覆盖写，自己把半截数据修好。
用随机 id 的话，接管者只能看出「这行卡住了」，没法知道上一次写的是哪一份。
载荷指纹取的是**生效后**的参数（省略 `chunkSize` 与显式写默认值视为同一个请求），
否则 cogito 少带一个可选字段就会被判成 409。

**嵌入为什么按区间分批，而不是一次把整个资产发过去？**
一个资产的块可能有上千个，一次性发过去的响应体又大又慢，上游超时会把整批算力都作废。
分批之后每批算完就落库，超时重试时**只补缺**（`rag_embedding` 里已有的 `(chunk_set_id, ordinal, model)`
不再重算），重试成本随进度递减。批大小看 `COMPUTE_EMBED_BATCH_SIZE`。
分批的边界是**块序号区间**（`from` / `to`），cogito 的编排也用同样的区间做活动幂等键
（`<instance>:embed:0-16`），所以「同一段区间重放」天然对上。
响应里回 `embedded: 0` 表示「这次没有算新东西、全是复用」——cogito 只看 `from` / `to` / `dimensions`
是否与请求一致，不看 `embedded`，所以**重放时回 0 是安全的**。

**为什么模型名要写进令牌，而不是只写进请求体？**
令牌的 `scope=embeddings` + `model` 一起构成「这枚令牌只能用来算这个模型」。
不然一枚令牌可以拿去调任何模型，模型维度不同就直接污染向量表。
令牌的缓存键也是 `(scope, tenant, asset, model)`，换模型 = 换令牌 = 重新签一次。

**上游响应为什么要严格校验，而不是「拿不到就跳过」？**
向量维度一旦写错，会静静地在库里留下一批没法检索的数据，事后只能全量重算。
所以 `providers/embeddings.py` 逐条核对 `index` 去重与越界、逐条量向量长度、拒绝 `NaN` / `Inf`，
任何形状不对就当**上游故障**（503，可重试），维度真的不一致就当**请求问题**（400，不重试）。

**为什么向量表的维度用 `CHECK (vector_dims(embedding) = dimensions)` 钉住，而不是建表时写死 `vector(1536)`？**
同一个库要装多个模型的向量，`vector(1536)` 会把表锁死在单一模型上。
用「每行自带 `dimensions` + CHECK 自洽」换来多模型共存，代价是 ANN 索引要按 `(model, dimensions)`
分组建（部分索引），这件事留给 P8 按真实数据分布做。

**为什么 `rag_embedding` 不建外键指向 `rag_chunk`？**
重跑分块层时 `store.save()` 会**整批重插**块（先删后插），带 `ON DELETE CASCADE` 的话
已经算好的向量会被连带删掉 —— 而这些向量的值只跟文本有关，跟块行的物理 id 无关。
所以这里刻意不建外键，用 `(chunk_set_id, ordinal)` 做逻辑关联。

**为什么 `rag_index` 的主键是 `(tenant_id, asset_id)`？**
「索引」描述的是资产**当前**这一版块集，不是历史快照。主键落在资产上，
「重复提交收敛到一行」和「旧版本被新版本替换」就是表结构自带的性质，
不需要应用层先删后插，也永远不会出现两行互相矛盾。
块数为 0 的资产同样要写这一行 —— 那是「这一版没有任何块了」的正式声明，不能靠删行表达。

**`collection` 为什么是 `asset-<assetID>`？**
它是向量库那边的一级命名空间。派生而非随机，是为了让「同一资产的块永远落在同一个 collection」
不依赖任何一张表；等 P8 接外部向量库时，它同时也是可直接使用的物理名。

**为什么切块要记 `char_start` / `char_end`？**
检索命中后要能把块定位回原文，高亮和「引用出处」都靠这两个偏移。
所以切块器不"重排"文本：块文本必须是原文的连续子串，块与块之间可以不重叠，但不能凭空造字。

**为什么中间件用裸 ASGI 而不是 `BaseHTTPMiddleware`？**
`BaseHTTPMiddleware` 会把请求体与下游执行挪进anyio 的独立 task，
`ContextVar` 的写入不会传回给路由处理函数 —— trace_id 会静默丢失。
裸 ASGI 中间件在同一个任务里跑，`ContextVar` 正常传播。

**为什么接了 OTel 还要留着内置的 W3C 实现（`trace.py`）？**
内置实现不是"备用方案"而是**默认路径**：它保证没接 collector 的部署、以及全部单元测试，
行为与接入前逐字一致；同时让「`traceparent` 的校验规则」和「响应头回显」只有一份来源。
OTel 打开后 `trace.py` 照旧负责 400 判定与回显，OTel 只负责多导出（并把出站头指向导出的 span）。

## 部署要点

- **不暴露到公网**：只监听内网地址；`X-Internal-Token` 是共享密钥，泄漏即等于拿到内部调用权。
- **反向依赖**：需要 Postgres（16+，带 pgvector 扩展）。`cogito` 与 compute 必须用**各自独立的库/账号**，
  边界由测试钉住（`tests/test_db_boundary.py` 断言 compute 的库里没有 cogito 的业务表）。
- **迁移失败 = 降级运行，不是启动失败**：进程照常起来，`/internal/v1/health` 回 503 `degraded`；
  探针每几秒重试一次连接并重跑迁移（迁移在 `pg_advisory_xact_lock` 下串行化，重复执行安全）。
  配置改对后不用重启容器就能自愈。**但「降级」不等于「可用」**：业务路由在池没起来时一律 503，
  不会带着半截 schema 提供服务；迁移一旦真的失败（例如 SQL 报错），日志里会有完整原因。
- **OpenAPI / docs 关闭**：`docs_url` / `redoc_url` / `openapi_url` 全为 `None`；
  契约以 `apps/service/spec/internal.yaml` 为唯一来源，避免出现第二份会漂移的定义。
- **追踪是可选依赖**：只有 `COMPUTE_TELEMETRY_ENABLED=true` 才需要 collector 可达；导出是
  后台批量的，collector 挂掉只丢 span、不影响业务。`COMPUTE_TELEMETRY_ENDPOINT` 不带路径时
  自动补 `/v1/traces`，带了路径就按原样用（collector 挂在网关后面时用得上）。
