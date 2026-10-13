use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use super::loader::{load_merged_config, resolve_profile};
use super::runtime;

/// 邮件正文模板里的验证码占位符（单占位符，替换时不转义）。
pub const MAIL_CODE_PLACEHOLDER: &str = "{code}";

/// 服务身份令牌的有效期上限（秒）：令牌只在一次外部调用往返里用得上，
/// 长于这个数就失去了「短期凭据」的意义。
pub const SERVICE_TOKEN_MAX_TTL_SECS: u64 = 3_600;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Encryption {
    Aes,
    Argon2,
}

impl Encryption {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "aes" => Encryption::Aes,
            "argon2" => Encryption::Argon2,
            _ => Encryption::Argon2,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub env: String,
    pub swagger: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            env: "development".to_string(),
            swagger: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 3000,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct DatabaseConfig {
    pub url: String,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            // 默认不带密码：本机开发连 Docker 的 cogito-postgres（127.0.0.1:5432，用户名 machenike、
            // 库 i-thinking），真实密码写在 config.local.yaml（不入库），与 apps/cogito/.env 的
            // POSTGRES_PASSWORD 一致。这里只是兜底默认，让「没建 local 文件」也能起进程、由探测报错。
            url: "postgres://machenike:@127.0.0.1:5432/i-thinking".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct RedisConfig {
    pub url: String,
    pub pool_size: usize,
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            url: "redis://127.0.0.1:6379".to_string(),
            pool_size: 8,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct SecurityConfig {
    pub secret: String,
    pub jwt_secret: String,
    pub encryption: String,
    pub aes_key: Option<String>,
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            secret: "change-me-secret".to_string(),
            jwt_secret: "change-me-jwt-secret-at-least-32-characters-long".to_string(),
            encryption: "argon2".to_string(),
            aes_key: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct CaptchaConfig {
    /// `false` 时跳过 `check-data`（仅开发联调；生产须为 `true`）
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub kind: String,
    pub timeout_ms: u64,
    pub ip_rate_limit: u32,
}

impl Default for CaptchaConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            base_url: "http://127.0.0.1:8080".to_string(),
            api_key: String::new(),
            kind: "slide-default".to_string(),
            timeout_ms: 5000,
            ip_rate_limit: 30,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct OtpConfig {
    pub ttl_secs: u64,
    pub cooldown_secs: u64,
    pub max_attempts: u32,
    pub lock_secs: u64,
    pub mock: bool,
}

impl Default for OtpConfig {
    fn default() -> Self {
        Self {
            ttl_secs: 300,
            cooldown_secs: 60,
            max_attempts: 5,
            lock_secs: 900,
            mock: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct SigninConfig {
    pub max_failures: u32,
}

impl Default for SigninConfig {
    fn default() -> Self {
        Self { max_failures: 5 }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AuthRateLimitConfig {
    pub enabled: bool,
    pub burst_size: u32,
    pub requests_per_minute: u64,
}

impl Default for AuthRateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            burst_size: 20,
            requests_per_minute: 30,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AuthConfig {
    pub captcha: CaptchaConfig,
    pub otp: OtpConfig,
    pub signin: SigninConfig,
    pub rate_limit: AuthRateLimitConfig,
    pub trust_proxy: bool,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            captcha: CaptchaConfig::default(),
            otp: OtpConfig::default(),
            signin: SigninConfig::default(),
            rate_limit: AuthRateLimitConfig::default(),
            trust_proxy: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct LoggingConfig {
    pub filter: String,
    pub dir: String,
    pub retention_days: u64,
    pub format: String,
    pub body_max: usize,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            filter: "info".to_string(),
            dir: "logs".to_string(),
            retention_days: 14,
            format: "pretty".to_string(),
            body_max: 8192,
        }
    }
}

/// 链路追踪（OTel → OTLP/HTTP）。默认关闭：关闭时不注册传播器、不导出 span，
/// 跨进程仍靠内置的 W3C 实现透传 `traceparent`（见 `middlewares::trace`）。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct TelemetryConfig {
    pub enabled: bool,
    /// OTLP/HTTP 基址，例如 `http://127.0.0.1:4318`。带路径则按原样使用；
    /// 不带路径时补上 traces 的默认路径 `/v1/traces`。
    pub endpoint: String,
    /// 资源里的 `service.name` 前缀：实际值是 `{service_name}-{角色}`（角色 = api / worker /
    /// orchestrator）。留空则只用角色名，便于同一个 collector 里区分多个进程。
    pub service_name: String,
    /// 采样比例 `0.0`–`1.0`。上游已带采样决定时跟随上游（ParentBased）。
    pub sample_ratio: f64,
    /// 单次导出超时（毫秒）。
    pub timeout_ms: u64,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: "http://127.0.0.1:4318".to_string(),
            service_name: "cogito".to_string(),
            sample_ratio: 1.0,
            timeout_ms: 10_000,
        }
    }
}

/// 阿里云出站：凭据与签名（短信、邮件、对象存储共用一套）。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AliyunConfig {
    pub access_key_id: String,
    pub access_key_secret: String,
    /// `v3`（`ACS3-HMAC-SHA256`，默认）或 `v1`（`HMAC-SHA1`，只留给老网关）。
    pub signature_version: String,
    pub timeout_ms: u64,
    pub sms: AliyunSmsConfig,
    pub mail: AliyunMailConfig,
    pub oss: AliyunOssConfig,
}

impl Default for AliyunConfig {
    fn default() -> Self {
        Self {
            access_key_id: String::new(),
            access_key_secret: String::new(),
            signature_version: "v3".to_string(),
            timeout_ms: 10_000,
            sms: AliyunSmsConfig::default(),
            mail: AliyunMailConfig::default(),
            oss: AliyunOssConfig::default(),
        }
    }
}

/// Dysmsapi `SendSms`。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AliyunSmsConfig {
    pub endpoint: String,
    /// 控制台里审核通过的签名（`SignName`）。
    pub sign_name: String,
    /// 模板编号（`TemplateCode`），模板里的变量名必须是 `code`。
    pub template_code: String,
}

impl Default for AliyunSmsConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://dysmsapi.aliyuncs.com".to_string(),
            sign_name: String::new(),
            template_code: String::new(),
        }
    }
}

/// DirectMail `SingleSendMail`。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AliyunMailConfig {
    pub endpoint: String,
    /// 控制台里验证过的发信地址（`AccountName`）。
    pub account_name: String,
    /// 发件人显示名（`FromAlias`）。
    pub from_alias: String,
    /// `1`（随机账号，官方默认）或 `0`（用 `account_name`）。
    pub address_type: u8,
    pub reply_to_address: bool,
    pub subject: String,
    /// 纯文本正文模板，必须包含 `{code}` 占位符。
    pub body_template: String,
}

impl Default for AliyunMailConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://dm.aliyuncs.com".to_string(),
            account_name: String::new(),
            from_alias: String::new(),
            address_type: 1,
            reply_to_address: true,
            subject: "验证码".to_string(),
            body_template: "您的验证码是 {code}，请勿泄露给他人。".to_string(),
        }
    }
}

