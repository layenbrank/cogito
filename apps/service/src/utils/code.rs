//! 业务状态码（响应字段 `code`；非 HTTP status）
//!
//! 编码规则: XXYYZZ
//! XX: 模块代码 (00-99)
//! YY: 功能代码 (00-99)
//! ZZ: 错误代码 (00-99)
//!
//! 新增错误码时必须同时登记到所属模块的 `ALL`：链路描述（[`description`]）与
//! HTTP 状态码（[`http_status`]）的契约测试只遍历登记过的码，漏登记等于漏门禁。

/// 成功状态码
pub const SUCCESS: i32 = 200000;

/// 系统级错误 (10xxxx)
pub mod system {
    pub const INTERNAL_ERROR: i32 = 100001;
    pub const SERVICE_UNAVAILABLE: i32 = 100002;
    pub const MAINTENANCE: i32 = 100003;
    pub const TIMEOUT: i32 = 100004;
    pub const RESOURCE_EXHAUSTED: i32 = 100005;

    /// 本模块全部状态码
    pub const ALL: &[i32] = &[
        INTERNAL_ERROR,
        SERVICE_UNAVAILABLE,
        MAINTENANCE,
        TIMEOUT,
        RESOURCE_EXHAUSTED,
    ];
}

/// 请求相关错误 (20xxxx)
pub mod request {
    pub const MISSING_PARAMETER: i32 = 200001;
    pub const INVALID_PARAMETER_FORMAT: i32 = 200002;
    pub const INVALID_PARAMETER_VALUE: i32 = 200003;
    pub const REQUEST_TOO_LARGE: i32 = 200004;
    pub const RATE_LIMIT_EXCEEDED: i32 = 200005;
    pub const METHOD_NOT_ALLOWED: i32 = 200006;
    pub const INVALID_HEADER: i32 = 200007;
    pub const UNSUPPORTED_MEDIA_TYPE: i32 = 200008;

    /// 本模块全部状态码
    pub const ALL: &[i32] = &[
        MISSING_PARAMETER,
        INVALID_PARAMETER_FORMAT,
        INVALID_PARAMETER_VALUE,
        REQUEST_TOO_LARGE,
        RATE_LIMIT_EXCEEDED,
        METHOD_NOT_ALLOWED,
        INVALID_HEADER,
        UNSUPPORTED_MEDIA_TYPE,
    ];
}

/// 认证授权错误 (30xxxx)
pub mod auth {
    pub const NOT_LOGGED_IN: i32 = 300001;
    pub const INVALID_CREDENTIALS: i32 = 300002;
    pub const TOKEN_EXPIRED: i32 = 300003;
    pub const ACCOUNT_LOCKED: i32 = 300004;
    pub const ACCOUNT_DISABLED: i32 = 300005;
    pub const INSUFFICIENT_PERMISSIONS: i32 = 300006;
    pub const ACCESS_DENIED: i32 = 300007;
    pub const TWO_FACTOR_REQUIRED: i32 = 300008;

    /// 本模块全部状态码
    pub const ALL: &[i32] = &[
        NOT_LOGGED_IN,
        INVALID_CREDENTIALS,
        TOKEN_EXPIRED,
        ACCOUNT_LOCKED,
        ACCOUNT_DISABLED,
        INSUFFICIENT_PERMISSIONS,
        ACCESS_DENIED,
        TWO_FACTOR_REQUIRED,
    ];
}

/// 资源相关错误 (40xxxx)
pub mod resource {
    pub const NOT_FOUND: i32 = 400001;
    pub const ALREADY_EXISTS: i32 = 400002;
    pub const DELETED: i32 = 400003;
    pub const ACCESS_RESTRICTED: i32 = 400004;
    pub const IN_USE: i32 = 400005;
    pub const QUOTA_EXCEEDED: i32 = 400006;

