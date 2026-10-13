//! 路由常量 — module.rs 与 OpenAPI path doc 共用，防止路径漂移。

pub struct RouteDef {
    pub method: &'static str,
    pub path: &'static str,
}

// --- 系统 ---
pub const HEALTH: &str = "/api/health";
/// 存活探针：只证明进程活着，不触碰任何依赖（依赖故障不该触发重启）
pub const LIVE: &str = "/api/live";
/// 就绪探针：能否接流量，关键依赖故障时 503
pub const READY: &str = "/api/ready";

// --- Auth ---
pub const AUTH_CAPTCHA: &str = "/api/v1/auth/captcha";
pub const AUTH_OTP: &str = "/api/v1/auth/otp";
pub const AUTH_SIGNIN: &str = "/api/v1/auth/signin";
pub const AUTH_SIGNIN_PHONE: &str = "/api/v1/auth/signin/phone";
pub const AUTH_SIGNIN_EMAIL: &str = "/api/v1/auth/signin/email";
pub const AUTH_SIGNUP: &str = "/api/v1/auth/signup";
pub const AUTH_PROFILE: &str = "/api/v1/auth/profile";
pub const AUTH_SIGNOUT: &str = "/api/v1/auth/signout";
pub const AUTH_PASSWORD_FORGOT: &str = "/api/v1/auth/password/forgot";
pub const AUTH_PASSWORD_RESET: &str = "/api/v1/auth/password/reset";
pub const AUTH_PASSWORD: &str = "/api/v1/auth/password";

// --- User ---
pub const USERS: &str = "/api/v1/users";
pub const USERS_BY_ID: &str = "/api/v1/users/{id}";

// --- Upload ---
pub const UPLOAD_PREPARE: &str = "/api/v1/upload/prepare";
pub const UPLOAD_HASH: &str = "/api/v1/upload/hash";
pub const UPLOAD_CHUNK: &str = "/api/v1/upload/chunk";
pub const UPLOAD_FINALIZE: &str = "/api/v1/upload/finalize";
pub const UPLOAD_PROGRESS: &str = "/api/v1/upload/progress/{id}";
pub const UPLOAD_CANCEL: &str = "/api/v1/upload/cancel/{id}";
pub const UPLOAD_FILES: &str = "/api/v1/upload/files";
pub const UPLOAD_FILES_BY_HASH: &str = "/api/v1/upload/files/{hash}";
pub const UPLOAD_ASSET: &str = "/api/v1/upload/asset/{id}";

// --- Engine ---
pub const ENGINE_SUGGESTION: &str = "/api/v1/engine/suggestion";

// --- Application ---
pub const APPLICATION_TO_READ: &str = "/api/v1/application/toRead";

// --- Tenant ---
pub const TENANTS: &str = "/api/v1/tenants";
pub const TENANTS_BY_ID: &str = "/api/v1/tenants/{id}";
pub const TENANT_MEMBERS: &str = "/api/v1/tenants/{id}/members";
pub const TENANT_MEMBER_BY_ID: &str = "/api/v1/tenants/{id}/members/{userID}";
pub const TENANT_SUBSCRIPTIONS: &str = "/api/v1/tenants/{id}/subscriptions";
pub const TENANT_SUBSCRIPTION_BY_ID: &str = "/api/v1/tenants/{id}/subscriptions/{subscriptionID}";
pub const TENANT_QUOTA: &str = "/api/v1/tenants/{id}/quota";
pub const TENANT_AUDIT: &str = "/api/v1/tenants/{id}/audit";
pub const TENANT_AUDIT_EXPORT: &str = "/api/v1/tenants/{id}/audit/export";
pub const TENANT_PAY_CATALOG: &str = "/api/v1/tenants/{id}/pay/catalog";
pub const TENANT_PAY_ORDERS: &str = "/api/v1/tenants/{id}/orders";
pub const TENANT_PAY_ORDER_BY_NO: &str = "/api/v1/tenants/{id}/orders/{orderNo}";
pub const TENANT_PAY_ORDER_SYNC: &str = "/api/v1/tenants/{id}/orders/{orderNo}/sync";
pub const TENANT_PAY_ORDER_CLOSE: &str = "/api/v1/tenants/{id}/orders/{orderNo}/close";
pub const PAY_NOTIFY_WECHAT: &str = "/api/v1/pay/notify/wechat";
pub const PAY_NOTIFY_ALIPAY: &str = "/api/v1/pay/notify/alipay";