/// OSS 对象存储（`opendal` 的 OSS 后端）。bucket 为空表示「本部署不使用对象存储」。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AliyunOssConfig {
    pub endpoint: String,
    pub bucket: String,
    /// bucket 内的逻辑根前缀；空串表示直接用 bucket 根。
    pub root: String,
    /// `virtual`（默认）、`cname` 或 `path`（本地/自建网关必须用 `path`）。
    pub addressing_style: String,
    /// 生成预签名 URL 时改用另一个 endpoint（如内网写、公网读）。
    pub presign_endpoint: String,
    pub presign_expires_secs: u64,
}

impl Default for AliyunOssConfig {
    fn default() -> Self {
        Self {
            endpoint: String::new(),
            bucket: String::new(),
            root: String::new(),
            addressing_style: "virtual".to_string(),
            presign_endpoint: String::new(),
            presign_expires_secs: 900,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct GatewayConfig {
    /// 全局兜底日 token 配额（无租户 / 团队租户）
    pub daily_token_quota: i64,
    /// 个人租户免费档日 token 配额（无有效订阅时生效）
    pub free_daily_token_quota: i64,
    /// 个人租户订阅档位日 token 配额：档位名 -> 配额
    pub plan_daily_token_quota: HashMap<String, i64>,
    /// 上游模型流式读超时（毫秒）
    pub upstream_timeout_ms: u64,
    /// 审计落库开关
    pub audit_enabled: bool,
    /// 服务身份令牌的签发密钥（HMAC-SHA256）。留空 = 服务身份端点整体关闭（503）。
    ///
    /// 与 `security.jwt_secret` 分开：终端用户的会话令牌与服务身份的短期令牌用途不同，
    /// 轮换其一不该牵连另一侧的签发。
    pub service_token_secret: String,
    /// 服务身份令牌的有效期（秒）。调用方按需重换，因此越短越安全；上限 3600。
    pub service_token_ttl_secs: u64,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            daily_token_quota: 1_000_000,
            free_daily_token_quota: 100_000,
            plan_daily_token_quota: HashMap::new(),
            upstream_timeout_ms: 120_000,
            audit_enabled: true,
            service_token_secret: String::new(),
            service_token_ttl_secs: 300,
        }
    }
}

/// 单个可售档位的计价信息；`amount <= 0` 视为未定价（不可售）。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct PayPlanConfig {
    /// 售价（**分**，CNY）；`<= 0` 视为未定价
    pub amount: i64,
    /// 开通时长（天）；`None` = 永久有效
    pub duration_days: Option<i32>,
    /// 展示名；为空时前端回落档位名
    pub label: Option<String>,
}

impl Default for PayPlanConfig {
    fn default() -> Self {
        Self {
            amount: 0,
            duration_days: Some(30),
            label: None,
        }
    }
}

/// 微信支付（APIv3 / Native 扫码）。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct WechatPayConfig {
    pub enabled: bool,
    /// 商户号
    pub mch_id: String,
    /// 公众号 / 开放平台 appid（Native 下单必填）
    pub app_id: String,
    /// APIv3 密钥（32 位），用于回调 `resource` 的 AES-256-GCM 解密
    pub api_v3_key: String,
    /// 商户 API 证书序列号（请求签名头 `serial_no`）
    pub serial_no: String,
    /// 商户 API 私钥（PKCS#8 PEM，即 `apiclient_key.pem` 内容）
    pub private_key: String,
    /// 微信支付平台证书公钥（PEM，SPKI 公钥：`openssl x509 -pubkey -noout -in cert.pem`）
    pub platform_public_key: String,
    /// 回调通知地址（必须公网 HTTPS）
    pub notify_url: String,
    /// 接口基址，便于联调或私有化
    pub api_base: String,
}

impl Default for WechatPayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mch_id: String::new(),
            app_id: String::new(),
            api_v3_key: String::new(),
            serial_no: String::new(),
            private_key: String::new(),
            platform_public_key: String::new(),
            notify_url: String::new(),
            api_base: "https://api.mch.weixin.qq.com".to_string(),
        }
    }
}

/// 支付宝（当面付 `alipay.trade.precreate` → 二维码）。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AlipayPayConfig {
    pub enabled: bool,
    /// 开放平台应用 app_id
    pub app_id: String,
    /// 应用私钥（PKCS#8 PEM）
    pub private_key: String,
    /// 支付宝公钥（PEM），用于响应与回调验签
    pub alipay_public_key: String,
    /// 网关地址（生产为 `https://openapi.alipay.com/gateway.do`）
    pub gateway_url: String,
    /// 异步通知地址（必须公网可访问）
    pub notify_url: String,
}

impl Default for AlipayPayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            app_id: String::new(),
            private_key: String::new(),
            alipay_public_key: String::new(),
            gateway_url: "https://openapi.alipay.com/gateway.do".to_string(),
            notify_url: String::new(),
        }
    }
}

/// 支付（订单 / 渠道凭据 / 定价）。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct PayConfig {
    /// 订单有效期（秒）：超时后不再受理支付
    pub order_ttl_secs: u64,
    /// 可售档位：档位名 -> 计价（档位名须与 `gateway.plan_daily_token_quota` 对应）
    pub plans: HashMap<String, PayPlanConfig>,
    pub wechat: WechatPayConfig,
    pub alipay: AlipayPayConfig,
}

