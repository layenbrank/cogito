use super::common::{
    CaptchaEnvelope, EmptyEnvelope, Exception, ProfileEnvelope, SigninEnvelope, SignupEnvelope,
};
use crate::services::auth::schema::{
    CaptchaP, EmailSigninP, ForgotPasswordP, OtpP, PasswordP, PhoneSigninP, ProfileP,
    ResetPasswordP, SigninP, SignupP,
};

/// 获取行为验证码（go-captcha 滑块/点选）
#[utoipa::path(
    post,
    path = "/api/v1/auth/captcha",
    tag = "Auth",
    operation_id = "auth.captcha",
    summary = "获取行为验证码",
    description = "公开接口。按客户端 IP 限流（`auth.captcha.ip_rate_limit` / 分钟）。\n\n\
        后端代理 **go-captcha-service** `get-data`，返回滑块拼图数据，供前端 `go-captcha-react` 渲染。\n\n\
        **联调流程（signin / signup / otp 前必做）：**\n\
        1. 调用本接口（可选 body `kind`，默认 `auth.captcha.kind` 如 `slide-default`）\n\
        2. 取 `data.captchaKey`、`masterImage`、`thumbImage`、`thumbX`/`thumbY` 等\n\
        3. 用户完成交互后，在后续请求填写 `captchaKey` + `captchaValue`\n\n\
        校验由侧车 `check-data` 完成；TTL 由侧车 Redis 缓存管理。",
    request_body(
        content = CaptchaP,
        description = "可选：指定题型 ID",
        example = json!({ "kind": "slide-default" })
    ),
    responses(
        (status = 200, description = "生成成功（code=200000）", body = CaptchaEnvelope),
        (status = "default", description = "业务异常（IP 限流（code=500304） / 侧车不可用（code=100002） / 缓存异常）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn captcha_doc() {}

/// 发送 OTP（短信 / 邮件）
#[utoipa::path(
    post,
    path = "/api/v1/auth/otp",
    tag = "Auth",
    operation_id = "auth.otp",
    summary = "发送 OTP",
    description = "公开接口。先通过行为验证码防刷，再向手机或邮箱发送一次性验证码。\n\n\
        - `channel`：`PHONE` 或 `EMAIL`\n\
        - `target`：手机号或邮箱（须与账号资料一致时用于登录）\n\
        - `captchaKey` / `captchaValue`：来自 `POST /api/v1/auth/captcha` 与用户交互结果\n\
        - 冷却时间 `auth.otp.cooldown_secs`（默认 60s）\n\
        - 开发环境 `auth.otp.mock=true` 时 OTP 写入服务日志（`otp mock send`），不真正发短信/邮件\n\n\
        成功时 `data` 为空，仅 `msg` 提示已发送。",
    request_body(
        content = OtpP,
        description = "渠道、目标与行为验证码",
        example = json!({
            "channel": "PHONE",
            "target": "13800138000",
            "captchaKey": "xxxx-xxxxx",
            "captchaValue": "120"
        })
    ),
    responses(
        (status = 200, description = "发送成功（code=200000，无 data）", body = EmptyEnvelope),
        (status = "default", description = "业务异常（验证码错误（code=500302） / 验证码已过期（code=500303） / 发送过于频繁（code=500304） / 参数无效）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn otp_doc() {}

/// 用户登录（用户名 + 密码）
#[utoipa::path(
    post,
    path = "/api/v1/auth/signin",
    tag = "Auth",
    operation_id = "auth.signin",
    summary = "用户登录（密码）",
    description = "公开接口。须携带**行为验证码**字段，否则 JSON 反序列化失败（400）。\n\n\
        **推荐顺序：**\n\
        1. `POST /api/v1/auth/captcha` → 拼图数据 + `captchaKey`\n\
        2. 本接口：`username` + `password` + `captchaKey` + `captchaValue`\n\n\
        成功后返回 JWT；Apifox 将 `data.token` 写入环境变量 `token`。\n\
        联调默认账号：`admin` / `123456`。",
    request_body(
        content = SigninP,
        description = "登录凭证（验证码字段均为必填）",
        example = json!({
            "username": "admin",
            "password": "123456",
            "captchaKey": "dev",
            "captchaValue": "0"
        })
    ),
    responses(
        (status = 200, description = "登录成功（code=200000）", body = SigninEnvelope),
        (status = "default", description = "业务异常（用户名或密码错误（code=500301） / 验证码错误（code=500302） / 验证码已过期（code=500303） / 失败次数过多锁定（code=500304））：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn signin_doc() {}

/// 手机号 + OTP 登录
#[utoipa::path(
    post,
    path = "/api/v1/auth/signin/phone",
    tag = "Auth",
    operation_id = "auth.signinPhone",
    summary = "手机号登录（OTP）",
    description = "公开接口。须先 `POST /api/v1/auth/otp`（`channel=PHONE`）获取短信验证码。\n\n\
        - `phone`：与 OTP 发送目标一致\n\
        - `code`：OTP 六位数字（开发环境见服务日志）\n\n\
        无需行为验证码；OTP 校验成功后消费。",
    request_body(
        content = PhoneSigninP,
        description = "手机号与 OTP",
        example = json!({
            "phone": "13800138000",
            "code": "123456"
        })
    ),
    responses(
        (status = 200, description = "登录成功（code=200000）", body = SigninEnvelope),
        (status = "default", description = "业务异常（OTP 错误（code=500306） / OTP 过期（code=500307） / 用户不存在或账号异常 / OTP 锁定（code=500304））：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn signin_phone_doc() {}

/// 邮箱 + OTP 登录
#[utoipa::path(
    post,
    path = "/api/v1/auth/signin/email",
    tag = "Auth",
    operation_id = "auth.signinEmail",
    summary = "邮箱登录（OTP）",
    description = "公开接口。须先 `POST /api/v1/auth/otp`（`channel=EMAIL`）获取邮件验证码。\n\n\
        - `email`：与 OTP 发送目标一致\n\
        - `code`：OTP 六位数字（开发环境见服务日志）",
    request_body(
        content = EmailSigninP,
        description = "邮箱与 OTP",
        example = json!({
            "email": "admin@example.com",
            "code": "123456"
        })
    ),
    responses(
        (status = 200, description = "登录成功（code=200000）", body = SigninEnvelope),
        (status = "default", description = "业务异常（OTP 错误（code=500306） / OTP 过期（code=500307） / 用户不存在或账号异常 / OTP 锁定（code=500304））：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn signin_email_doc() {}

/// 用户注册
#[utoipa::path(
    post,
    path = "/api/v1/auth/signup",
    tag = "Auth",
    operation_id = "auth.signup",
    summary = "用户注册",
    description = "公开接口，须携带行为验证码。注册成功后自动登录并返回 JWT。\n\n\
        字段与 `signin` 相同（`username` / `password` / `captchaKey` / `captchaValue`）。\n\
        建议先 `POST /api/v1/auth/captcha`。",
    request_body(
        content = SignupP,
        description = "注册凭证（验证码字段均为必填）",
        example = json!({
            "username": "admin",
            "password": "123456",
            "captchaKey": "dev",
            "captchaValue": "0"
        })
    ),
    responses(
        (status = 200, description = "注册成功（code=200000）", body = SignupEnvelope),
        (status = "default", description = "业务异常（用户名已存在（code=500102） / 验证码错误（code=500302） / 验证码已过期（code=500303） / 其他业务错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn signup_doc() {}

/// 获取当前用户 Profile
#[utoipa::path(
    get,
    path = "/api/v1/auth/profile",
    tag = "Auth",
    operation_id = "auth.toRead",
    summary = "获取个人信息",
    description = "需要 JWT 鉴权，返回当前登录用户的 profile（含 avatar 元数据）。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "获取成功（code=200000）", body = ProfileEnvelope),
        (status = "default", description = "业务异常（未登录（code=300001））：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRead_doc() {}

/// 更新当前用户 Profile
#[utoipa::path(
    put,
    path = "/api/v1/auth/profile",
    tag = "Auth",
    operation_id = "auth.toUpdate",
    summary = "更新个人信息",
    description = "需要 JWT 鉴权。可更新 `email`、`phone`、`gender`、`birthday`、`avatar`（asset UUID）。\n\
        所有字段可选；`avatar` 传 `null` 可清空头像。\n\
        `avatar` 须是本人已完成（COMPLETED）的资产；绑定后该资产可见性会提为 `PUBLIC`（头像属于公开档案数据）。",
    security(("bearer_auth" = [])),
    request_body(
        content = ProfileP,
        description = "可更新字段（均为可选）",
        example = json!({
            "email": "admin@example.com",
            "phone": "13800138000",
            "gender": "MALE",
            "birthday": "1990-01-01",
            "avatar": "550e8400-e29b-41d4-a716-446655440000"
        })
    ),
    responses(
        (status = 200, description = "更新成功（code=200000）", body = ProfileEnvelope),
        (status = "default", description = "业务异常（未登录或参数错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toUpdate_doc() {}

/// 登出（JWT 黑名单）
#[utoipa::path(
    post,
    path = "/api/v1/auth/signout",
    tag = "Auth",
    operation_id = "auth.signout",
    summary = "用户登出",
    description = "需要 JWT。将当前 token 写入 Redis 黑名单直至过期，之后该 token 不可再用。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "登出成功（code=200000）", body = EmptyEnvelope),
        (status = "default", description = "业务异常（未登录或缓存异常）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn signout_doc() {}

/// 找回密码（发 OTP）
#[utoipa::path(
    post,
    path = "/api/v1/auth/password/forgot",
    tag = "Auth",
    operation_id = "auth.passwordForgot",
    summary = "找回密码（发 OTP）",
    description = "公开接口。须行为验证码。提供 `username` **或** `channel`+`target`（二选一）。\n\n\
        向账号已绑定的手机/邮箱发送找回密码 OTP（`password_reset` 用途，与登录 OTP 隔离）。\n\
        用户不存在或未绑定渠道时仍返回成功，防止枚举。\n\
        受 `auth.rate_limit` IP 限流保护（超限 code=200005）。",
    request_body(content = ForgotPasswordP),
    responses(
        (status = 200, description = "已受理（code=200000）", body = EmptyEnvelope),
        (status = "default", description = "业务异常（请求频率过高（code=200005） / 验证码或参数错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn password_forgot_doc() {}

/// 重置密码（OTP + 新密码）
#[utoipa::path(
    post,
    path = "/api/v1/auth/password/reset",
    tag = "Auth",
    operation_id = "auth.passwordReset",
    summary = "重置密码",
    description = "公开接口。凭找回密码 OTP 设置新密码（不自动登录）。\n\
        提供 `username` **或** `channel`+`target`（须与发码时一致或能匹配绑定渠道）。",
    request_body(content = ResetPasswordP),
    responses(
        (status = 200, description = "重置成功（code=200000）", body = EmptyEnvelope),
        (status = "default", description = "业务异常（OTP 错误或过期 / 密码强度不够（code=500105） / 重置失败（code=500305））：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn password_reset_doc() {}

/// 修改密码（已登录）
#[utoipa::path(
    put,
    path = "/api/v1/auth/password",
    tag = "Auth",
    operation_id = "auth.password",
    summary = "修改密码",
    description = "需要 JWT。校验原密码后更新；成功后吊销当前 token，须重新登录。",
    security(("bearer_auth" = [])),
    request_body(content = PasswordP),
    responses(
        (status = 200, description = "修改成功（code=200000）", body = EmptyEnvelope),
        (status = "default", description = "业务异常（原密码错误或弱密码 / 未登录）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn password_doc() {}
