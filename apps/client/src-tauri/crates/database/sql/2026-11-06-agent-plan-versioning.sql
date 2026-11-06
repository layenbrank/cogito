-- ============================================================================
-- cogito 客户端本地库（SQLite）· 2026-11-06 表结构变更补丁
-- 目标：把「今天改过的表」补到已有机库上，**现有数据一条不动**。
--
-- 变更来源（本仓库提交）：
--   9c309c28  11-06 13:40  fix(agent): 缓存落盘治理、拦截与截图修复、计划版本化
--       agent_plan + "executedRevision" INTEGER NULL   上次「开始执行」用的是第几版
--       agent_plan + "supersededBy"     INTEGER NULL   被哪一版取代（旧版归档）
--   2861c4a5  11-06 00:29  feat(agent): 对话面板打磨
--       agent_goal + "expectedPrompt"   TEXT    NULL   最近一轮自动续跑发出的 prompt
--
-- 为什么这样写是安全的：
--   * 全部是 ALTER TABLE ... ADD COLUMN（在表尾追列），
--     不建表 / 不改列类型 / 不删列 / 不重建表 —— 既有行、索引、触发器、外键原样保留；
--   * 新列都可空且无 DEFAULT 回填，老行读出来是 NULL，代码侧按 Option 处理，
--     语义正好是「还没执行过 / 没被取代」；
--   * 三段 DDL 包在一个事务里，中途失败整体回滚，不会留下半截结构。
--
-- 幂等性（重要）：
--   SQLite **没有** `ADD COLUMN IF NOT EXISTS`。三种跑法挑一种：
--   1) sqlite3 CLI（推荐）：默认遇错继续，列已存在只打 `duplicate column name`，
--      不会影响数据：  sqlite3 <db> ".read <本文件>"
--   2) GUI（DBeaver / Navicat / DataGrip）：先执行「第 0 步 体检」，
--      看清楚缺哪列，再把缺的那几条 ALTER 单独执行；
--   3) 什么都不做：客户端下次启动时 `migration.rs::ensure_agent_plan()`
--      会按 pragma 判缺列自动补 —— 这个文件就是那份代码补丁的手工版。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 第 0 步 · 体检（只读，先跑这个，确认要改什么）
-- ---------------------------------------------------------------------------
-- 0.1 当前列清单
SELECT 'agent_plan' AS tbl, name, type FROM pragma_table_info('agent_plan');
SELECT 'agent_goal' AS tbl, name, type FROM pragma_table_info('agent_goal');

-- 0.2 缺列报告：1 = 已有，0 = 缺（缺的要执行下面的 ALTER）
SELECT
  (SELECT count(*) FROM pragma_table_info('agent_plan') WHERE name = 'executedRevision') AS has_executedRevision,
  (SELECT count(*) FROM pragma_table_info('agent_plan') WHERE name = 'supersededBy')     AS has_supersededBy,
  (SELECT count(*) FROM pragma_table_info('agent_goal') WHERE name = 'expectedPrompt')   AS has_expectedPrompt;

-- 0.3 变更前的行数（改完用同样的语句对比，数字必须一模一样）
SELECT 'agent_plan' AS tbl, count(*) AS rows_before FROM agent_plan
UNION ALL
SELECT 'agent_goal', count(*) FROM agent_goal;


-- ---------------------------------------------------------------------------
-- 第 1 步 · 备份（任选其一，强烈建议先做）
-- ---------------------------------------------------------------------------
-- 1.1 文件级备份（先退出客户端，避免 WAL 未 checkpoint）：
--     copy "%LOCALAPPDATA%\com.cogito.client\cogito-client.db" ^
--          "%LOCALAPPDATA%\com.cogito.client\cogito-client.db.20261106-180000.bak"
-- 1.2 SQL 级备份（SQLite 3.27+；必须在事务外执行）：
--     VACUUM INTO 'D:/backup/cogito-client-20261106.db';


-- ---------------------------------------------------------------------------
-- 第 2 步 · 补列（本次变更的全部内容）
-- ---------------------------------------------------------------------------
PRAGMA foreign_keys = OFF;   -- 加列不动外键；个别驱动开着 ON 会拒绝 DDL
BEGIN IMMEDIATE;

