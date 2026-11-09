-- ============================================================================
-- cogito 客户端本地库（SQLite）· 2026-11-09 表结构变更补丁
-- 目标：给 agent_session 追加「已读 / 未读」列，**现有数据一条不动**。
--
-- 变更内容（唯一一条 DDL）：
--   agent_session + unread INTEGER NOT NULL DEFAULT 0
--       0 = 已读（默认值；历史会话补列时一律回填成这个值，不会升级完满屏未读点）
--       1 = 这一轮跑完但用户还没打开过（左栏那一行点个圆点）
--
-- 为什么这样写是安全的：
--   * 只 ALTER TABLE ... ADD COLUMN（在表尾追列）：不建表 / 不改列类型 / 不删列 /
--     不重建表 —— 既有行、索引（idx_agent_session_workspaceID / idx_agent_session_updatedAt）、
--     触发器、外键原样保留；
--   * NOT NULL DEFAULT 0 让既有行一次回填到位，不需要 UPDATE 兜底；
--   * DDL 包在事务里，中途失败整体回滚，不会留下半截结构。
--
-- 库文件位置（`storage.rs::database_path()` = <app_local_data_dir>/cogito-client.db）：
--   正式包：%LOCALAPPDATA%\com.cogito.client\cogito-client.db
--   dev（pnpm dev:client:isolated）：
--           %LOCALAPPDATA%\com.cogito.client.dev\cogito-client.db
--   Windows 上是 C:\Users\<你>\AppData\Local\...；上面两个目录可能都存在，按你实际在跑的那个改。
--
-- 两种跑法等价，二选一：
--   1) 手工执行本文件（第 1 步）；
--   2) 什么都不做：客户端下次启动时 migration.rs::ensure_agent_session() 会按
--      pragma_table_info 判缺列自动补 —— 本文件就是那段代码补丁的手工版。
--      两边都做也不会坏：谁先跑谁生效，另一个只会报 duplicate column name。
--
-- 幂等性（重要）：SQLite **没有** ADD COLUMN IF NOT EXISTS。
--   * sqlite3 CLI（推荐）：默认遇错继续，列已存在只打 `duplicate column name`，
--     不影响数据：  sqlite3 <db> ".read <本文件>"
--   * GUI（DBeaver / Navicat / DataGrip）：先跑「第 0 步 体检」，缺列才执行第 1 步。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 第 0 步 · 体检（只读，先跑这个，确认要改什么）
-- ---------------------------------------------------------------------------
-- 0.1 当前列清单（期望末尾追加一条 unread；在此之前不应有 unread 行）
SELECT 'agent_session' AS tbl, name, type, "notnull", dflt_value
FROM pragma_table_info('agent_session');

-- 0.2 缺列报告：1 = 已有，0 = 缺（0 才需要执行第 1 步）
SELECT (SELECT count(*) FROM pragma_table_info('agent_session') WHERE name = 'unread') AS has_unread;

-- 0.3 变更前的行数（改完用同样的语句对比，数字必须一模一样）
SELECT count(*) AS rows_before FROM agent_session;


-- ---------------------------------------------------------------------------
-- 第 1 步 · 加列
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE agent_session ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;

COMMIT;


-- ---------------------------------------------------------------------------
-- 第 2 步 · 验证（三条都要对）
-- ---------------------------------------------------------------------------
-- 2.1 has_unread 必须是 1
SELECT (SELECT count(*) FROM pragma_table_info('agent_session') WHERE name = 'unread') AS has_unread;

-- 2.2 unread 必须是 INTEGER、NOT NULL、默认 0
SELECT name, type, "notnull", dflt_value
FROM pragma_table_info('agent_session')
WHERE name = 'unread';

-- 2.3 rows_after 必须等于第 0.3 步的 rows_before；unread_after 首次执行应为 0
SELECT count(*) AS rows_after,
       sum(CASE WHEN unread = 1 THEN 1 ELSE 0 END) AS unread_after
FROM agent_session;


-- ---------------------------------------------------------------------------
-- 附：手工验证「未读」是不是真的会被点亮 / 熄灭（可选）
-- ---------------------------------------------------------------------------
-- 把最近一条会话手工标成未读，回到应用里应看到左栏那一行出现圆点；
-- 点开它（切过去）之后圆点消失，且库里应该把 unread 写回 0。
--   UPDATE agent_session SET unread = 1 WHERE id = '把会话 id 粘在这里';
--   SELECT id, title, unread FROM agent_session ORDER BY unread DESC, "updatedAt" DESC LIMIT 10;
--
-- 注意：不要为了这条手工实验去 UPDATE "updatedAt" ——「已读 / 未读」是阅读状态，
-- 服务端 update_one 特意不为它推进 updatedAt（否则每点开一次会话，左栏就重排一次）。
