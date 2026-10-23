//! 阿里云出站契约（P5）：签名落位、请求形状、错误分类、对象存储原语。
//!
//! 全部打本地 HTTP 桩，不需要真实凭据：
//!
//! ```text
//! cargo test --test aliyun
//! ```
//!
//! 关注的不是「阿里云会不会回 OK」，而是**我们发出去的字节**是否符合 V3/V1 规范：
//! 业务参数在查询串（V3）还是表单体（V1）、签名落在哪个头、Content-SHA256 是否算空体、
//! 非 ASCII 参数是否按 UTF-8 百分号编码。这些一旦错了，线上只会表现为「签名错误」。
#![allow(dead_code)]

mod support;

use serde_json::json;
use cogito::clients::aliyun::{AliyunClient, AliyunError};
use cogito::configures::configure::Configure;
use support::{StubHttp, StubResponse};

/// 官方规范里的空字符串 SHA256（V3 的空体必须用这个值而不是省略）。
const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// 全部端点指向同一个桩；`sign_name` 故意用非 ASCII，顺带验证百分号编码。
fn configured(stub: &StubHttp) -> Configure {
    let mut config = Configure::test("test-secret-test-secret-test-secret");
    config.aliyun.access_key_id = "test-ak".to_string();
    config.aliyun.access_key_secret = "test-sk".to_string();
    config.aliyun.timeout_ms = 5_000;
    config.aliyun.sms.endpoint = stub.base_url();
    config.aliyun.sms.sign_name = "某应用".to_string();
    config.aliyun.sms.template_code = "SMS_1234".to_string();
    config.aliyun.mail.endpoint = stub.base_url();
    config.aliyun.mail.account_name = "noreply@example.com".to_string();
    config.aliyun.mail.from_alias = "某应用".to_string();
    config.aliyun.mail.subject = "验证码".to_string();
    config.aliyun.oss.endpoint = stub.base_url();
    config.aliyun.oss.bucket = "assets".to_string();
    // 桩是裸 IP，只能用 path 风格（virtual 风格会把 bucket 顶到 host 上）。
    config.aliyun.oss.addressing_style = "path".to_string();

    config
}

fn client(stub: &StubHttp) -> AliyunClient {
    AliyunClient::from_configure(&configured(stub)).expect("构造阿里云客户端")
}

/// 建桩：先让本机代理放过 loopback（见 `support::bypass_proxy_for_local_stubs`）。
async fn stub(script: Vec<StubResponse>) -> StubHttp {
    support::bypass_proxy_for_local_stubs();

    StubHttp::start(script).await
}

fn ok_sms(biz_id: &str) -> StubResponse {
    StubResponse::json(
        200,
        json!({ "Code": "OK", "BizId": biz_id, "RequestId": "req-1" }),
    )
}

fn error_sms(code: &str) -> StubResponse {
    StubResponse::json(
        400,
        json!({ "Code": code, "Message": "boom", "RequestId": "req-2" }),
    )
}

#[tokio::test]
async fn sms_v3_puts_action_in_headers_and_params_in_query() {
    let stub = stub(vec![ok_sms("biz-1")]).await;
    let client = client(&stub);

    let biz_id = client
        .send_sms_code("13800000000", "123456")
        .await
        .expect("发送");
    assert_eq!(biz_id, "biz-1");

    let request = stub.only();
    assert_eq!(request.method, "POST");
    // V3：业务参数进查询串，公共参数进头。
    assert!(
        request.path.contains("PhoneNumbers=13800000000"),
        "{}",
        request.path
    );
    assert!(
        request.path.contains("TemplateCode=SMS_1234"),
        "{}",
        request.path
    );
    assert!(
        request
            .path
            .contains("TemplateParam=%7B%22code%22%3A%22123456%22%7D"),
        "{}",
        request.path
    );
    assert!(
        request
            .path
            .contains("SignName=%E6%9F%90%E5%BA%94%E7%94%A8"),
        "非 ASCII 参数必须按 UTF-8 百分号编码：{}",
        request.path
    );
    assert!(
        !request.path.contains("Action="),
        "V3 的 Action 不走查询串：{}",
        request.path
    );

    assert_eq!(request.header("x-acs-action").as_deref(), Some("SendSms"));
    assert_eq!(
        request.header("x-acs-version").as_deref(),
        Some("2017-05-25")
    );
    assert_eq!(
        request.header("x-acs-content-sha256").as_deref(),
        Some(EMPTY_SHA256)
    );
    let authorization = request
        .header("authorization")
        .expect("有 Authorization 头");
    // 官方 V3 的凭据段用逗号分隔（与 AWS SigV4 的斜杠不同）。
    assert!(
        authorization.starts_with("ACS3-HMAC-SHA256 Credential=test-ak,"),
        "{authorization}"
    );
    assert!(
        authorization.contains("SignedHeaders=host;x-acs-action;"),
        "{authorization}"
    );
    assert!(request.body.is_empty(), "V3 不带表单体：{}", request.body);
}