impl Default for PayConfig {
    fn default() -> Self {
        Self {
            order_ttl_secs: 1800,
            plans: HashMap::new(),
            wechat: WechatPayConfig::default(),
            alipay: AlipayPayConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct CorsConfig {
    pub origins: Vec<String>,
}

impl Default for CorsConfig {
    fn default() -> Self {
        Self { origins: vec![] }
    }
}

/// 事件发布（outbox → 下游）。由 `worker` 二进制读取。
///
/// `endpoint` 留空表示「只记日志」：开发与联调默认如此，事件照样被标记为已发布，
/// 便于在不部署下游的情况下跑通链路。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct EventsConfig {
    /// 轮询间隔（毫秒）：一轮发布结束到下一轮开始之间的等待。
    pub poll_interval_ms: u64,
    /// 每轮最多读取的待发布事件数。
    pub batch_size: u64,
    /// 投递失败聚合的退避基数（毫秒）。
    pub backoff_base_ms: u64,
    /// 投递失败聚合的退避上限（毫秒）。
    pub backoff_max_ms: u64,
    /// 下游接收端点（HTTP POST 事件信封）。
    pub endpoint: String,
    /// 单次投递超时（毫秒）。
    pub timeout_ms: u64,
    /// 下游鉴权 token（`Authorization: Bearer`）。
    pub token: String,
    /// 是否让系统/环境变量代理接管投递。默认 `false`：事件终点按内网直连处理，
    /// 免得本机系统代理（如 127.0.0.1:7892）拦截内网地址并回 502。
    pub use_system_proxy: bool,
}

impl Default for EventsConfig {
    fn default() -> Self {
        Self {
            poll_interval_ms: 500,
            batch_size: 64,
            backoff_base_ms: 1000,
            backoff_max_ms: 60_000,
            endpoint: String::new(),
            timeout_ms: 5_000,
            token: String::new(),
            use_system_proxy: false,
        }
    }
}

/// 可靠执行（编排运行时）。由 `orchestrator` 二进制读取。
///
/// 编排历史不是业务表：它由 provider 自己建在独立 schema 里，不属于 `migration` 世代，
/// 也不参与租户/平台通道。`schema` 留空或填 `public` 都会被拒绝，免得编排表和业务表混在一个命名空间。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct DurableConfig {
    /// 编排库连接串；留空表示复用 `database.url`。
    pub database_url: String,
    /// 编排历史所在 schema（必须独立、非 `public`）。
    pub schema: String,
    /// 启动时自动建表（`ApplyAll`）；关闭则只做校验（`VerifyOnly`），缺表直接启动失败。
    pub auto_migrate: bool,
    /// 可同时推进的编排实例数。
    pub orchestration_concurrency: usize,
    /// 可同时执行的活动数。
    pub worker_concurrency: usize,
    /// 停机时给在跑活动留的收尾窗口（毫秒）。
    pub shutdown_grace_ms: u64,
    /// 活动执行者持有租约的时长（毫秒）。进程被硬杀后，它手里那一步要等租约过期才能被别人接手，
    /// 所以这个值同时决定「崩溃恢复最慢多久」；调小 = 恢复更快，但网络抖动时更容易被误判为失联。
    pub worker_lock_timeout_ms: u64,
    /// 租约续期的提前量（毫秒），必须小于 `worker_lock_timeout_ms`。
    pub worker_lock_renewal_buffer_ms: u64,
}

impl Default for DurableConfig {
    fn default() -> Self {
        Self {
            database_url: String::new(),
            schema: "durable".to_string(),
            auto_migrate: true,
            orchestration_concurrency: 2,
            worker_concurrency: 2,
            shutdown_grace_ms: 5_000,
            worker_lock_timeout_ms: 30_000,
            worker_lock_renewal_buffer_ms: 5_000,
        }
    }
}

/// AI 计算车间（ai-worker，Python）的内部调用配置。契约在 `spec/internal.yaml`。
///
/// 由 `orchestrator` 读取（活动要调它）；api 二进制不读它，所以「地址/令牌是否齐全」
/// 不放进 [`Configure::validate`]，见 [`Configure::require_ai_worker_settings`]。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AiWorkerConfig {
    /// 内部调用基址，例如 `http://127.0.0.1:8081`（不带尾斜杠也可）。
    pub base_url: String,
    /// 内部共享令牌（请求头 `X-Internal-Token`）。
    pub token: String,
    /// 单次调用超时（毫秒）。长任务的一步 = 一次调用，超时即失败并交给活动重试。
    pub timeout_ms: u64,
    /// 是否让系统/环境变量代理接管调用。默认 `false`：内网直连，
    /// 免得本机系统代理（如 127.0.0.1:7892）拦截内网地址并回 502。
    pub use_system_proxy: bool,
    /// 每次嵌入活动处理的块数。一次活动 = 编排历史里的一步：越小则崩溃后重跑越省，
    /// 但历史越长、往返越多。
    pub embed_batch_size: usize,
    /// 嵌入模型。模型由 cogito 决定：出网与计量都以 cogito 的 gateway 为唯一入口，
    /// ai-worker 不许自己换模型。它在装配编排时注入，因此同一实例重放时模型恒定。
    pub embed_model: String,
}

impl Default for AiWorkerConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            token: String::new(),
            timeout_ms: 30_000,
            use_system_proxy: false,
            embed_batch_size: 16,
            embed_model: "text-embedding-3-small".to_string(),
        }
    }
}

/// 服务端 agent（P9c）的任务默认值。由 **api** 读取：起任务时把这几个值写进编排输入。
///
/// 三个字段都是**上限**而不是请求的唯一来源：起任务时请求体可以调小轮次、缩小工具集合，
/// 但不能越过这里——配置是天花板，请求只能往下收。这样「这套部署允许 agent 做什么」
/// 是一个部署级的决定，不用去翻每一条请求。
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    /// 推理用的对话模型（`gateway_model` 目录里的一行）。cogito 的网关是唯一出网点，
    /// 所以 ai-worker 不许自己挑模型，模型名字从这里往下传。
    ///
    /// 目录行必须支持工具调用（`capabilities.tools` 不为 false），否则每一步都拿不到工具、
    /// agent 会退化成一次性问答。**不在提交路径校验**：读目录表要跨域，且模型可以后补；
    /// 缺行 / 不支持工具会在跑起来时以失败落台账。
    pub chat_model: String,
    /// 轮次上限（一次任务最多几次「推理 + 工具」）。
    pub max_steps: usize,
    /// 单次人工审批最多等多久（秒）。
    ///
    /// 只对需要审批的写工具有效：到点没人处理就按「超时」作废这次调用（工具不执行）。
    /// **必须明显小于等待者的预算**（`services::agent::dispatch` 的 3600s），否则任务会先被
    /// 等待者判超时，人在批准时实例已经没人接了。这个下限由 `cogito` 侧的测试钉住。
    pub approval_ttl_secs: u64,
    /// 允许 agent 使用的工具（OpenAI 函数名规则：字母数字加下划线，**不能带点号**——
    /// 点号是能力名的写法，工具名带点上不了模型接口）。
    ///
    /// 写入类工具（`memory_write` / `asset_visibility_write`）**不进默认值**：前者的记忆会被之后的
    /// 任务召回，投毒一次就持续影响后续任务；后者改的是资产可见性（谁能看到这个文件）。
    /// 两者都必须由运维显式开启，开启后每次调用都要先过人工审批。
    pub allowed_tools: Vec<String>,
}

impl AgentConfig {
    /// 审批等待时长的下限：比这更短，人根本来不及看到待办（等于没开审批）。
    pub const MIN_APPROVAL_TTL_SECS: u64 = 60;