    /// 本模块全部状态码
    pub const ALL: &[i32] = &[
        NOT_FOUND,
        ALREADY_EXISTS,
        DELETED,
        ACCESS_RESTRICTED,
        IN_USE,
        QUOTA_EXCEEDED,
    ];
}

/// 业务逻辑错误 (50xxxx)
pub mod business {
    /// 用户模块 (5001xx)
    pub mod user {
        pub const NOT_FOUND: i32 = 500101;
        pub const USERNAME_EXISTS: i32 = 500102;
        pub const EMAIL_EXISTS: i32 = 500103;
        pub const PHONE_EXISTS: i32 = 500104;
        pub const WEAK_PASSWORD: i32 = 500105;
        pub const INVALID_STATUS: i32 = 500106;

        /// 本模块全部状态码
        pub const ALL: &[i32] = &[
            NOT_FOUND,
            USERNAME_EXISTS,
            EMAIL_EXISTS,
            PHONE_EXISTS,
            WEAK_PASSWORD,
            INVALID_STATUS,
        ];
    }

    /// 文件上传模块 (5002xx)
    pub mod upload {
        pub const UNSUPPORTED_FILE_TYPE: i32 = 500201;
        pub const FILE_TOO_LARGE: i32 = 500202;
        pub const UPLOAD_FAILED: i32 = 500203;
        pub const FILE_NOT_FOUND: i32 = 500204;
        pub const CHECKSUM_FAILED: i32 = 500205;
        pub const STORAGE_FULL: i32 = 500206;
        pub const SESSION_GONE: i32 = 500207;

        /// 本模块全部状态码
        pub const ALL: &[i32] = &[
            UNSUPPORTED_FILE_TYPE,
            FILE_TOO_LARGE,
            UPLOAD_FAILED,
            FILE_NOT_FOUND,
            CHECKSUM_FAILED,
            STORAGE_FULL,
            SESSION_GONE,
        ];
    }

    /// 认证模块 (5003xx)
    pub mod login {
        pub const INVALID_CREDENTIALS: i32 = 500301;
        pub const INVALID_CAPTCHA: i32 = 500302;
        pub const CAPTCHA_EXPIRED: i32 = 500303;
        pub const TOO_MANY_ATTEMPTS: i32 = 500304;
        pub const RESET_PASSWORD_FAILED: i32 = 500305;
        pub const INVALID_OTP: i32 = 500306;
        pub const OTP_EXPIRED: i32 = 500307;

        /// 本模块全部状态码
        pub const ALL: &[i32] = &[
            INVALID_CREDENTIALS,
            INVALID_CAPTCHA,
            CAPTCHA_EXPIRED,
            TOO_MANY_ATTEMPTS,
            RESET_PASSWORD_FAILED,
            INVALID_OTP,
            OTP_EXPIRED,
        ];
    }

    /// 支付模块 (5004xx)
    pub mod payment {
        /// 订单不存在（或不属于当前租户）
        pub const ORDER_NOT_FOUND: i32 = 500401;
        /// 订单已关闭（超时 / 主动关单），不可再支付
        pub const ORDER_CLOSED: i32 = 500402;
        /// 订单已过期
        pub const ORDER_EXPIRED: i32 = 500403;
        /// 上游回调 / 查单金额与订单金额不一致
        pub const AMOUNT_MISMATCH: i32 = 500404;
        /// 渠道未配置或未开通
        pub const CHANNEL_UNAVAILABLE: i32 = 500405;
        /// 签名或回调验签失败
        pub const SIGNATURE_INVALID: i32 = 500406;
        /// 支付渠道上游返回错误
        pub const UPSTREAM_ERROR: i32 = 500407;
        /// 档位未定价 / 不可售
        pub const PLAN_NOT_PURCHASABLE: i32 = 500408;
        /// 价目不存在（或已被归档）
        pub const PRICE_NOT_FOUND: i32 = 500409;
        /// 同一租户同一型号已存在重叠的价格窗口
        pub const PRICE_WINDOW_OVERLAP: i32 = 500410;
        /// 价格生效区间无效（结束早于开始，或窗口未收窄）
        pub const PRICE_WINDOW_INVALID: i32 = 500411;
        /// 单价超出允许范围
        pub const PRICE_INVALID_AMOUNT: i32 = 500412;
        /// 价格币种与结算币种不一致
        pub const PRICE_CURRENCY_UNSUPPORTED: i32 = 500413;
        /// 对账窗口无效（起点不早于终点，或跨度超过上限）
        pub const RECONCILE_WINDOW_INVALID: i32 = 500414;
        /// 对账合计超出 64 位整数范围
        pub const RECONCILE_AMOUNT_OVERFLOW: i32 = 500415;