#[tokio::test]
async fn sms_v1_puts_action_in_query_and_signs_with_hmac() {
    let stub = stub(vec![ok_sms("biz-v1")]).await;
    let mut config = configured(&stub);
    config.aliyun.signature_version = "v1".to_string();
    let client = AliyunClient::from_configure(&config).expect("构造客户端");

    let biz_id = client
        .send_sms_code("13800000000", "654321")
        .await
        .expect("发送");
    assert_eq!(biz_id, "biz-v1");

    let request = stub.only();
    assert_eq!(request.method, "POST");
    // V1：一切都进查询串，签名是 HMAC-SHA1 的 Base64。
    assert!(request.path.contains("Action=SendSms"), "{}", request.path);
    assert!(
        request.path.contains("SignatureVersion=1.0"),
        "{}",
        request.path
    );
    assert!(
        request.path.contains("AccessKeyId=test-ak"),
        "{}",
        request.path
    );
    assert!(
        request.path.contains("SignatureMethod=HMAC-SHA1"),
        "{}",
        request.path
    );
    assert!(request.path.contains("Signature="), "{}", request.path);
    assert!(
        request
            .path
            .contains("TemplateParam=%7B%22code%22%3A%22654321%22%7D"),
        "{}",
        request.path
    );
    assert!(
        request.header("authorization").is_none(),
        "V1 不用 Authorization 头"
    );
}

#[tokio::test]
async fn sms_error_code_classifies_rate_limit_case_insensitively() {
    // Go 侧车用大小写敏感的比较判限流码，实际上永远命中不了；这里锁住正确行为。
    for code in ["isv.BUSINESS_LIMIT_CONTROL", "isv.business_limit_control"] {
        let stub = stub(vec![error_sms(code)]).await;
        let client = client(&stub);

        let error = client
            .send_sms_code("13800000000", "123456")
            .await
            .expect_err("限流码必须是错误");
        assert!(
            matches!(error, AliyunError::RateLimited(_)),
            "{code} 应为 RateLimited，实际 {error:?}"
        );
    }
}

#[tokio::test]
async fn sms_http_200_with_error_code_is_failure() {
    // 上游限流有时也走 200 + Code，不能只看状态码。
    let stub = stub(vec![StubResponse::json(
        200,
        json!({ "Code": "isv.MOBILE_NUMBER_ILLEGAL", "Message": "手机号非法" }),
    )])
    .await;
    let client = client(&stub);

    let error = client
        .send_sms_code("13800000000", "123456")
        .await
        .expect_err("Code != OK 必须是错误");
    assert!(matches!(error, AliyunError::Failed(_)), "{error:?}");
}

#[tokio::test]
async fn sms_rejection_maps_to_failed() {
    let stub = stub(vec![error_sms("isv.SMS_TEMPLATE_ILLEGAL")]).await;
    let client = client(&stub);

    let error = client
        .send_sms_code("13800000000", "123456")
        .await
        .expect_err("模板非法必须是错误");
    assert!(matches!(error, AliyunError::Failed(_)), "{error:?}");
    assert!(
        error.to_string().contains("isv.SMS_TEMPLATE_ILLEGAL"),
        "{error}"
    );
}