// --- Billing（计费运维面，仅平台 ADMIN） ---
pub const BILLING_PRICES: &str = "/api/v1/billing/prices";
pub const BILLING_PRICES_BY_ID: &str = "/api/v1/billing/prices/{id}";
pub const BILLING_RECONCILIATION: &str = "/api/v1/billing/reconciliation";
pub const BILLING_RECONCILIATION_EXPORT: &str = "/api/v1/billing/reconciliation/export";

// --- Gateway ---
pub const GATEWAY_CHAT: &str = "/api/v1/gateway/chat/completions";
pub const GATEWAY_MODELS: &str = "/api/v1/gateway/models";
pub const GATEWAY_PROVIDERS: &str = "/api/v1/gateway/providers";
pub const GATEWAY_PROVIDERS_BY_ID: &str = "/api/v1/gateway/providers/{id}";
pub const GATEWAY_ADMIN_MODELS: &str = "/api/v1/gateway/admin/models";
pub const GATEWAY_ADMIN_MODELS_BY_ID: &str = "/api/v1/gateway/admin/models/{id}";
pub const GATEWAY_USAGE: &str = "/api/v1/gateway/usage";
pub const GATEWAY_AUDIT: &str = "/api/v1/gateway/audit";
pub const GATEWAY_AUDIT_EXPORT: &str = "/api/v1/gateway/audit/export";
pub const GATEWAY_QUOTA_ME: &str = "/api/v1/gateway/quota/me";
pub const GATEWAY_PLANS: &str = "/api/v1/gateway/plans";

// --- Service（服务身份出站面，非用户面） ---
pub const SERVICE_TOKEN: &str = "/api/v1/service/token";
pub const SERVICE_EMBEDDINGS: &str = "/api/v1/service/embeddings";
pub const SERVICE_CHAT: &str = "/api/v1/service/chat/completions";
pub const SERVICE_ASSET_CONTENT: &str = "/api/v1/service/assets/{id}/content";
pub const SERVICE_ASSET_VISIBILITY: &str = "/api/v1/service/assets/{id}/visibility";

// --- Agent（租户级自治 agent，需 JWT + X-Tenant-ID） ---
pub const AGENT_TASKS: &str = "/api/v1/agent/tasks";
pub const AGENT_TASK_BY_ID: &str = "/api/v1/agent/tasks/{id}";
pub const AGENT_TASK_APPROVAL: &str = "/api/v1/agent/tasks/{id}/approvals/{approvalID}";

// --- RAG（索引任务，需 JWT + X-Tenant-ID） ---
pub const RAG_INDEX_TASKS: &str = "/api/v1/rag/index-tasks";
pub const RAG_INDEX_TASK_BY_ID: &str = "/api/v1/rag/index-tasks/{id}";

// --- Chat（会话同步，需 JWT + X-Tenant-ID） ---
/// 同一个资源两种方法：POST 推一批，GET 拉增量。
pub const CHAT_SYNC: &str = "/api/v1/chat/sync";

// --- MCP（JSON-RPC 端点，需 JWT + X-Tenant-ID） ---
pub const MCP: &str = "/api/v1/mcp";

// --- SSO ---
pub const SSO_CONNECTIONS: &str = "/api/v1/sso/connections";
pub const SSO_CONNECTIONS_BY_ID: &str = "/api/v1/sso/connections/{id}";
pub const SSO_AUTHORIZE: &str = "/api/v1/sso/{id}/authorize";
pub const SSO_CALLBACK: &str = "/api/v1/sso/{id}/callback";