        /// 本模块全部状态码
        pub const ALL: &[i32] = &[
            ORDER_NOT_FOUND,
            ORDER_CLOSED,
            ORDER_EXPIRED,
            AMOUNT_MISMATCH,
            CHANNEL_UNAVAILABLE,
            SIGNATURE_INVALID,
            UPSTREAM_ERROR,
            PLAN_NOT_PURCHASABLE,
            PRICE_NOT_FOUND,
            PRICE_WINDOW_OVERLAP,
            PRICE_WINDOW_INVALID,
            PRICE_INVALID_AMOUNT,
            PRICE_CURRENCY_UNSUPPORTED,
            RECONCILE_WINDOW_INVALID,
            RECONCILE_AMOUNT_OVERFLOW,
        ];
    }

    /// 服务端 agent（50xx05 段）
    pub mod agent {
        /// 任务不存在（或不属于当前租户）
        pub const TASK_NOT_FOUND: i32 = 500501;
        /// 任务目标不合法（空白、过短或过长）
        pub const OBJECTIVE_INVALID: i32 = 500502;
        /// 编排不可用：可靠执行运行时未接或起实例失败
        pub const ORCHESTRATION_UNAVAILABLE: i32 = 500503;
        /// 轮次上限超出允许范围
        pub const MAX_STEPS_INVALID: i32 = 500504;
        /// 工具名不在服务端白名单内
        pub const TOOL_NOT_ALLOWED: i32 = 500505;
        /// 这次调用没在等人批（已经批过/超时/任务已结束）
        pub const APPROVAL_NOT_PENDING: i32 = 500506;
        /// 同一次审批已经被给出过相反的决定
        pub const APPROVAL_ALREADY_DECIDED: i32 = 500507;
        /// 决定字面量不合法（人只能批准或驳回）
        pub const APPROVAL_DECISION_INVALID: i32 = 500508;
        /// 审批凭据不合规：批的不是这个资产，或批准人动不了它
        pub const APPROVAL_INVALID: i32 = 500509;

        /// 本模块全部状态码
        pub const ALL: &[i32] = &[
            TASK_NOT_FOUND,
            OBJECTIVE_INVALID,
            ORCHESTRATION_UNAVAILABLE,
            MAX_STEPS_INVALID,
            TOOL_NOT_ALLOWED,
            APPROVAL_NOT_PENDING,
            APPROVAL_ALREADY_DECIDED,
            APPROVAL_DECISION_INVALID,
            APPROVAL_INVALID,
        ];
    }

    /// RAG 索引（50xx06 段）
    pub mod rag {
        /// 索引任务不存在（或不属于当前租户）
        pub const TASK_NOT_FOUND: i32 = 500601;
        /// 资产不存在、不可见或已归档
        pub const ASSET_NOT_FOUND: i32 = 500602;
        /// 资产当前不可索引（未完成上传）
        pub const ASSET_NOT_INDEXABLE: i32 = 500603;
        /// 该资产已有正在运行的索引任务
        pub const INDEX_ALREADY_RUNNING: i32 = 500604;
        /// 编排不可用：可靠执行运行时未接或起实例失败
        pub const ORCHESTRATION_UNAVAILABLE: i32 = 500605;
        /// 检索词为空（没有语义，400 比返回随机块有用）
        pub const EMPTY_QUERY: i32 = 500606;
        /// compute 未接通（api 进程没接计算车间）
        pub const SEARCH_UNAVAILABLE: i32 = 500607;

