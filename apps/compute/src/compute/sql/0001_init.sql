-- 0001_init：compute 自己的库表（开发阶段合并为单文件：原来的 0002 分块、0003 向量与索引、
-- 0004 长期记忆已并入下面的对应小节；正式发布前不再保留分支式的历史）。
--
-- 这套库里**只允许**出现 compute 自己的表：cogito 的业务表（asset/tenant/...）由 cogito 自己管，
-- 服务间只走契约里的三个端点 + 服务令牌 + 服务身份资产内容端点，绝不共享库。
--
-- 小节：
--   1 扩展        vector
--   2 幂等账本    idempotency_key
--   3 RAG 分块    rag_chunk_set / rag_chunk
--   4 RAG 向量与索引  rag_embedding / rag_index（P6b-4）
--   5 长期记忆    agent_memory（P9d）

CREATE EXTENSION IF NOT EXISTS vector;

-- ==========================================================================================
-- 2 幂等账本
-- ==========================================================================================
-- cogito 会因为超时/网络抖动重发同一个 Idempotency-Key，同一笔活不能干两遍：
--   * 同键同载荷 + completed  -> 直接回放上次的响应（不重复向量化/写索引）
--   * 同键不同载荷            -> 409 idempotency_conflict（复用键是调用方的 bug）
--   * 同键 in_progress        -> 409 并要求稍后重试；超过 stale 时限后允许接管，避免死键永久卡住
-- 主键用 (key, endpoint)：不同端点复用同一个键是合法用法。
CREATE TABLE IF NOT EXISTS idempotency_key (
    idempotency_key text        NOT NULL,
    endpoint        text        NOT NULL,
    payload_sha     text        NOT NULL,
    status          text        NOT NULL CHECK (status IN ('in_progress', 'completed')),
    response_status integer,
    response_body   jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (idempotency_key, endpoint)
);

-- 覆盖扫「进行中且已超时」的键，用于运维排查与将来的清理任务。
CREATE INDEX IF NOT EXISTS idempotency_key_status_updated_idx
    ON idempotency_key (status, updated_at);

-- ==========================================================================================
-- 3 RAG 分块
-- ==========================================================================================
-- 契约 `POST /internal/v1/assets/{assetID}/chunks` 只把「切了多少块 + 块集 id + 文本 sha」
-- 回给 cogito，**块正文留在 compute**。否则编排历史会被正文撑爆，重放成本也失控。
-- 所以「块集」是 compute 的一等实体：cogito 拿到的 chunkSetID 就是这里的 `chunk_set_id`，
-- 后续 embed / index 两步都只带这个 id，不再传文本。
--
-- 同一个资产可以被切多次（换了 chunkSize、换了抽取器、重跑一次新编排实例），
-- 每次都是一个新块集，互不覆盖 —— 索引侧的收敛由 chunkSetID 保证（P6b-4）。