    /// 缺省的审批等待时长（秒）。
    pub const DEFAULT_APPROVAL_TTL_SECS: u64 = 1800;
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            chat_model: "deepseek-chat".to_string(),
            max_steps: 6,
            approval_ttl_secs: Self::DEFAULT_APPROVAL_TTL_SECS,
            allowed_tools: vec![
                "knowledge_search".to_string(),
                "asset_read".to_string(),
                "memory_recall".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Configure {
    pub app: AppConfig,
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub security: SecurityConfig,
    pub auth: AuthConfig,
    pub aliyun: AliyunConfig,
    pub gateway: GatewayConfig,
    pub pay: PayConfig,
    pub logging: LoggingConfig,
    pub telemetry: TelemetryConfig,
    pub cors: CorsConfig,
    pub events: EventsConfig,
    pub durable: DurableConfig,
    pub ai_worker: AiWorkerConfig,
    pub agent: AgentConfig,
    /// 合并时使用的 profile（`resolve_profile()`）。
    #[serde(skip)]
    pub profile: String,
    /// 配置目录（用于日志）。
    #[serde(skip)]
    pub config_dir: PathBuf,
}

impl Default for Configure {
    fn default() -> Self {
        Self {
            app: AppConfig::default(),
            server: ServerConfig::default(),
            database: DatabaseConfig::default(),
            redis: RedisConfig::default(),
            security: SecurityConfig::default(),
            auth: AuthConfig::default(),
            aliyun: AliyunConfig::default(),
            gateway: GatewayConfig::default(),
            pay: PayConfig::default(),
            logging: LoggingConfig::default(),
            telemetry: TelemetryConfig::default(),
            cors: CorsConfig::default(),
            events: EventsConfig::default(),
            durable: DurableConfig::default(),
            ai_worker: AiWorkerConfig::default(),
            agent: AgentConfig::default(),
            profile: "development".to_string(),
            config_dir: PathBuf::from("."),
        }
    }
}

impl Configure {
    pub fn load() -> Result<Self> {
        let profile = resolve_profile();
        let config_dir = super::loader::config_dir();
        let merged = load_merged_config(&profile)?;
        let mut cfg: Configure = merged
            .try_deserialize()
            .context("failed to deserialize configuration")?;
        cfg.profile = profile;
        cfg.config_dir = config_dir;

        if cfg.is_production() {
            cfg.auth.otp.mock = false;
            if !cfg.auth.captcha.enabled {
                bail!("auth.captcha.enabled must be true in production");
            }
        }

        cfg.validate()?;
        runtime::init(cfg.is_production());
        Ok(cfg)
    }

    pub fn validate(&self) -> Result<()> {
        if self.security.jwt_secret.len() < 32 {
            bail!("security.jwt_secret must be at least 32 characters");
        }

        let encryption = Encryption::from_str(&self.security.encryption);
        if encryption == Encryption::Aes
            && self.security.aes_key.as_ref().is_none_or(|k| k.is_empty())
        {
            bail!("security.aes_key is required when security.encryption is aes");
        }

        // 空串不是密钥：`COGITO__SECURITY__SECRET=""` / `COGITO__SECURITY__JWT_SECRET=""` 这类空覆盖
        // 既逃过 `is_placeholder_secret`（它只看占位词），也逃过长度检查（`secret` 没有下限）。
        if self.security.secret.trim().is_empty() {
            bail!("security.secret must not be empty");
        }
        if self.security.jwt_secret.trim().is_empty() {
            bail!("security.jwt_secret must not be empty");
        }

        if self.is_production() {
            if is_placeholder_secret(&self.security.secret) {
                bail!("security.secret must not use placeholder values in production");
            }
            if is_placeholder_secret(&self.security.jwt_secret) {
                bail!("security.jwt_secret must not use placeholder values in production");
            }
        }

        self.validate_gateway()?;

        self.validate_telemetry()?;
        self.validate_pay()?;
        self.validate_events()?;
        self.validate_durable()?;
        self.validate_ai_worker()?;
        self.validate_agent()?;
        self.validate_aliyun()?;

        Ok(())
    }

    /// 网关配置的形状校验（各 profile 一致）。
    ///
    /// 服务身份令牌的密钥允许为空（= 端点关闭，见 [`Configure::gateway_service_token_secret`]），
    /// 但**半截配置**（配了时长却忘了密钥，或时长超出上限）一定是事故：
    /// 前者的表现是「令牌永远签不出来」，后者会让本该短命的凭据长期有效。
    /// 生产下模板里的占位密钥同样直接拒（抄一份上线 = 公开 HMAC 密钥）。
    fn validate_gateway(&self) -> Result<()> {
        let gateway = &self.gateway;
        if !self.gateway_service_token_secret().is_empty()
            && gateway.service_token_ttl_secs > SERVICE_TOKEN_MAX_TTL_SECS
        {
            bail!(
                "gateway.service_token_ttl_secs must not exceed {SERVICE_TOKEN_MAX_TTL_SECS}: \
                 服务身份令牌是短期凭据"
            );
        }
        // 占位密钥在本机够用，但在生产等于把「伪造服务令牌」的能力公开。
        if self.is_production() && is_placeholder_secret(self.gateway_service_token_secret()) {
            bail!("gateway.service_token_secret must not use placeholder values in production");
        }

        Ok(())
    }

    /// 链路追踪配置的形状校验（各 profile 一致）。
    ///
    /// 关闭时一律放过（默认配置必须能通过 `validate()`）；开启后「地址/采样/超时」写错
    /// 一定是事故：地址写错会静默丢 span，采样比例越界会让 SDK 反复告警。
    fn validate_telemetry(&self) -> Result<()> {
        let telemetry = &self.telemetry;
        if !telemetry.enabled {
            return Ok(());
        }

        let endpoint = telemetry.endpoint.trim();
        if endpoint.is_empty() {
            bail!("telemetry.endpoint is required when telemetry.enabled is true");
        }
        if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
            bail!("telemetry.endpoint must be an http(s) url");
        }
        if !(0.0..=1.0).contains(&telemetry.sample_ratio) {
            bail!("telemetry.sample_ratio must be within 0.0..=1.0");
        }
        if telemetry.timeout_ms == 0 {
            bail!("telemetry.timeout_ms must be greater than 0");
        }

        Ok(())
    }

    /// 阿里云出站配置的形状校验（各 profile 一致）。
    ///
    /// 这里不强制「凭据必须齐全」：`auth.otp.mock` 与不使用对象存储的部署都不需要凭据，
    /// 真正缺凭据时由客户端的构造失败直说。但**半截凭据**（只填 key 或只填 secret）
    /// 一定是配置事故，就地报错，免得线上表现为「签名错误」这种看不出来源的现象。
    fn validate_aliyun(&self) -> Result<()> {
        let aliyun = &self.aliyun;
        if aliyun.timeout_ms == 0 {
            bail!("aliyun.timeout_ms must be greater than 0");
        }
        if !matches!(
            aliyun
                .signature_version
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "v1" | "v3" | "1" | "1.0" | "3" | "3.0"
        ) {
            bail!("aliyun.signature_version must be one of v1, v3");
        }

        let access_key_id = aliyun.access_key_id.trim();
        let access_key_secret = aliyun.access_key_secret.trim();
        if access_key_id.is_empty() != access_key_secret.is_empty() {
            bail!("aliyun.access_key_id and aliyun.access_key_secret must be set together");
        }

        require_http_origin("aliyun.sms.endpoint", &aliyun.sms.endpoint)?;
        require_http_origin("aliyun.mail.endpoint", &aliyun.mail.endpoint)?;
        if aliyun.mail.address_type > 1 {
            bail!("aliyun.mail.address_type must be 0 (account_name) or 1 (random account)");
        }
        if !aliyun.mail.body_template.contains(MAIL_CODE_PLACEHOLDER) {
            bail!("aliyun.mail.body_template must contain {MAIL_CODE_PLACEHOLDER}");
        }

        if !aliyun.oss.bucket.trim().is_empty() {
            require_http_origin("aliyun.oss.endpoint", &aliyun.oss.endpoint)?;
        }
        if !aliyun.oss.presign_endpoint.trim().is_empty() {
            require_http_origin("aliyun.oss.presign_endpoint", &aliyun.oss.presign_endpoint)?;
        }
        if !matches!(
            aliyun.oss.addressing_style.trim(),
            "virtual" | "cname" | "path"
        ) {
            bail!("aliyun.oss.addressing_style must be one of virtual, cname, path");
        }
        if aliyun.oss.presign_expires_secs == 0 {
            bail!("aliyun.oss.presign_expires_secs must be greater than 0");
        }

        Ok(())
    }

    /// 事件发布配置的形状校验（各 profile 一致）。
    ///
    /// 「终点与鉴权是否齐全」不在这里判定：api 二进制不读 `events`，不该因为 worker 的
    /// 配置缺失而起不来；该判定见 [`Configure::require_events_endpoint`]，由 worker 调用。
    fn validate_events(&self) -> Result<()> {
        let events = &self.events;
        if events.batch_size == 0 {
            bail!("events.batch_size must be greater than 0");
        }
        if events.poll_interval_ms == 0 {
            bail!("events.poll_interval_ms must be greater than 0");
        }
        if events.timeout_ms == 0 {
            bail!("events.timeout_ms must be greater than 0");
        }
        if events.backoff_base_ms == 0 || events.backoff_max_ms < events.backoff_base_ms {
            bail!("events.backoff_max_ms must be greater than or equal to events.backoff_base_ms");
        }

        Ok(())
    }

    /// worker 专用：生产环境必须有终点与鉴权，否则事件只会留在 outbox 里（且没有任何报错）。
    ///
    /// 非生产环境允许留空 = 只记日志，方便在没有下游时跑通链路。
    pub fn require_events_endpoint(&self) -> Result<()> {
        if !self.is_production() {
            return Ok(());
        }
        let endpoint = self.events.endpoint.trim();
        if endpoint.is_empty() {
            bail!("events.endpoint is required in production（worker 会一直只记日志）");
        }
        if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
            bail!("events.endpoint must be an http(s) url");
        }
        if self.events.token.trim().is_empty() {
            bail!("events.token is required in production：事件终点不接受匿名投递");
        }

        Ok(())
    }

