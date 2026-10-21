-- 首次 initdb（空 data/postgres）时执行；已有数据目录不会再跑。
--
-- POSTGRES_DB=cogito-service 会在官方入口里先建业务库；这里再幂等补一次，
-- 并创建 ai-worker 专用库。
--
-- ai-worker 连的必须是它**自己的**库：cogito 的业务表绝不进这里，两边只走
-- spec/internal.yaml 声明的那些端点（服务令牌 + 内部令牌）。这条边界由
-- apps/ai-worker/tests/test_db_boundary.py 反证（库里只该有 OWNED_TABLES 那几张表）。
--
-- vector 扩展不在这里建：ai-worker 的 0001_init.sql 自己 CREATE EXTENSION（建在它自己的库里），
-- 业务库要向量类型时由 cogito 的迁移自己声明。
SELECT 'CREATE DATABASE "cogito-service"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cogito-service')\gexec

SELECT 'CREATE DATABASE ai_worker'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_worker')\gexec