CREATE TABLE IF NOT EXISTS rag_chunk_set (
    chunk_set_id   uuid        PRIMARY KEY,
    -- 租户只用于分区、排查与将来的清理任务，**不参与授权判定**：
    -- 授权完全来自 cogito 签发的服务身份令牌（作用域锁死租户与这一个资产）。
    tenant_id      text        NOT NULL,
    asset_id       uuid        NOT NULL,
    mime           text        NOT NULL,
    name           text,
    -- 抽取后纯文本的 sha256（十六进制）。与契约 `ChunkResponse.textSha` 同一口径：
    -- 用来回答「同一个资产两次切分是不是同一份文本」。
    text_sha       text        NOT NULL,
    chunk_count    integer     NOT NULL CHECK (chunk_count >= 0),
    -- 实际生效的分块参数（请求没给就用服务端默认值），排查「块为什么切这么碎」时要看它。
    chunk_size     integer     NOT NULL CHECK (chunk_size > 0),
    chunk_overlap  integer     NOT NULL CHECK (chunk_overlap >= 0),
    -- 实际选中的抽取器名（例如 `text` / `html` / `pdf`），排障时不用再猜走的是哪条分支。
    extractor      text        NOT NULL,
    -- 取到的正文字节数：`chunk_count = 0` 时这是第一个要看的数。
    source_bytes   integer     NOT NULL CHECK (source_bytes >= 0),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- 「这个租户的这个资产都切过哪些版本」——运维与将来的重建索引用。
CREATE INDEX IF NOT EXISTS rag_chunk_set_tenant_asset_idx
    ON rag_chunk_set (tenant_id, asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rag_chunk (
    chunk_set_id uuid    NOT NULL REFERENCES rag_chunk_set (chunk_set_id) ON DELETE CASCADE,
    -- 块在块集内的序号，从 0 开始。契约里的 `from`/`to` 区间就是它在数：
    -- 嵌入那一步按 `[from, to)` 分批重跑，序号必须稳定。
    ordinal      integer NOT NULL CHECK (ordinal >= 0),
    text         text    NOT NULL,
    -- 块在**抽取后纯文本**里的字符区间（含头不含尾）。正文会重叠，所以区间也重叠；
    -- 保留它是为了将来能把检索命中的块映射回原文位置（引用出处要用）。
    char_start   integer NOT NULL CHECK (char_start >= 0),
    char_end     integer NOT NULL CHECK (char_end >= char_start),
    PRIMARY KEY (chunk_set_id, ordinal)
);

-- ==========================================================================================
-- 4 RAG 向量与索引的当前版本（P6b-4）
-- ==========================================================================================
-- 三张表的分工：正文在 `rag_chunk`（小节 3）、向量在 `rag_embedding`、索引的「当前版本」在
-- `rag_index`。cogito 全程只看到 `chunkSetID` 与统计值 —— 向量一个字节都不经过它，
-- 这让「换嵌入模型 → 重新嵌入」变成 compute 内部的事，不必改契约、不必动编排历史。

CREATE TABLE IF NOT EXISTS rag_embedding (
    chunk_set_id uuid    NOT NULL REFERENCES rag_chunk_set (chunk_set_id) ON DELETE CASCADE,
    -- 与 `rag_chunk.ordinal` 同源：契约里的 `from`/`to` 区间数的就是它。
    -- 外键只挂到块集、**不挂到块**：块集重跑时会整批删块重写（见 store.save），
    -- 挂在块上会让向量在那一刻被级联删掉，而 cogito 那边嵌入这一步早就记成完成了。
    ordinal      integer NOT NULL CHECK (ordinal >= 0),
    -- 算这些向量的模型。进主键是为了「换模型」时新旧向量能并存，直到新模型全部嵌完；
    -- 被哪个模型服务由 cogito 的令牌作用域决定，这里只记录事实。
    model        text    NOT NULL,
    dimensions   integer NOT NULL CHECK (dimensions > 0),
    -- 故意**不写** `vector(1536)` 这类维度修饰符：维度由 cogito 指定的模型决定，一列装不下所有模型。
    -- 代价是这一列建不了 HNSW/IVFFlat（pgvector 要求索引列带维度），ANN 索引等检索面（P8）
    -- 定型后按 (model, dimensions) 分组再建 —— 现在建也是建在错的模型上。
    embedding    vector  NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chunk_set_id, ordinal, model),
    -- 维度是冗余列（上游响应里带回来的），冗余就必须自我校验，否则「dimensions 说 1536、
    -- 向量实际 1024」这种脏数据会一路带到检索侧才炸。
    CONSTRAINT rag_embedding_dimensions_match CHECK (vector_dims(embedding) = dimensions)
);

-- 检索索引的**当前版本**：一个资产一行。
--
-- 契约 `PUT /internal/v1/assets/{assetID}/index` 的要求是「重复提交同一个 chunkSetID 必须收敛：
-- 索引条数不叠加、旧版本被替换而不是并存」。把「当前版本」做成主键唯一的一行，这个要求
-- 就由表结构本身保证，而不是靠应用层记得先删后插。
CREATE TABLE IF NOT EXISTS rag_index (
    -- 租户进主键：即使将来资产 id 出现跨租户撞车，也不会互相覆盖。
    tenant_id   text    NOT NULL,
    asset_id    uuid    NOT NULL,
    chunk_set_id uuid   NOT NULL REFERENCES rag_chunk_set (chunk_set_id) ON DELETE CASCADE,
    model       text    NOT NULL,
    -- 允许 0：空资产（空文件、图片型 PDF）也要走这一步把旧版本替换掉，
    -- 此时 cogito 压根没跑嵌入循环，传下来的 dimensions 就是 0。
    dimensions  integer NOT NULL CHECK (dimensions >= 0),
    chunk_count integer NOT NULL CHECK (chunk_count >= 0),
    -- 索引名（本实现的集合粒度 = 单资产：`asset-<assetID>`）。存下来是为了让检索侧
    -- 不必自己拼、也为了让响应里的 `collection` 有据可查。
    collection  text    NOT NULL,
    -- 本次物化的时间（不是块集创建时间）：排查「为什么检索结果还是旧的」时先看它。
    indexed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, asset_id)
);