    /// 可靠执行配置的形状校验（各 profile 一致）。
    ///
    /// 「连接串是否可达」不在这里判定：api 二进制不读 `durable`，不该因为编排库的配置而起不来；
    /// 该判定见 [`Configure::require_durable_settings`]，由 orchestrator 调用。
    fn validate_durable(&self) -> Result<()> {
        let durable = &self.durable;
        let schema = durable.schema.trim();
        if schema.is_empty() {
            bail!("durable.schema must not be empty：编排历史必须放在独立 schema 里");
        }
        if schema.eq_ignore_ascii_case("public") {
            bail!("durable.schema must not be `public`：编排表不能和业务表混在一个 schema");
        }
        if !is_valid_schema_name(schema) {
            bail!("durable.schema must match ^[A-Za-z_][A-Za-z0-9_]*$");
        }
        if !durable.database_url.trim().is_empty() && !is_postgres_url(durable.database_url.trim())
        {
            bail!("durable.database_url must be a postgres:// or postgresql:// url");
        }
        if durable.orchestration_concurrency == 0 {
            bail!("durable.orchestration_concurrency must be greater than 0");
        }
        if durable.worker_concurrency == 0 {
            bail!("durable.worker_concurrency must be greater than 0");
        }
        if durable.shutdown_grace_ms == 0 {
            bail!("durable.shutdown_grace_ms must be greater than 0");
        }
        if durable.worker_lock_timeout_ms == 0 {
            bail!("durable.worker_lock_timeout_ms must be greater than 0");
        }
        if durable.worker_lock_renewal_buffer_ms >= durable.worker_lock_timeout_ms {
            bail!(
                "durable.worker_lock_renewal_buffer_ms must be less than durable.worker_lock_timeout_ms：\
                 续期提前量不小于租约时长的话，租约会在续期前就过期"
            );
        }

        Ok(())
    }

    /// orchestrator 专用：编排库连接串必须能定下来（空值会回落到 `database.url`）。
    ///
    /// 返回解析后的连接串，调用方直接拿它去连库；schema 与并发数用 [`Configure::durable`] 的字段。
    pub fn require_durable_settings(&self) -> Result<&str> {
        let url = if self.durable.database_url.trim().is_empty() {
            self.database_uri().trim()
        } else {
            self.durable.database_url.trim()
        };
        if url.is_empty() {
            bail!(
                "durable.database_url 与 database.url 不能同时为空（orchestrator 无法连接编排库）"
            );
        }
        if !is_postgres_url(url) {
            bail!(
                "durable 编排库必须是 postgres:// 或 postgresql:// url（duroxide-pg 只支持 PostgreSQL）"
            );
        }

        Ok(url)
    }

    /// AI 计算车间的形状校验（各 profile 一致）；「地址与令牌是否齐全」见
    /// [`Configure::require_ai_worker_settings`]。
    fn validate_ai_worker(&self) -> Result<()> {
        let ai_worker = &self.ai_worker;
        let base_url = ai_worker.base_url.trim();
        if !base_url.is_empty()
            && !base_url.starts_with("http://")
            && !base_url.starts_with("https://")
        {
            bail!("ai_worker.base_url must be an http(s) url");
        }
        if ai_worker.timeout_ms == 0 {
            bail!("ai_worker.timeout_ms must be greater than 0");
        }
        if ai_worker.embed_batch_size == 0 {
            bail!("ai_worker.embed_batch_size must be greater than 0");
        }
        if ai_worker.embed_model.trim().is_empty() {
            bail!("ai_worker.embed_model must not be empty：模型由 cogito 指定，不能留空");
        }

        Ok(())
    }

    /// 服务端 agent 的形状校验（各 profile 一致）。
    ///
    /// 这几项都是**天花板**：起任务时用不上一个空模型名、用不上 0 轮预算，也认不出带点号的
    /// 工具名（那是能力名的写法，模型接口不认）。所以宁可在启动时报，而不是等到第一条任务。
    fn validate_agent(&self) -> Result<()> {
        let agent = &self.agent;
        if agent.chat_model.trim().is_empty() {
            bail!("agent.chat_model must not be empty：模型由 cogito 指定，不能留空");
        }
        if agent.max_steps == 0 {
            bail!("agent.max_steps must be greater than 0");
        }
        if agent.approval_ttl_secs < AgentConfig::MIN_APPROVAL_TTL_SECS {
            bail!(
                "agent.approval_ttl_secs 至少 {} 秒（当前 {}）：比这更短，人来不及看到待办，等于没开审批",
                AgentConfig::MIN_APPROVAL_TTL_SECS,
                agent.approval_ttl_secs
            );
        }
        for tool in &agent.allowed_tools {
            if !is_tool_name(tool) {
                bail!(
                    "agent.allowed_tools 里的 {tool:?} 不是合法的工具名：只允许字母数字、下划线与连字符（1–64 字符），\
                     不能带点号——点号是能力名的写法"
                );
            }
        }

        Ok(())
    }

    /// orchestrator 专用：长任务的每一步都要调 ai-worker，地址或令牌缺失就没有「能跑起来」的
    /// 状态可言，因此不做「非生产放行」的豁免——缺了就在启动时直说。
    pub fn require_ai_worker_settings(&self) -> Result<()> {
        if self.ai_worker.base_url.trim().is_empty() {
            bail!("ai_worker.base_url is required（orchestrator 的活动全部要调 ai-worker）");
        }
        if self.ai_worker.token.trim().is_empty() {
            bail!("ai_worker.token is required：内部端点不接受匿名调用");
        }
        // 生产下这把令牌是「能不能烧配额」的开关，不能被模板里的占位值糊过去。
        if self.is_production() && is_placeholder_secret(self.ai_worker.token.trim()) {
            bail!("ai_worker.token must not use placeholder values in production");
        }

        Ok(())
    }