        /// 本模块全部状态码
        pub const ALL: &[i32] = &[
            TASK_NOT_FOUND,
            ASSET_NOT_FOUND,
            ASSET_NOT_INDEXABLE,
            INDEX_ALREADY_RUNNING,
            ORCHESTRATION_UNAVAILABLE,
            EMPTY_QUERY,
            SEARCH_UNAVAILABLE,
        ];
    }

    /// 会话同步（50xx07 段）
    pub mod chat {
        /// 推上来的批次不合法：批次标识为空、行数或字符串长度超限、行 id 重复等
        pub const BATCH_INVALID: i32 = 500701;
        /// 消息指向了服务端没有的会话（批次内次序不对：会话必须排在消息之前）
        pub const SESSION_MISSING: i32 = 500702;
        /// 拉取游标不合法（`since` 为负、`limit` 越界）
        pub const CURSOR_INVALID: i32 = 500703;

        /// 本模块全部状态码
        pub const ALL: &[i32] = &[BATCH_INVALID, SESSION_MISSING, CURSOR_INVALID];
    }
}

/// 外部服务错误 (60xxxx)
pub mod external {
    pub const DATABASE_ERROR: i32 = 600001;
    pub const DATABASE_OPERATION_FAILED: i32 = 600002;
    pub const CACHE_ERROR: i32 = 600003;
    pub const MESSAGE_QUEUE_ERROR: i32 = 600004;
    pub const THIRD_PARTY_API_ERROR: i32 = 600005;
    pub const NETWORK_TIMEOUT: i32 = 600006;

    /// 本模块全部状态码
    pub const ALL: &[i32] = &[
        DATABASE_ERROR,
        DATABASE_OPERATION_FAILED,
        CACHE_ERROR,
        MESSAGE_QUEUE_ERROR,
        THIRD_PARTY_API_ERROR,
        NETWORK_TIMEOUT,
    ];
}

/// 数据相关错误 (70xxxx)
pub mod data {
    pub const INVALID_FORMAT: i32 = 700001;
    pub const INTEGRITY_CHECK_FAILED: i32 = 700002;
    pub const DUPLICATE_DATA: i32 = 700003;
    pub const DATA_INCONSISTENCY: i32 = 700004;
    pub const DATA_EXPIRED: i32 = 700005;

    /// 本模块全部状态码
    pub const ALL: &[i32] = &[
        INVALID_FORMAT,
        INTEGRITY_CHECK_FAILED,
        DUPLICATE_DATA,
        DATA_INCONSISTENCY,
        DATA_EXPIRED,
    ];
}

/// 全量状态码（契约测试遍历用）
pub fn all_codes() -> Vec<i32> {
    let mut codes = vec![SUCCESS];
    for group in [
        system::ALL,
        request::ALL,
        auth::ALL,
        resource::ALL,
        business::user::ALL,
        business::upload::ALL,
        business::login::ALL,
        business::payment::ALL,
        business::agent::ALL,
        business::rag::ALL,
        business::chat::ALL,
        external::ALL,
        data::ALL,
    ] {
        codes.extend_from_slice(group);
    }
    codes
}