-- ==========================================================================================
-- 5 agent 长期记忆（P9d）
-- ==========================================================================================
-- 与 `rag_*` 三张表的关键区别：那些是**资产的派生数据**（源在 cogito，重建一次就有），
-- 而这一张是 agent 自己写下的结论，**没有可重建的源**——丢了就真丢了，
-- 所以它需要独立的备份策略（D8 的已知代价）。
--
-- 记忆是**租户内的共享知识**，不是某个人的私有便签：召回边界与 `rag_index` 完全一致
-- （tenant_id 进 WHERE 由库过滤）。同租户的另一个任务能读到本租户此前的结论，这正是
-- 「长期记忆」的意义（跨任务复用）；跨租户仍是硬边界。
--
-- 两处「幂等由表结构保证」，而不是靠应用记得先查一次：
-- * `memory_id` 是主键，id 由 `uuid5` **确定性**派生（见 memory.py）：收尾摘要按
--   `(tenant, task)`，模型的笔记按 `(tenant, content)` ⇒ 同一件事被重投、被接管续跑、
--   被两个任务先后写下，写的都是同一行，`ON CONFLICT DO NOTHING` 自然收敛，
--   不需要任何额外的唯一约束；
-- * 确定性也意味着「同一条笔记只留一行」：内容一模一样的两条笔记对召回毫无增量
--   （白占上下文），而措辞不同的笔记本来就是两条。

CREATE TABLE IF NOT EXISTS agent_memory (
    memory_id   uuid        NOT NULL,
    tenant_id   text        NOT NULL,
    -- 出处必须能区分：`task_summary` 是 cogito 在任务收尾时写的结论，`note` 是模型在任务
    -- 中途自己写的备忘。模型看到「这是此前任务的结论」与「这是我自己以前的笔记」，
    -- 对可靠性的判断完全不同，所以这个标签会原样进召回文本。
    kind        text        NOT NULL CHECK (kind IN ('note', 'task_summary')),
    -- 空白正文没有召回价值，直接拒绝（`btrim` 让「只有空格」也算空）。
    content     text        NOT NULL CHECK (length(btrim(content)) > 0),
    -- 写这条记忆的任务。`note` 也可能是 NULL：cogito 的单步端点载荷里没有 taskID
    -- （不给它加字段是为了不动 P9b 的幂等载荷），所以工具写的笔记只按租户与时间追溯。
    task_id     text,
    -- 嵌入模型与维度：召回必须与写入在同一个向量空间里，冗余列自我校验（同小节 4）。
    model       text        NOT NULL,
    dimensions  integer     NOT NULL CHECK (dimensions > 0),
    -- 同样**不写**维度修饰符：记忆与 RAG 共用一套嵌入模型配置，写死维度就换不了模型。
    -- 代价是这一列建不了 HNSW/IVFFlat，召回靠顺序扫描——记忆的条数比块少一个数量级，
    -- 且过滤条件能把候选集定到一个租户的一个模型下（同 P6b-4 的立场：真实分布出来再建）。
    embedding   vector      NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (memory_id),
    CONSTRAINT agent_memory_dimensions_match CHECK (vector_dims(embedding) = dimensions),
    -- 收尾摘要没有 task_id 就既无从幂等也无从追溯，这种组合直接拒绝；
    -- 反过来 `note` 允许 NULL（见上）。
    CONSTRAINT agent_memory_summary_needs_task
        CHECK (kind <> 'task_summary' OR task_id IS NOT NULL)
);

-- 召回的过滤条件：租户 + 向量空间。把 `model` 也放进索引是因为
-- 「同一个租户换过嵌入模型」是常态，那批旧模型下的记忆不该被扫到。
CREATE INDEX IF NOT EXISTS agent_memory_recall
    ON agent_memory (tenant_id, model);

-- 运维/审计方向的一条索引：排查「记忆投毒」时先问「这条任务是哪个任务写进去的」。
CREATE INDEX IF NOT EXISTS agent_memory_task
    ON agent_memory (tenant_id, task_id)
 WHERE task_id IS NOT NULL;