    /// 支付配置校验：宁可启动失败，也不要带着半截凭据上线（下单/验签会静默失效）。
    fn validate_pay(&self) -> Result<()> {
        let wechat = &self.pay.wechat;
        if wechat.enabled {
            let missing = [
                ("mch_id", wechat.mch_id.as_str()),
                ("app_id", wechat.app_id.as_str()),
                ("api_v3_key", wechat.api_v3_key.as_str()),
                ("serial_no", wechat.serial_no.as_str()),
                ("private_key", wechat.private_key.as_str()),
                ("platform_public_key", wechat.platform_public_key.as_str()),
                ("notify_url", wechat.notify_url.as_str()),
            ]
            .into_iter()
            .filter(|(_, value)| value.trim().is_empty())
            .map(|(name, _)| name)
            .collect::<Vec<_>>();
            if !missing.is_empty() {
                bail!(
                    "pay.wechat.{} is required when pay.wechat.enabled",
                    missing.join(", pay.wechat.")
                );
            }
            if wechat.api_v3_key.chars().count() != 32 {
                bail!("pay.wechat.api_v3_key must be exactly 32 characters");
            }
            if !wechat.notify_url.starts_with("https://") {
                bail!("pay.wechat.notify_url must be an https url");
            }
        }

        let alipay = &self.pay.alipay;
        if alipay.enabled {
            let missing = [
                ("app_id", alipay.app_id.as_str()),
                ("private_key", alipay.private_key.as_str()),
                ("alipay_public_key", alipay.alipay_public_key.as_str()),
                ("gateway_url", alipay.gateway_url.as_str()),
                ("notify_url", alipay.notify_url.as_str()),
            ]
            .into_iter()
            .filter(|(_, value)| value.trim().is_empty())
            .map(|(name, _)| name)
            .collect::<Vec<_>>();
            if !missing.is_empty() {
                bail!(
                    "pay.alipay.{} is required when pay.alipay.enabled",
                    missing.join(", pay.alipay.")
                );
            }
        }

        // 定价档位必须与配额档位对齐，否则用户付费后拿到的仍是免费档配额。
        let mismatch = self
            .pay_plans()
            .map(|(plan, _)| plan.clone())
            .filter(|plan| self.gateway_plan_daily_token_quota(plan).is_none())
            .collect::<Vec<_>>();
        if !mismatch.is_empty() {
            bail!(
                "pay.plans has no matching gateway.plan_daily_token_quota entry: {}",
                mismatch.join(", ")
            );
        }

        Ok(())
    }

    pub fn is_production(&self) -> bool {
        matches!(
            self.app.env.to_ascii_lowercase().as_str(),
            "production" | "prod"
        )
    }

    pub fn is_development_details(&self) -> bool {
        !self.is_production()
    }

    pub fn host(&self) -> &str {
        &self.server.host
    }

    pub fn port(&self) -> u16 {
        self.server.port
    }

    pub fn database_uri(&self) -> &str {
        &self.database.url
    }

    pub fn redis_url(&self) -> &str {
        &self.redis.url
    }

    pub fn redis_pool_size(&self) -> usize {
        self.redis.pool_size.max(1)
    }

    pub fn jwt_secret(&self) -> &str {
        &self.security.jwt_secret
    }

    pub fn secret(&self) -> &str {
        &self.security.secret
    }

    pub fn encryption(&self) -> Encryption {
        Encryption::from_str(&self.security.encryption)
    }

    pub fn aes_key(&self) -> Option<&str> {
        self.security.aes_key.as_deref()
    }

    pub fn cors_origins(&self) -> &[String] {
        &self.cors.origins
    }

    pub fn captcha_enabled(&self) -> bool {
        self.auth.captcha.enabled
    }

    pub fn captcha_base_url(&self) -> &str {
        &self.auth.captcha.base_url
    }

    pub fn captcha_api_key(&self) -> &str {
        &self.auth.captcha.api_key
    }

    pub fn captcha_kind(&self) -> &str {
        &self.auth.captcha.kind
    }

    pub fn captcha_timeout_ms(&self) -> u64 {
        self.auth.captcha.timeout_ms.max(1)
    }

    pub fn captcha_ip_rate_limit(&self) -> u32 {
        self.auth.captcha.ip_rate_limit.max(1)
    }

    pub fn aliyun_timeout_ms(&self) -> u64 {
        self.aliyun.timeout_ms.max(1)
    }

    pub fn aliyun_sms(&self) -> &AliyunSmsConfig {
        &self.aliyun.sms
    }

    pub fn aliyun_mail(&self) -> &AliyunMailConfig {
        &self.aliyun.mail
    }

    pub fn aliyun_oss(&self) -> &AliyunOssConfig {
        &self.aliyun.oss
    }

    pub fn gateway_daily_token_quota(&self) -> i64 {
        self.gateway.daily_token_quota
    }

    /// 个人租户免费档日 token 配额（无有效订阅时生效）。
    pub fn gateway_free_daily_token_quota(&self) -> i64 {
        self.gateway.free_daily_token_quota
    }

    /// 全部可开通档位（档位名 → 日 token 配额）；空表 = 平台未开放任何档位。
    ///
    /// 档位目录接口用它渲染可选项，避免客户端手填档位名。
    pub fn gateway_plan_daily_token_quota_table(&self) -> &HashMap<String, i64> {
        &self.gateway.plan_daily_token_quota
    }

    /// 个人租户订阅档位日 token 配额；未知档位返回 `None`（调用方回落免费档）。
    pub fn gateway_plan_daily_token_quota(&self, plan: &str) -> Option<i64> {
        self.gateway
            .plan_daily_token_quota
            .get(plan)
            .copied()
            .filter(|quota| *quota > 0)
    }

    pub fn gateway_upstream_timeout_ms(&self) -> u64 {
        self.gateway.upstream_timeout_ms.max(1)
    }

    pub fn gateway_audit_enabled(&self) -> bool {
        self.gateway.audit_enabled
    }

    /// 服务身份令牌的签发密钥；空表示服务身份端点未启用。
    pub fn gateway_service_token_secret(&self) -> &str {
        self.gateway.service_token_secret.trim()
    }

    /// 服务身份令牌有效期（秒）：`0` 视为未配置走默认值，并夹到 `[1, 3600]`。
    pub fn gateway_service_token_ttl_secs(&self) -> u64 {
        match self.gateway.service_token_ttl_secs {
            0 => 300,
            secs => secs.clamp(1, SERVICE_TOKEN_MAX_TTL_SECS),
        }
    }

    pub fn pay_order_ttl_secs(&self) -> u64 {
        self.pay.order_ttl_secs.clamp(60, 24 * 3600)
    }

    /// 档位计价；未定价（`amount <= 0`）返回 `None`，调用方据此判定「不可售」。
    pub fn pay_plan(&self, plan: &str) -> Option<&PayPlanConfig> {
        self.pay.plans.get(plan).filter(|spec| spec.amount > 0)
    }

    /// 全部可售档位（已过滤未定价项）。
    pub fn pay_plans(&self) -> impl Iterator<Item = (&String, &PayPlanConfig)> {
        self.pay.plans.iter().filter(|(_, spec)| spec.amount > 0)
    }

    pub fn pay_wechat(&self) -> &WechatPayConfig {
        &self.pay.wechat
    }

    pub fn pay_alipay(&self) -> &AlipayPayConfig {
        &self.pay.alipay
    }