/// 获取状态码的描述信息
pub fn description(code: i32) -> &'static str {
    match code {
        SUCCESS => "操作成功",

        system::INTERNAL_ERROR => "系统内部错误",
        system::SERVICE_UNAVAILABLE => "服务不可用",
        system::MAINTENANCE => "系统维护中",
        system::TIMEOUT => "系统超时",
        system::RESOURCE_EXHAUSTED => "系统资源不足",

        request::MISSING_PARAMETER => "请求参数缺失",
        request::INVALID_PARAMETER_FORMAT => "请求参数格式错误",
        request::INVALID_PARAMETER_VALUE => "请求参数值无效",
        request::REQUEST_TOO_LARGE => "请求体过大",
        request::RATE_LIMIT_EXCEEDED => "请求频率过高",
        request::METHOD_NOT_ALLOWED => "请求方法不支持",
        request::INVALID_HEADER => "请求头缺失或无效",
        request::UNSUPPORTED_MEDIA_TYPE => "请求媒体类型不支持",

        auth::NOT_LOGGED_IN => "用户未登录",
        auth::INVALID_CREDENTIALS => "登录凭证无效",
        auth::TOKEN_EXPIRED => "登录凭证过期",
        auth::ACCOUNT_LOCKED => "账号被锁定",
        auth::ACCOUNT_DISABLED => "账号被禁用",
        auth::INSUFFICIENT_PERMISSIONS => "权限不足",
        auth::ACCESS_DENIED => "访问被拒绝",
        auth::TWO_FACTOR_REQUIRED => "需要二次验证",

        resource::NOT_FOUND => "资源不存在",
        resource::ALREADY_EXISTS => "资源已存在",
        resource::DELETED => "资源已被删除",
        resource::ACCESS_RESTRICTED => "资源访问被限制",
        resource::IN_USE => "资源正在被使用",
        resource::QUOTA_EXCEEDED => "资源配额不足",

        business::user::NOT_FOUND => "用户不存在",
        business::user::USERNAME_EXISTS => "用户名已存在",
        business::user::EMAIL_EXISTS => "邮箱已被注册",
        business::user::PHONE_EXISTS => "手机号已被注册",
        business::user::WEAK_PASSWORD => "密码强度不够",
        business::user::INVALID_STATUS => "用户状态异常",

        business::upload::UNSUPPORTED_FILE_TYPE => "文件类型不支持",
        business::upload::FILE_TOO_LARGE => "文件大小超出限制",
        business::upload::UPLOAD_FAILED => "文件上传失败",
        business::upload::FILE_NOT_FOUND => "文件不存在",
        business::upload::CHECKSUM_FAILED => "文件校验失败",
        business::upload::STORAGE_FULL => "存储空间不足",
        business::upload::SESSION_GONE => "上传会话不存在或已结束",

        business::login::INVALID_CREDENTIALS => "用户名或密码错误",
        business::login::INVALID_CAPTCHA => "验证码错误",
        business::login::CAPTCHA_EXPIRED => "验证码已过期",
        business::login::TOO_MANY_ATTEMPTS => "登录失败次数过多",
        business::login::RESET_PASSWORD_FAILED => "密码重置失败",
        business::login::INVALID_OTP => "动态口令错误",
        business::login::OTP_EXPIRED => "动态口令已过期",

        business::payment::ORDER_NOT_FOUND => "订单不存在",
        business::payment::ORDER_CLOSED => "订单已关闭",
        business::payment::ORDER_EXPIRED => "订单已过期",
        business::payment::AMOUNT_MISMATCH => "支付金额与订单不一致",
        business::payment::CHANNEL_UNAVAILABLE => "支付渠道不可用",
        business::payment::SIGNATURE_INVALID => "支付签名校验失败",
        business::payment::UPSTREAM_ERROR => "支付渠道返回错误",
        business::payment::PLAN_NOT_PURCHASABLE => "该档位暂不可购买",
        business::payment::PRICE_NOT_FOUND => "价目不存在",
        business::payment::PRICE_WINDOW_OVERLAP => "价格窗口重叠",
        business::payment::PRICE_WINDOW_INVALID => "价格生效区间无效",
        business::payment::PRICE_INVALID_AMOUNT => "单价超出允许范围",
        business::payment::PRICE_CURRENCY_UNSUPPORTED => "价格币种不受支持",
        business::payment::RECONCILE_WINDOW_INVALID => "对账窗口无效",
        business::payment::RECONCILE_AMOUNT_OVERFLOW => "对账合计溢出",

        business::agent::TASK_NOT_FOUND => "任务不存在",
        business::agent::OBJECTIVE_INVALID => "任务目标不合法",
        business::agent::ORCHESTRATION_UNAVAILABLE => "任务编排不可用",
        business::agent::MAX_STEPS_INVALID => "轮次上限超出允许范围",
        business::agent::TOOL_NOT_ALLOWED => "工具不在允许清单内",
        business::agent::APPROVAL_NOT_PENDING => "这次调用没有在等待审批",
        business::agent::APPROVAL_ALREADY_DECIDED => "这次审批已有相反的决定",
        business::agent::APPROVAL_DECISION_INVALID => "审批决定不合法",
        business::agent::APPROVAL_INVALID => "审批凭据不合规",

        business::rag::TASK_NOT_FOUND => "索引任务不存在",
        business::rag::ASSET_NOT_FOUND => "资产不存在",
        business::rag::ASSET_NOT_INDEXABLE => "资产不可索引",
        business::rag::INDEX_ALREADY_RUNNING => "该资产已有正在运行的索引任务",
        business::rag::ORCHESTRATION_UNAVAILABLE => "索引编排不可用",
        business::rag::EMPTY_QUERY => "检索词为空",
        business::rag::SEARCH_UNAVAILABLE => "检索服务不可用",

        business::chat::BATCH_INVALID => "同步批次不合法",
        business::chat::SESSION_MISSING => "消息引用的会话不存在",
        business::chat::CURSOR_INVALID => "同步游标不合法",

        external::DATABASE_ERROR => "数据库连接失败",
        external::DATABASE_OPERATION_FAILED => "数据库操作失败",
        external::CACHE_ERROR => "缓存服务异常",
        external::MESSAGE_QUEUE_ERROR => "消息队列异常",
        external::THIRD_PARTY_API_ERROR => "第三方API调用失败",
        external::NETWORK_TIMEOUT => "网络连接超时",

        data::INVALID_FORMAT => "数据格式错误",
        data::INTEGRITY_CHECK_FAILED => "数据完整性校验失败",
        data::DUPLICATE_DATA => "数据重复",
        data::DATA_INCONSISTENCY => "数据不一致",
        data::DATA_EXPIRED => "数据过期",

        _ => "未知错误",
    }
}