#[tokio::test]
async fn mail_sends_form_body_with_rendered_code() {
    let stub = stub(vec![StubResponse::json(
        200,
        json!({ "EnvId": "env-1", "RequestId": "req-3" }),
    )])
    .await;
    let client = client(&stub);

    let env_id = client
        .send_mail_code("user@example.com", "123456")
        .await
        .expect("发送");
    assert_eq!(env_id.as_deref(), Some("env-1"));

    let request = stub.only();
    assert_eq!(request.method, "POST");
    assert!(
        request
            .header("content-type")
            .unwrap_or_default()
            .starts_with("application/x-www-form-urlencoded"),
        "{:?}",
        request.header("content-type")
    );
    // V3：公共参数（Action/Version）在头里，业务参数在表单体里。
    assert_eq!(
        request.header("x-acs-action").as_deref(),
        Some("SingleSendMail")
    );
    assert_eq!(
        request.header("x-acs-version").as_deref(),
        Some("2015-11-23")
    );
    for fragment in [
        "AccountName=noreply%40example.com",
        "AddressType=1",
        "ReplyToAddress=true",
        "ToAddress=user%40example.com",
        "Subject=%E9%AA%8C%E8%AF%81%E7%A0%81",
    ] {
        assert!(
            request.body.contains(fragment),
            "缺 {fragment}：{}",
            request.body
        );
    }
    assert!(
        request.body.contains("123456"),
        "正文要带上验证码：{}",
        request.body
    );
    assert!(
        !request.body.contains("{code}"),
        "占位符必须被替换：{}",
        request.body
    );
}

#[tokio::test]
async fn mail_missing_placeholder_is_configuration_error() {
    let stub = stub(vec![StubResponse::text(200, "")]).await;
    let mut config = configured(&stub);
    config.aliyun.mail.body_template = "您的验证码是（空）".to_string();
    let client = AliyunClient::from_configure(&config).expect("构造客户端");

    let error = client
        .send_mail_code("user@example.com", "123456")
        .await
        .expect_err("缺占位符必须是错误");
    assert!(matches!(error, AliyunError::NotConfigured(_)), "{error:?}");
    assert!(stub.requests().is_empty(), "配置错误不应发起请求");
}

#[tokio::test]
async fn oss_put_get_and_presign_use_path_style() {
    let stub = stub(vec![
        StubResponse::text(200, ""),
        StubResponse::bytes(200, "text/plain", b"hello".to_vec()),
    ])
    .await;
    let client = client(&stub);
    let oss = client.oss().expect("构造 OSS 客户端");

    oss.put("avatars/a.txt", b"hello".to_vec(), Some("text/plain"))
        .await
        .expect("上传");
    let stored = oss.get("avatars/a.txt").await.expect("下载");
    assert_eq!(String::from_utf8_lossy(&stored), "hello");

    let url = oss
        .presign_read("avatars/a.txt", client.presign_expires())
        .await
        .expect("预签名");
    assert!(url.starts_with(&stub.base_url()), "{url}");
    assert!(url.contains("/assets/avatars/a.txt"), "{url}");
    assert!(url.contains("Signature="), "{url}");

    let requests = stub.requests();
    assert_eq!(requests.len(), 2, "{requests:#?}");
    assert_eq!(requests[0].method, "PUT");
    assert_eq!(requests[0].path, "/assets/avatars/a.txt");
    assert_eq!(requests[0].body, "hello");
    assert_eq!(
        requests[0].header("content-type").as_deref(),
        Some("text/plain")
    );
    assert_eq!(requests[1].method, "GET");
    assert_eq!(requests[1].path, "/assets/avatars/a.txt");
}

#[tokio::test]
async fn missing_credentials_reports_configuration_error() {
    let stub = stub(vec![ok_sms("biz-1")]).await;
    let mut config = configured(&stub);
    config.aliyun.access_key_id = String::new();
    config.aliyun.access_key_secret = String::new();

    let error = AliyunClient::from_configure(&config).expect_err("缺凭据必须报错");
    assert!(matches!(error, AliyunError::NotConfigured(_)), "{error:?}");
    assert!(stub.requests().is_empty(), "缺凭据不应发起请求");
}

#[tokio::test]
async fn unknown_signature_version_reports_configuration_error() {
    let stub = stub(vec![ok_sms("biz-1")]).await;
    let mut config = configured(&stub);
    config.aliyun.signature_version = "v9".to_string();

    let error = AliyunClient::from_configure(&config).expect_err("未知签名版本必须报错");
    assert!(matches!(error, AliyunError::NotConfigured(_)), "{error:?}");
}

#[tokio::test]
async fn default_signature_version_is_v3() {
    let stub = stub(vec![ok_sms("biz-1")]).await;

    // `Configure::default()` 就带 `v3`：这里不显式配置，锁住「默认不用老签名」。
    let client = AliyunClient::from_configure(&configured(&stub)).expect("构造客户端");
    assert_eq!(
        client.signature_version(),
        aliyun::SignatureVersion::V3,
        "阿里云新接入默认 V3"
    );
}