-- 2.1 计划版本化：上次开始执行时的 revision（NULL = 还没执行过）
ALTER TABLE agent_plan ADD COLUMN "executedRevision" INTEGER NULL;

-- 2.2 计划版本化：被哪一版取代（done / interrupted 的旧版在改版时归档）
ALTER TABLE agent_plan ADD COLUMN "supersededBy" INTEGER NULL;

-- 2.3 今天凌晨那批（多数库这时已经有了，缺了才取消注释）：
-- ALTER TABLE agent_goal ADD COLUMN "expectedPrompt" TEXT NULL;

COMMIT;
PRAGMA foreign_keys = ON;


-- ---------------------------------------------------------------------------
-- 第 3 步 · 校验（列在、行数不变、老数据仍可读）
-- ---------------------------------------------------------------------------
SELECT name, type, "notnull", dflt_value
FROM pragma_table_info('agent_plan')
WHERE name IN ('executedRevision', 'supersededBy');      -- 期望 2 行

SELECT 'agent_plan' AS tbl, count(*) AS rows_after FROM agent_plan
UNION ALL
SELECT 'agent_goal', count(*) FROM agent_goal;          -- 与 0.3 必须一致

SELECT id, "sessionID", revision, "executedAt", "executedRevision", "supersededBy"
FROM agent_plan
ORDER BY "updatedAt" DESC
LIMIT 5;                                                -- 老行新列为 NULL，其余字段原样


-- ---------------------------------------------------------------------------
-- 第 4 步 ·（可选）老数据语义回填
-- ---------------------------------------------------------------------------
-- 代码里 `revision > executedRevision` 表示「计划改过、上次执行基于旧版」。
-- 老行没有这个信息，两种取值选一个：
--   a) 保持 NULL —— 老计划永不触发「改过了」提示，等价于版本化之前的行为（默认，推荐）
--   b) 视作「执行的即当前版」—— 只有确认这些老计划没被改过才这么填：
-- UPDATE agent_plan
--    SET "executedRevision" = revision
--  WHERE "executedAt" IS NOT NULL AND "executedRevision" IS NULL;


-- ---------------------------------------------------------------------------
-- 第 5 步 · 回滚（需要 SQLite 3.35+，DROP COLUMN 是 3.35 才有的）
-- ---------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE agent_plan DROP COLUMN "executedRevision";
-- ALTER TABLE agent_plan DROP COLUMN "supersededBy";
-- COMMIT;
-- 3.35 以下只能按「12 步重建」来做：新建 agent_plan_new（不含两列）→
-- INSERT INTO ... SELECT 列白名单 → DROP 旧表 → RENAME。数据同样不丢。


-- ---------------------------------------------------------------------------
-- 附：新库等价 DDL（仅供对照 / migrate:fresh，不要在有数据的库上跑这段的 DROP）
-- ---------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS agent_plan (
--   id TEXT PRIMARY KEY NOT NULL,
--   sessionID TEXT NOT NULL,
--   title TEXT NOT NULL DEFAULT '',
--   overview TEXT NOT NULL DEFAULT '',
--   steps TEXT NOT NULL DEFAULT '[]',
--   body TEXT NOT NULL DEFAULT '',
--   status TEXT NOT NULL DEFAULT 'draft',
--   source TEXT NOT NULL DEFAULT 'thread',
--   "filePath" TEXT NULL,
--   revision INTEGER NOT NULL DEFAULT 1,
--   digest TEXT NOT NULL DEFAULT '',
--   truncated INTEGER NOT NULL DEFAULT 0,
--   "createdAt" INTEGER NOT NULL,
--   "updatedAt" INTEGER NOT NULL,
--   "executedAt" INTEGER NULL,
--   "finishedAt" INTEGER NULL,
--   "executedRevision" INTEGER NULL,
--   "supersededBy" INTEGER NULL
-- );
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_plan_sessionID ON agent_plan (sessionID);
-- CREATE INDEX IF NOT EXISTS idx_agent_plan_updatedAt ON agent_plan ("updatedAt");
