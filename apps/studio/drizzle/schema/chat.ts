import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core'

/**
 * Chat 域：chatProvider / chatSession / chatMessage（studio 主进程自有，非 Tauri 共享实体）。
 *
 * 与 assistant-ui 持久化契约对齐（见 docs/architecture.md / task_plan D6）：
 * - `format` 是 MessageFormatAdapter 的格式标识，`content` 是它 `encode()` 的产物（不透明字符串）。
 *   两者构成消息的唯一真源；推理过程、工具调用、附件都在 `content` 的载荷里，
 *   因此**不再单列 `thinking` / `parts`**（旧 ai 域那样存会造成双轨）。
 * - `parentID` 是分支指针（assistant-ui 历史适配器的 `parent_id`）：编辑/重生成产生兄弟分支。
 *
 * 时间戳统一 `timestamp_ms`（Date ↔ INTEGER 毫秒），与同为主进程自有的 auth 表一致。
 */

/** apiKey 不落库（存 plugin-store / safeStorage），渲染进程只拿元数据 */
export const chatProvider = sqliteTable(
  'chatProvider',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    baseUrl: text('baseUrl'),
    /** JSON 数组文本：模型条目（`@cogito/agent/provider` 的 `ModelEntry`）；早期只存模型名，读取时归一 */
    models: text('models'),
    /** 该 provider 的默认模型 */
    model: text('model'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull()
  },
  function (table) {
    return [index('idx_chatProvider_kind').on(table.kind)]
  }
)

export const chatSession = sqliteTable(
  'chatSession',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /** 会话默认 provider；provider 被删则置空（会话保留） */
    providerID: text('providerID').references(
      function () {
        return chatProvider.id
      },
      { onDelete: 'set null' }
    ),
    /**
     * 归属的工作区：左栏按它归拢会话（对齐 Qoder 的「一个项目一撮任务」）。
     *
     * **刻意不加外键**：SQLite 的 `ALTER TABLE ADD COLUMN` 带不出 `ON DELETE`，
     * 而没有 `SET NULL` 的外键会把「删工作区」变成报错；
     * 重建表又会在事务里隐式 `DELETE FROM`，把会话的消息 CASCADE 掉。
     * 这里只需要一个分组指针 —— 工作区没了就是「未关联工作区」，由 `thread-groups` 兜底。
     */
    workspaceID: text('workspaceID'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull()
  },
  function (table) {
    return [
      index('idx_chatSession_updatedAt').on(table.updatedAt),
      index('idx_chatSession_providerID').on(table.providerID),
      index('idx_chatSession_workspaceID').on(table.workspaceID)
    ]
  }
)

export const chatMessage = sqliteTable(
  'chatMessage',
  {
    id: text('id').primaryKey(),
    sessionID: text('sessionID')
      .notNull()
      .references(
        function () {
          return chatSession.id
        },
        { onDelete: 'cascade' }
      ),
    /** 自引用：删除一条消息会连带删除其后续分支 */
    parentID: text('parentID').references(
      function (): AnySQLiteColumn {
        return chatMessage.id
      },
      {
        onDelete: 'cascade'
      }
    ),
    /** MessageFormatAdapter 标识，参与契约，不可改名 */
    format: text('format').notNull(),
    /** `fmt.encode()` 产物 */
    content: text('content').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull()
  },
  function (table) {
    return [
      index('idx_chatMessage_sessionID').on(table.sessionID),
      index('idx_chatMessage_parentID').on(table.parentID),
      index('idx_chatMessage_createdAt').on(table.createdAt)
    ]
  }
)

/**
 * 用量账本：**每次运行一条**，只增不改（studio 主进程自己记账）。
 *
 * 为什么不复用消息里的 usage：那条路（`metadata.custom.usage`）由 assistant-ui 的历史适配器
 * 落库，而**取消时它会把最后一轮的结果丢掉**（见 `packages/chat/src/adapters/chat-model.ts`），
 * 用户中途点停同样花了钱。账本由引擎在 `settle()`（终态唯一汇聚点）写，与渲染进程的
 * 消息快照解耦；`runID` 唯一约束让重复结算无害。
 *
 * `sessionID` / `providerID` **刻意不加外键**：账本要落得下、也要留得住 ——
 * 会话或 provider 被删不该让历史用量消失，会话行还没落库也不该让这次记账失败。
 * 聚合按 `sessionID` 匹配即可（与 `chatSession.workspaceID` 同样的取舍）。
 *
 * 时间戳 `timestamp_ms`（本地时区），「今日」按本地零点切。
 */
export const chatUsage = sqliteTable(
  'chatUsage',
  {
    id: text('id').primaryKey(),
    /** 渲染进程为每次运行生成的 uuid：一次运行只记一条 */
    runID: text('runID').notNull(),
    /** 归属的 studio 会话（线程）；未知时为 null，仍计入今日合计 */
    sessionID: text('sessionID'),
    providerID: text('providerID').notNull(),
    model: text('model').notNull(),
    /** 计费归属：`platform`（组织网关，服务端也会计数）/ `local`（自带密钥、本机运行时） */
    source: text('source').notNull(),
    /** 终态：`finish` / `aborted` / `error` —— 后两者同样花钱 */
    outcome: text('outcome').notNull(),
    inputTokens: integer('inputTokens').notNull().default(0),
    outputTokens: integer('outputTokens').notNull().default(0),
    totalTokens: integer('totalTokens').notNull().default(0),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull()
  },
  function (table) {
    return [
      uniqueIndex('idx_chatUsage_runID').on(table.runID),
      index('idx_chatUsage_sessionID').on(table.sessionID),
      index('idx_chatUsage_createdAt').on(table.createdAt)
    ]
  }
)