/// 所有对外路由（不含静态页 `/`、`/index.html`）
pub const ALL_ROUTES: &[RouteDef] = &[
    RouteDef {
        method: "GET",
        path: HEALTH,
    },
    RouteDef {
        method: "GET",
        path: LIVE,
    },
    RouteDef {
        method: "GET",
        path: READY,
    },
    RouteDef {
        method: "POST",
        path: AUTH_CAPTCHA,
    },
    RouteDef {
        method: "POST",
        path: AUTH_OTP,
    },
    RouteDef {
        method: "POST",
        path: AUTH_SIGNIN,
    },
    RouteDef {
        method: "POST",
        path: AUTH_SIGNIN_PHONE,
    },
    RouteDef {
        method: "POST",
        path: AUTH_SIGNIN_EMAIL,
    },
    RouteDef {
        method: "POST",
        path: AUTH_SIGNUP,
    },
    RouteDef {
        method: "GET",
        path: AUTH_PROFILE,
    },
    RouteDef {
        method: "PUT",
        path: AUTH_PROFILE,
    },
    RouteDef {
        method: "POST",
        path: AUTH_SIGNOUT,
    },
    RouteDef {
        method: "POST",
        path: AUTH_PASSWORD_FORGOT,
    },
    RouteDef {
        method: "POST",
        path: AUTH_PASSWORD_RESET,
    },
    RouteDef {
        method: "PUT",
        path: AUTH_PASSWORD,
    },
    RouteDef {
        method: "GET",
        path: USERS,
    },
    RouteDef {
        method: "POST",
        path: USERS,
    },
    RouteDef {
        method: "GET",
        path: USERS_BY_ID,
    },
    RouteDef {
        method: "PUT",
        path: USERS_BY_ID,
    },
    RouteDef {
        method: "DELETE",
        path: USERS_BY_ID,
    },
    RouteDef {
        method: "POST",
        path: UPLOAD_PREPARE,
    },
    RouteDef {
        method: "PATCH",
        path: UPLOAD_HASH,
    },
    RouteDef {
        method: "POST",
        path: UPLOAD_CHUNK,
    },
    RouteDef {
        method: "POST",
        path: UPLOAD_FINALIZE,
    },
    RouteDef {
        method: "GET",
        path: UPLOAD_PROGRESS,
    },
    RouteDef {
        method: "DELETE",
        path: UPLOAD_CANCEL,
    },
    RouteDef {
        method: "GET",
        path: UPLOAD_FILES,
    },
    RouteDef {
        method: "GET",
        path: UPLOAD_FILES_BY_HASH,
    },
    RouteDef {
        method: "GET",
        path: UPLOAD_ASSET,
    },
    RouteDef {
        method: "GET",
        path: ENGINE_SUGGESTION,
    },
    RouteDef {
        method: "GET",
        path: APPLICATION_TO_READ,
    },
    RouteDef {
        method: "GET",
        path: TENANTS,
    },
    RouteDef {
        method: "POST",
        path: TENANTS,
    },
    RouteDef {
        method: "GET",
        path: TENANTS_BY_ID,
    },
    RouteDef {
        method: "PUT",
        path: TENANTS_BY_ID,
    },
    RouteDef {
        method: "DELETE",
        path: TENANTS_BY_ID,
    },
    RouteDef {
        method: "GET",
        path: TENANT_MEMBERS,
    },
    RouteDef {
        method: "POST",
        path: TENANT_MEMBERS,
    },
    RouteDef {
        method: "PUT",
        path: TENANT_MEMBER_BY_ID,
    },
    RouteDef {
        method: "DELETE",
        path: TENANT_MEMBER_BY_ID,
    },
    RouteDef {
        method: "GET",
        path: TENANT_SUBSCRIPTIONS,
    },
    RouteDef {
        method: "POST",
        path: TENANT_SUBSCRIPTIONS,
    },
    RouteDef {
        method: "DELETE",
        path: TENANT_SUBSCRIPTION_BY_ID,
    },
    RouteDef {
        method: "GET",
        path: TENANT_QUOTA,
    },
    RouteDef {
        method: "GET",
        path: TENANT_AUDIT,
    },
    RouteDef {
        method: "GET",
        path: TENANT_AUDIT_EXPORT,
    },
    RouteDef {
        method: "GET",
        path: TENANT_PAY_CATALOG,
    },
    RouteDef {
        method: "GET",
        path: TENANT_PAY_ORDERS,
    },
    RouteDef {
        method: "POST",
        path: TENANT_PAY_ORDERS,
    },
    RouteDef {
        method: "GET",
        path: TENANT_PAY_ORDER_BY_NO,
    },
    RouteDef {
        method: "POST",
        path: TENANT_PAY_ORDER_SYNC,
    },
    RouteDef {
        method: "POST",
        path: TENANT_PAY_ORDER_CLOSE,
    },
    RouteDef {
        method: "POST",
        path: PAY_NOTIFY_WECHAT,
    },
    RouteDef {
        method: "POST",
        path: PAY_NOTIFY_ALIPAY,
    },
    RouteDef {
        method: "POST",
        path: GATEWAY_CHAT,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_MODELS,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_PROVIDERS,
    },
    RouteDef {
        method: "POST",
        path: GATEWAY_PROVIDERS,
    },
    RouteDef {
        method: "PUT",
        path: GATEWAY_PROVIDERS_BY_ID,
    },
    RouteDef {
        method: "DELETE",
        path: GATEWAY_PROVIDERS_BY_ID,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_ADMIN_MODELS,
    },
    RouteDef {
        method: "POST",
        path: GATEWAY_ADMIN_MODELS,
    },
    RouteDef {
        method: "PUT",
        path: GATEWAY_ADMIN_MODELS_BY_ID,
    },
    RouteDef {
        method: "DELETE",
        path: GATEWAY_ADMIN_MODELS_BY_ID,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_USAGE,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_AUDIT,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_AUDIT_EXPORT,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_QUOTA_ME,
    },
    RouteDef {
        method: "GET",
        path: GATEWAY_PLANS,
    },
    RouteDef {
        method: "POST",
        path: SERVICE_TOKEN,
    },
    RouteDef {
        method: "POST",
        path: SERVICE_EMBEDDINGS,
    },
    RouteDef {
        method: "POST",
        path: SERVICE_CHAT,
    },
    RouteDef {
        method: "GET",
        path: SERVICE_ASSET_CONTENT,
    },
    RouteDef {
        method: "PUT",
        path: SERVICE_ASSET_VISIBILITY,
    },
    RouteDef {
        method: "POST",
        path: AGENT_TASKS,
    },
    RouteDef {
        method: "GET",
        path: AGENT_TASK_BY_ID,
    },
    RouteDef {
        method: "POST",
        path: AGENT_TASK_APPROVAL,
    },
    RouteDef {
        method: "POST",
        path: RAG_INDEX_TASKS,
    },
    RouteDef {
        method: "GET",
        path: RAG_INDEX_TASK_BY_ID,
    },
    RouteDef {
        method: "POST",
        path: CHAT_SYNC,
    },
    RouteDef {
        method: "GET",
        path: CHAT_SYNC,
    },
    RouteDef {
        method: "POST",
        path: MCP,
    },
    RouteDef {
        method: "GET",
        path: SSO_CONNECTIONS,
    },
    RouteDef {
        method: "POST",
        path: SSO_CONNECTIONS,
    },
    RouteDef {
        method: "PUT",
        path: SSO_CONNECTIONS_BY_ID,
    },
    RouteDef {
        method: "DELETE",
        path: SSO_CONNECTIONS_BY_ID,
    },
    RouteDef {
        method: "GET",
        path: SSO_AUTHORIZE,
    },
    RouteDef {
        method: "GET",
        path: SSO_CALLBACK,
    },
    RouteDef {
        method: "GET",
        path: BILLING_PRICES,
    },
    RouteDef {
        method: "POST",
        path: BILLING_PRICES,
    },
    RouteDef {
        method: "PUT",
        path: BILLING_PRICES_BY_ID,
    },
    RouteDef {
        method: "DELETE",
        path: BILLING_PRICES_BY_ID,
    },
    RouteDef {
        method: "GET",
        path: BILLING_RECONCILIATION,
    },
    RouteDef {
        method: "GET",
        path: BILLING_RECONCILIATION_EXPORT,
    },
];