/// 业务状态码 → HTTP 状态码
///
/// 契约约定：HTTP 状态码表达「这次调用在协议语义上是否成功」，响应体 `code` 表达
/// 「业务语义为何失败」。两者必须一致，且只由本函数决定——调用点不得自行指定状态码，
/// 否则网关重试策略、告警规则、4xx/5xx 比率都会失真。
///
/// 规则：先精确匹配，未登记时按 XX 家族回落（[`family_fallback`]）。
pub fn http_status(code: i32) -> u16 {
    match code {
        SUCCESS => 200,

        // 10xxxx 系统级
        system::INTERNAL_ERROR => 500,
        system::SERVICE_UNAVAILABLE => 503,
        system::MAINTENANCE => 503,
        system::TIMEOUT => 504,
        system::RESOURCE_EXHAUSTED => 503,

        // 20xxxx 请求
        request::MISSING_PARAMETER => 400,
        request::INVALID_PARAMETER_FORMAT => 400,
        request::INVALID_PARAMETER_VALUE => 400,
        request::REQUEST_TOO_LARGE => 413,
        request::RATE_LIMIT_EXCEEDED => 429,
        request::METHOD_NOT_ALLOWED => 405,
        request::INVALID_HEADER => 400,
        request::UNSUPPORTED_MEDIA_TYPE => 415,

        // 30xxxx 认证授权
        auth::NOT_LOGGED_IN => 401,
        auth::INVALID_CREDENTIALS => 401,
        auth::TOKEN_EXPIRED => 401,
        auth::ACCOUNT_LOCKED => 403,
        auth::ACCOUNT_DISABLED => 403,
        auth::INSUFFICIENT_PERMISSIONS => 403,
        auth::ACCESS_DENIED => 403,
        auth::TWO_FACTOR_REQUIRED => 401,

        // 40xxxx 资源
        resource::NOT_FOUND => 404,
        resource::ALREADY_EXISTS => 409,
        resource::DELETED => 410,
        resource::ACCESS_RESTRICTED => 403,
        resource::IN_USE => 409,
        resource::QUOTA_EXCEEDED => 429,

        // 50xxxx 业务（参数语义不满足 → 422，状态冲突 → 409）
        business::user::NOT_FOUND => 404,
        business::user::USERNAME_EXISTS => 409,
        business::user::EMAIL_EXISTS => 409,
        business::user::PHONE_EXISTS => 409,
        business::user::WEAK_PASSWORD => 422,
        business::user::INVALID_STATUS => 409,

        business::upload::UNSUPPORTED_FILE_TYPE => 415,
        business::upload::FILE_TOO_LARGE => 413,
        business::upload::UPLOAD_FAILED => 500,
        business::upload::FILE_NOT_FOUND => 404,
        business::upload::CHECKSUM_FAILED => 422,
        business::upload::STORAGE_FULL => 507,
        business::upload::SESSION_GONE => 410,

        business::login::INVALID_CREDENTIALS => 401,
        business::login::INVALID_CAPTCHA => 422,
        business::login::CAPTCHA_EXPIRED => 410,
        business::login::TOO_MANY_ATTEMPTS => 429,
        business::login::RESET_PASSWORD_FAILED => 422,
        business::login::INVALID_OTP => 422,
        business::login::OTP_EXPIRED => 410,

        business::payment::ORDER_NOT_FOUND => 404,
        business::payment::ORDER_CLOSED => 409,
        business::payment::ORDER_EXPIRED => 410,
        business::payment::AMOUNT_MISMATCH => 422,
        business::payment::CHANNEL_UNAVAILABLE => 503,
        business::payment::SIGNATURE_INVALID => 401,
        business::payment::UPSTREAM_ERROR => 502,
        business::payment::PLAN_NOT_PURCHASABLE => 409,
        business::payment::PRICE_NOT_FOUND => 404,
        business::payment::PRICE_WINDOW_OVERLAP => 409,
        business::payment::PRICE_WINDOW_INVALID => 422,
        business::payment::PRICE_INVALID_AMOUNT => 422,
        business::payment::PRICE_CURRENCY_UNSUPPORTED => 422,
        business::payment::RECONCILE_WINDOW_INVALID => 422,
        business::payment::RECONCILE_AMOUNT_OVERFLOW => 500,

        business::agent::TASK_NOT_FOUND => 404,
        business::agent::OBJECTIVE_INVALID => 422,
        business::agent::ORCHESTRATION_UNAVAILABLE => 503,
        business::agent::MAX_STEPS_INVALID => 422,
        business::agent::TOOL_NOT_ALLOWED => 422,
        business::agent::APPROVAL_NOT_PENDING => 409,
        business::agent::APPROVAL_ALREADY_DECIDED => 409,
        business::agent::APPROVAL_DECISION_INVALID => 422,
        // 凭据不合规是「无权这么写」，不是「参数写错了」：令牌已经发出去，改不了它
        business::agent::APPROVAL_INVALID => 403,

        business::rag::TASK_NOT_FOUND => 404,
        business::rag::ASSET_NOT_FOUND => 404,
        business::rag::ASSET_NOT_INDEXABLE => 422,
        business::rag::INDEX_ALREADY_RUNNING => 409,
        business::rag::ORCHESTRATION_UNAVAILABLE => 503,
        business::rag::EMPTY_QUERY => 400,
        business::rag::SEARCH_UNAVAILABLE => 503,

        // 同步的三类拒绝都是「请求里写的值不能用」：改参数重发即可，没有服务端状态问题
        business::chat::BATCH_INVALID => 422,
        business::chat::SESSION_MISSING => 422,
        business::chat::CURSOR_INVALID => 422,

        // 60xxxx 外部依赖（我方视角的服务端故障）
        external::DATABASE_ERROR => 500,
        external::DATABASE_OPERATION_FAILED => 500,
        external::CACHE_ERROR => 500,
        external::MESSAGE_QUEUE_ERROR => 500,
        external::THIRD_PARTY_API_ERROR => 502,
        external::NETWORK_TIMEOUT => 504,

        // 70xxxx 数据
        data::INVALID_FORMAT => 400,
        data::INTEGRITY_CHECK_FAILED => 500,
        data::DUPLICATE_DATA => 409,
        data::DATA_INCONSISTENCY => 500,
        data::DATA_EXPIRED => 410,

        other => family_fallback(other),
    }
}

