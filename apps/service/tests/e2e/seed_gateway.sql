-- 网关侧播种：一个指向本地模型桩的供应商 + 两个模型（对话 + 嵌入）。
--
-- 为什么手工插而不是走管理接口：联调不该依赖管理员账号，也不该让 AES 密钥参与进来
-- （`apiKeyEnc` 留空 = 无密钥，桩不做鉴权，与 ollama 同一口径）。
--
-- 两个模型的能力声明**故意不同**，这是联调最容易漏的一处：
--   * 对话模型不写 capabilities —— 缺省按「支持工具」处理，写工具的审批闸门才看得到；
--   * 嵌入模型必须写 {"embeddings": true} —— 未声明 = 不支持，收尾写长期记忆会 404
--     （任务本身不受影响，但 `result.memoryID` 缺失、`agent_memory` 少一行）。
--
-- 幂等：ID 固定，重复跑只是覆盖回同一份值；固定 ID 也方便对着日志和 DB 核对。
-- 平台级行（tenantID = NULL）对全部租户可见。
--
-- `row_security = off`：这两张表带强制租户策略，而播种是「平台级」的操作，
-- 用 postgres 或表属主跑时显式关掉行安全，免得策略把 NULL 租户的行判成不可写。
-- 在线路径的策略不受影响——这只作用于本脚本这一条连接。

SET row_security = off;

INSERT INTO gateway_provider (id, "tenantID", kind, name, "baseURL", "apiKeyEnc", status, "createdAt", "updatedAt")
VALUES ('11111111-1111-4111-8111-111111111111', NULL, 'openai', 'e2e-stub',
        'http://127.0.0.1:9099/v1', '', 'ACTIVE', now(), now())
ON CONFLICT (id) DO UPDATE
    SET kind = EXCLUDED.kind,
        name = EXCLUDED.name,
        "baseURL" = EXCLUDED."baseURL",
        "apiKeyEnc" = EXCLUDED."apiKeyEnc",
        status = EXCLUDED.status,
        "updatedAt" = now();

INSERT INTO gateway_model (id, "providerID", "tenantID", name, label, enabled, "dailyTokenQuota",
                           capabilities, "createdAt", "updatedAt")
VALUES
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', NULL,
     'e2e-stub-model', 'E2E stub chat', true, 0, NULL, now(), now()),
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', NULL,
     'text-embedding-3-small', 'E2E stub embedding', true, 0, '{"embeddings": true}', now(), now())
ON CONFLICT (id) DO UPDATE
    SET "providerID" = EXCLUDED."providerID",
        name = EXCLUDED.name,
        label = EXCLUDED.label,
        enabled = EXCLUDED.enabled,
        capabilities = EXCLUDED.capabilities,
        "updatedAt" = now();