    /// 测试与守卫用构造器。
    pub fn test(jwt_secret: impl Into<String>) -> Self {
        let mut cfg = Configure::default();
        cfg.security.jwt_secret = jwt_secret.into();
        cfg
    }
}

fn is_placeholder_secret(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("change-me") || lower == "secret" || lower.starts_with("your-")
}

/// PostgreSQL schema 名（duroxide-pg 会把它直接拼进 SQL，所以白名单必须收紧）。
fn is_valid_schema_name(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_postgres_url(value: &str) -> bool {
    value.starts_with("postgres://") || value.starts_with("postgresql://")
}

/// 模型接口认的工具名：`[A-Za-z0-9_-]{1,64}`。
///
/// 与契约里的**能力名**（`rag.search` 这种带点号的）是两套命名，混用会在模型接口上被拒。
fn is_tool_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 阿里云 RPC 的 endpoint 必须是裸 origin：带路径会让签名覆盖的 URI 与实际请求不一致。
fn require_http_origin(name: &str, value: &str) -> Result<()> {
    let value = value.trim();
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"));
    let Some(rest) = rest else {
        bail!("{name} must be an http(s) url");
    };
    let host = rest.split('/').next().unwrap_or_default();
    if host.is_empty() {
        bail!("{name} must include a host");
    }
    if rest.len() > host.len() {
        bail!("{name} must be an origin without a path（只填 https://host）");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_merges_development_profile() {
        let cfg = Configure::load().expect("load config");
        assert_eq!(cfg.profile, "development");
        assert_eq!(cfg.app.env, "development");
        assert!(cfg.auth.otp.mock);
    }

    #[test]
    fn shipped_config_has_the_agent_section() {
        // 段名写错时 serde 会静默套用默认值（没有 deny_unknown_fields），所以这里直接看
        // 合并后的原始配置：键在不在、形状对不对。
        let merged = load_merged_config("development").expect("load merged");
        let model = merged
            .get_string("agent.chat_model")
            .expect("agent.chat_model 缺失或不是字符串");
        assert_eq!(model, "deepseek-chat");
        let max_steps = merged
            .get_int("agent.max_steps")
            .expect("agent.max_steps 缺失或不是整数");
        assert_eq!(max_steps, 6);
        let tools = merged
            .get_array("agent.allowed_tools")
            .expect("agent.allowed_tools 缺失或不是数组");
        let names: Vec<String> = tools
            .iter()
            .map(|tool| tool.clone().into_string().expect("工具名必须是字符串"))
            .collect();
        assert_eq!(
            names,
            vec!["knowledge_search", "asset_read", "memory_recall"],
            "默认给两个只读工具 + 记忆召回"
        );
        assert!(
            !names.iter().any(|tool| tool == "memory_write"),
            "写入类工具要运维显式开启：它写的记忆会被之后的任务召回"
        );
    }

    #[test]
    fn validate_rejects_short_jwt() {
        let mut cfg = Configure::default();
        cfg.security.jwt_secret = "short".into();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn validate_rejects_empty_secrets() {
        let mut cfg = Configure::default();
        cfg.security.jwt_secret = String::new();
        let err = cfg.validate().expect_err("empty jwt_secret must fail");
        assert!(err.to_string().contains("security.jwt_secret"));

        let mut cfg = Configure::default();
        cfg.security.secret = "   ".into();
        let err = cfg.validate().expect_err("blank secret must fail");
        assert!(err.to_string().contains("security.secret"));
    }

    /// 生产基线：`security.*` 换成真值，避免被 security 的占位检查先拦下。
    fn production_baseline() -> Configure {
        let mut cfg = Configure::default();
        cfg.app.env = "production".into();
        cfg.security.secret = "sY8wQ2nVt5rLk0dZb3xPm7aC".into();
        cfg.security.jwt_secret = "Qd7tRn0kLc7dYb3xM8s2wvQ1Zp5tRn0kLc7dYb3x".into();
        cfg
    }

    /// 模板里的占位凭据抄一份就上线，是最常见的翻车姿势（生产必须拒绝，本地必须放过）。
    #[test]
    fn validate_rejects_placeholder_gateway_secret_in_production() {
        let mut cfg = production_baseline();
        assert!(cfg.validate().is_ok(), "生产基线本身必须合法");

        cfg.gateway.service_token_secret = "change-me-service-token-secret".into();
        let err = cfg.validate().expect_err("占位服务令牌密钥在生产必须失败");
        assert!(err.to_string().contains("gateway.service_token_secret"));

        // 留空 = 服务身份面整体关闭（是明确选择），不算占位。
        cfg.gateway.service_token_secret = String::new();
        assert!(cfg.validate().is_ok());

        cfg.app.env = "development".into();
        cfg.gateway.service_token_secret = "change-me-service-token-secret".into();
        assert!(cfg.validate().is_ok(), "非生产保留占位值必须能启动");
    }

    #[test]
    fn validate_rejects_half_configured_wechat_pay() {
        let mut cfg = Configure::default();
        cfg.pay.wechat.enabled = true;
        let err = cfg
            .validate()
            .expect_err("half configured wechat must fail");
        assert!(err.to_string().contains("pay.wechat.mch_id"));
    }

    #[test]
    fn validate_rejects_priced_plan_without_quota() {
        let mut cfg = Configure::default();
        cfg.pay.plans.insert(
            "PRO".to_string(),
            PayPlanConfig {
                amount: 1900,
                duration_days: Some(30),
                label: None,
            },
        );
        assert!(cfg.validate().is_err());

        cfg.gateway
            .plan_daily_token_quota
            .insert("PRO".to_string(), 5_000_000);
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn durable_defaults_are_valid() {
        let cfg = Configure::default();
        assert_eq!(cfg.durable.schema, "durable");
        assert!(cfg.durable.auto_migrate);
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn validate_rejects_public_durable_schema() {
        let mut cfg = Configure::default();
        cfg.durable.schema = "public".into();
        let err = cfg.validate().expect_err("public schema must fail");
        assert!(err.to_string().contains("durable.schema"));
    }

    #[test]
    fn validate_rejects_malformed_durable_schema() {
        let mut cfg = Configure::default();
        cfg.durable.schema = "durable-history".into();
        assert!(cfg.validate().is_err());

        cfg.durable.schema = "9durable".into();
        assert!(cfg.validate().is_err());

        cfg.durable.schema = "_durable2".into();
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn validate_rejects_zero_durable_concurrency() {
        let mut cfg = Configure::default();
        cfg.durable.worker_concurrency = 0;
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn require_durable_settings_falls_back_to_database_url() {
        let mut cfg = Configure::default();
        cfg.database.url = "postgres://postgres:postgres@127.0.0.1:5432/app".into();
        assert_eq!(
            cfg.require_durable_settings().expect("resolved"),
            "postgres://postgres:postgres@127.0.0.1:5432/app"
        );

        cfg.durable.database_url = "postgresql://postgres:postgres@127.0.0.1:55432/durable".into();
        assert_eq!(
            cfg.require_durable_settings().expect("resolved"),
            "postgresql://postgres:postgres@127.0.0.1:55432/durable"
        );

        cfg.durable.database_url = "mysql://root@127.0.0.1/app".into();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn validate_rejects_lock_renewal_buffer_not_smaller_than_timeout() {
        let mut cfg = Configure::default();
        cfg.durable.worker_lock_renewal_buffer_ms = cfg.durable.worker_lock_timeout_ms;
        let err = cfg.validate().expect_err("buffer == timeout must fail");
        assert!(err.to_string().contains("worker_lock_renewal_buffer_ms"));
    }

    #[test]
    fn ai_worker_defaults_are_valid_but_not_runnable() {
        let cfg = Configure::default();
        assert_eq!(cfg.ai_worker.embed_batch_size, 16);
        assert!(!cfg.ai_worker.use_system_proxy);
        assert!(cfg.validate().is_ok());
        // 形状合法 ≠ 能跑：地址与令牌缺失由 orchestrator 启动时判定。
        let err = cfg
            .require_ai_worker_settings()
            .expect_err("empty ai_worker must fail");
        assert!(err.to_string().contains("ai_worker.base_url"));
    }

    #[test]
    fn require_ai_worker_settings_needs_both_url_and_token() {
        let mut cfg = Configure::default();
        cfg.ai_worker.base_url = "http://127.0.0.1:8081".into();
        assert!(cfg.require_ai_worker_settings().is_err());

        cfg.ai_worker.token = "dev-internal-token".into();
        assert!(cfg.require_ai_worker_settings().is_ok());
    }

    #[test]
    fn require_ai_worker_settings_rejects_placeholder_token_in_production() {
        let mut cfg = production_baseline();
        cfg.ai_worker.base_url = "http://ai-worker:8081".into();
        cfg.ai_worker.token = "change-me-internal-token".into();
        let err = cfg
            .require_ai_worker_settings()
            .expect_err("占位内部令牌在生产必须失败");
        assert!(err.to_string().contains("ai_worker.token"));

        cfg.app.env = "development".into();
        assert!(cfg.require_ai_worker_settings().is_ok());
    }

    #[test]
    fn telemetry_defaults_are_off_and_valid() {
        let cfg = Configure::default();
        assert!(!cfg.telemetry.enabled);
        assert_eq!(cfg.telemetry.endpoint, "http://127.0.0.1:4318");
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn validate_rejects_malformed_telemetry_config() {
        let mut cfg = Configure::default();
        // 关闭时地址写错也不拦：默认配置必须能过校验。
        cfg.telemetry.endpoint = "not-a-url".into();
        assert!(cfg.validate().is_ok());

        cfg.telemetry.enabled = true;
        assert!(cfg.validate().is_err());

        cfg.telemetry.endpoint = "127.0.0.1:4318".into();
        let err = cfg.validate().expect_err("缺少 scheme 必须失败");
        assert!(err.to_string().contains("telemetry.endpoint"));

        cfg.telemetry.endpoint = "http://127.0.0.1:4318".into();
        cfg.telemetry.sample_ratio = 1.5;
        let err = cfg.validate().expect_err("采样比例越界必须失败");
        assert!(err.to_string().contains("telemetry.sample_ratio"));

        cfg.telemetry.sample_ratio = 0.0;
        cfg.telemetry.timeout_ms = 0;
        let err = cfg.validate().expect_err("超时为 0 必须失败");
        assert!(err.to_string().contains("telemetry.timeout_ms"));

        cfg.telemetry.timeout_ms = 10_000;
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn validate_rejects_malformed_ai_worker_config() {
        let mut cfg = Configure::default();
        cfg.ai_worker.base_url = "127.0.0.1:8081".into();
        assert!(cfg.validate().is_err());

        cfg.ai_worker.base_url = "http://127.0.0.1:8081".into();
        cfg.ai_worker.embed_batch_size = 0;
        assert!(cfg.validate().is_err());

        cfg.ai_worker.embed_batch_size = 16;
        cfg.ai_worker.embed_model = "  ".into();
        assert!(cfg.validate().is_err());

        cfg.ai_worker.embed_model = "text-embedding-3-small".into();
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn agent_defaults_are_usable_and_shaped() {
        let cfg = Configure::default();
        assert_eq!(cfg.agent.chat_model, "deepseek-chat");
        assert_eq!(cfg.agent.max_steps, 6);
        assert_eq!(
            cfg.agent.approval_ttl_secs,
            AgentConfig::DEFAULT_APPROVAL_TTL_SECS
        );
        assert!(
            cfg.agent.allowed_tools.iter().all(|t| is_tool_name(t)),
            "默认工具名必须过得了模型接口的名字规则"
        );
        assert_eq!(
            cfg.agent.allowed_tools,
            vec!["knowledge_search", "asset_read", "memory_recall"],
            "默认 = 只读工具 + 记忆召回；写入类工具必须由运维显式开"
        );
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn validate_rejects_malformed_agent_config() {
        let mut cfg = Configure::default();

        cfg.agent.chat_model = "  ".into();
        let err = cfg.validate().expect_err("空模型名必须失败");
        assert!(err.to_string().contains("agent.chat_model"));

        cfg.agent.chat_model = "deepseek-chat".into();
        cfg.agent.max_steps = 0;
        let err = cfg.validate().expect_err("0 轮预算必须失败");
        assert!(err.to_string().contains("agent.max_steps"));

        cfg.agent.max_steps = 6;
        cfg.agent.approval_ttl_secs = AgentConfig::MIN_APPROVAL_TTL_SECS - 1;
        let err = cfg.validate().expect_err("过短的审批等待必须失败");
        assert!(err.to_string().contains("agent.approval_ttl_secs"));

        cfg.agent.approval_ttl_secs = AgentConfig::MIN_APPROVAL_TTL_SECS;
        cfg.agent.allowed_tools = vec!["rag.search".into()];
        let err = cfg.validate().expect_err("带点号的工具名必须失败");
        assert!(err.to_string().contains("agent.allowed_tools"));

        cfg.agent.allowed_tools = vec!["knowledge_search".into()];
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn tool_names_follow_the_model_api_rules() {
        assert!(is_tool_name("knowledge_search"));
        assert!(is_tool_name("asset-read"));
        assert!(is_tool_name("a"));

        assert!(!is_tool_name(""), "空名字会被模型接口拒");
        assert!(!is_tool_name("rag.search"), "点号是能力名的写法");
        assert!(!is_tool_name("knowledge search"));
        assert!(!is_tool_name(&"a".repeat(65)), "长度上限 64");
    }

    #[test]
    fn gateway_service_token_defaults_are_off_but_shaped() {
        let cfg = Configure::default();
        // 默认不带密钥：服务身份端点整体关闭，只有显式配置才开门。
        assert!(cfg.gateway_service_token_secret().is_empty());
        assert_eq!(cfg.gateway_service_token_ttl_secs(), 300);
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn gateway_service_token_ttl_is_clamped_and_validated() {
        let mut cfg = Configure::default();
        cfg.gateway.service_token_ttl_secs = 0;
        assert_eq!(cfg.gateway_service_token_ttl_secs(), 300, "0 视为未配置");

        cfg.gateway.service_token_secret = "dev-service-token-secret".into();
        cfg.gateway.service_token_ttl_secs = 60;
        assert_eq!(cfg.gateway_service_token_ttl_secs(), 60);
        assert!(cfg.validate().is_ok());

        cfg.gateway.service_token_ttl_secs = 86_400;
        let err = cfg.validate().expect_err("超上限必须拦下");
        assert!(err.to_string().contains("service_token_ttl_secs"));
    }
}