/// 未登记状态码按 XX 家族回落，保证新增错误码也有确定状态码
fn family_fallback(code: i32) -> u16 {
    match code / 10_000 {
        10 => 500,
        20 => 400,
        30 => 401,
        40 => 400,
        50 => 422,
        60 => 502,
        70 => 500,
        _ => 500,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_no_duplicates() {
        let codes = all_codes();
        let mut unique = codes.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), codes.len(), "状态码登记表存在重复项");
        assert!(codes.contains(&SUCCESS));
    }

    #[test]
    fn every_registered_code_has_description() {
        for code in all_codes() {
            assert_ne!(description(code), "未知错误", "状态码 {code} 缺少描述文案");
        }
    }

    #[test]
    fn success_is_the_only_2xx() {
        for code in all_codes() {
            let status = http_status(code);
            if code == SUCCESS {
                assert_eq!(status, 200);
            } else {
                assert!(
                    (400..=599).contains(&status),
                    "状态码 {code} 映射为 {status}，错误必须以 4xx/5xx 表达"
                );
            }
        }
    }

    #[test]
    fn status_reflects_fault_owner() {
        // 调用方过错 → 4xx
        assert_eq!(http_status(request::MISSING_PARAMETER), 400);
        assert_eq!(http_status(request::REQUEST_TOO_LARGE), 413);
        assert_eq!(http_status(request::RATE_LIMIT_EXCEEDED), 429);
        assert_eq!(http_status(request::METHOD_NOT_ALLOWED), 405);
        assert_eq!(http_status(auth::NOT_LOGGED_IN), 401);
        assert_eq!(http_status(auth::INSUFFICIENT_PERMISSIONS), 403);
        assert_eq!(http_status(resource::NOT_FOUND), 404);
        assert_eq!(http_status(resource::ALREADY_EXISTS), 409);
        assert_eq!(http_status(business::login::TOO_MANY_ATTEMPTS), 429);
        assert_eq!(http_status(business::payment::ORDER_CLOSED), 409);

        // 我方 / 上游故障 → 5xx
        assert_eq!(http_status(system::INTERNAL_ERROR), 500);
        assert_eq!(http_status(system::SERVICE_UNAVAILABLE), 503);
        assert_eq!(http_status(system::TIMEOUT), 504);
        assert_eq!(http_status(external::THIRD_PARTY_API_ERROR), 502);
        assert_eq!(http_status(business::payment::UPSTREAM_ERROR), 502);
    }

    #[test]
    fn unknown_code_falls_back_by_family() {
        assert_eq!(http_status(109999), 500);
        assert_eq!(http_status(209999), 400);
        assert_eq!(http_status(309999), 401);
        assert_eq!(http_status(409999), 400);
        assert_eq!(http_status(509999), 422);
        assert_eq!(http_status(609999), 502);
        assert_eq!(http_status(709999), 500);
        assert_eq!(http_status(0), 500);
        assert_eq!(http_status(-1), 500);
    }
}
