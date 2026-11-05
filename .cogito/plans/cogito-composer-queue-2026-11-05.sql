-- ============================================================================
-- cogito 客户端本地库：composer 队列持久化（新增表，不改任何在用表）
-- 目标库：%LOCALAPPDATA%\com.cogito.client\cogito-client.db
--         （macOS: ~/Library/Application Support/com.cogito.client/cogito-client.db
--          Linux: ~/.local/share/com.cogito.client/cogito-client.db）
--
-- 说明：
--   1. 幂等：全部 IF NOT EXISTS，可重复执行；不 DROP、不 UPDATE、不 ALTER，
--      既有 agent_session / agent_message / 其它表的数据一行不动。
--   2. 执行前先完全退出 cogito（WAL 模式下运行中的连接会挡住写入）。
--   3. 先备份三个文件：cogito-client.db、cogito-client.db-wal、cogito-client.db-shm。
--
-- 执行方式（任选其一）：
--   sqlite3 "%LOCALAPPDATA%\com.cogito.client\cogito-client.db" ".read cogito-composer-queue-2026-11-05.sql"
--   或用 DBeaver / Navicat / DB Browser for SQLite 打开库文件后整段运行。
-- ============================================================================

PRAGMA foreign_keys = ON;

BEGIN;

-- 队列条目：一条待发送的消息。
--   id          条目 id：沿用队列项的稳定 id（assistant-ui 的 QueueItemState.id）
--   sessionID   所属会话，级联删除（会话没了，队列也没有意义）
--   lane        'main' = 正常排队；'steer' = 插队立即发
--   sort        会话内顺序（0 起，reconcile 时按此重放）
--   text        composer 的线格式文本（chip 已序列化为 @path / @browser-<uuid>）
--   attachments 附件元数据 JSON 数组，默认 []
CREATE TABLE IF NOT EXISTS agent_composer_queue (
    id          TEXT    PRIMARY KEY NOT NULL,
    sessionID   TEXT    NOT NULL,
    lane        TEXT    NOT NULL DEFAULT 'main',
    sort        INTEGER NOT NULL DEFAULT 0,
    text        TEXT    NOT NULL,
    attachments TEXT    NOT NULL DEFAULT '[]',
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    FOREIGN KEY (sessionID) REFERENCES agent_session (id) ON DELETE CASCADE
);

-- 主查询就是「某个会话的全部条目，按 lane + sort 取」，索引直接覆盖它
CREATE INDEX IF NOT EXISTS idx_agent_composer_queue_sessionID
    ON agent_composer_queue (sessionID, lane, sort);

COMMIT;

-- ============================================================================
-- 执行后自检（人工核对，不改数据）
-- ============================================================================
-- 1) 表存在
-- SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_composer_queue';
-- 2) 列与类型
-- PRAGMA table_info('agent_composer_queue');
-- 3) 既有数据仍在（记住执行前后的数字，应当一致）
-- SELECT 'session' AS t, count(*) AS n FROM agent_session
-- UNION ALL SELECT 'message', count(*) FROM agent_message
-- UNION ALL SELECT 'queue',   count(*) FROM agent_composer_queue;
-- 4) 迁移标记没被动过（本轮不加迁移文件，这里应保持只有 0001）
-- SELECT version, name FROM migrations;

-- ============================================================================
-- 回滚（仅在需要彻底移除队列功能时使用）
-- ============================================================================
-- DROP TABLE IF EXISTS agent_composer_queue;
