//! OpenAPI 后处理（[`Modify`]）——跨操作、跨路径的契约约定集中在这里，
//! 免得 72 个操作各写一遍、各漏一处。

use utoipa::Modify;
use utoipa::openapi::extensions::Extensions;
use utoipa::openapi::path::{Operation, Parameter, ParameterIn, PathItem};
use utoipa::openapi::schema::{ObjectBuilder, Type};
use utoipa::openapi::security::{Http, HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::openapi::{Header, OpenApi, RefOr, Required};

use crate::middlewares::trace::TRACEPARENT;

/// 响应体**不是**平台统一信封的端点（渠道回调，按 `operationId` 标注）。
/// 除这些端点外，每个操作都必须声明 `default` 响应 = `ErrorEnvelope`，由
/// `tests/oas_consistency.rs` 强制校验。
pub const VENDOR_CALLBACK_OPERATIONS: &[&str] = &["payment.notifyWechat", "payment.notifyAlipay"];

/// 标记响应用渠道自有形状（而非平台信封），供契约校验与客户端生成识别。
const RESPONSE_SHAPE_EXTENSION: &str = "x-response-shape";
const RESPONSE_SHAPE_VENDOR: &str = "vendor";

/// OpenAPI 3.1 要求 license 给出 SPDX 标识（`identifier`），闭源软件用 `LicenseRef-*` 表达。
/// derive 宏只能写 `name`/`url`，故在此补齐。
pub const LICENSE_IDENTIFIER: &str = "LicenseRef-Proprietary";

/// traceparent 取值格式：`version-traceid-spanid-flags`（W3C Trace Context）
const TRACEPARENT_PATTERN: &str = "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$";
const TRACEPARENT_EXAMPLE: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const TRACEPARENT_DOC: &str = "W3C Trace Context 链路头（可选）。缺省由服务端生成；\
    响应始终回显该头，响应体信封的 `traceID` 即其 trace-id，可用于串联日志、下游调用与用户反馈。";

/// 鉴权方案 + 全链路头：每个操作都接受 `traceparent`，每个响应都回显它。
pub struct ContractAddon;

impl Modify for ContractAddon {
    fn modify(&self, openapi: &mut OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme("bearer_auth", SecurityScheme::Http(bearer()));
        }

        if let Some(license) = openapi.info.license.as_mut() {
            // SPDX `identifier` 与 `url` 互斥
            license.identifier = Some(LICENSE_IDENTIFIER.to_string());
            license.url = None;
        }

        for item in openapi.paths.paths.values_mut() {
            each_operation(item, &add_trace_parameter);
            each_operation(item, &echo_trace_header);
            each_operation(item, &mark_vendor_response_shape);
        }
    }
}

fn mark_vendor_response_shape(operation: &mut Operation) {
    let is_vendor = operation
        .operation_id
        .as_deref()
        .is_some_and(|id| VENDOR_CALLBACK_OPERATIONS.contains(&id));
    if !is_vendor {
        return;
    }

    operation
        .extensions
        .get_or_insert_with(Default::default)
        .insert(
            RESPONSE_SHAPE_EXTENSION.to_string(),
            serde_json::json!(RESPONSE_SHAPE_VENDOR),
        );
}

fn each_operation(item: &mut PathItem, f: &dyn Fn(&mut Operation)) {
    for operation in [
        &mut item.get,
        &mut item.put,
        &mut item.post,
        &mut item.delete,
        &mut item.options,
        &mut item.head,
        &mut item.patch,
        &mut item.trace,
    ]
    .into_iter()
    .flatten()
    {
        f(operation);
    }
}

fn add_trace_parameter(operation: &mut Operation) {
    let parameters = operation.parameters.get_or_insert_with(Vec::new);
    if parameters.iter().any(|p| p.name == TRACEPARENT) {
        return;
    }

    parameters.push(
        Parameter::builder()
            .name(TRACEPARENT)
            .parameter_in(ParameterIn::Header)
            .required(Required::False)
            .description(Some(TRACEPARENT_DOC))
            .schema(Some(
                ObjectBuilder::new()
                    .schema_type(Type::String)
                    .pattern(Some(TRACEPARENT_PATTERN))
                    .examples([serde_json::json!(TRACEPARENT_EXAMPLE)]),
            ))
            .build(),
    );
}

fn echo_trace_header(operation: &mut Operation) {
    for response in operation.responses.responses.values_mut() {
        let RefOr::T(response) = response else {
            continue;
        };
        if response.headers.contains_key(TRACEPARENT) {
            continue;
        }

        let mut header = Header::new(
            ObjectBuilder::new()
                .schema_type(Type::String)
                .examples([serde_json::json!(TRACEPARENT_EXAMPLE)]),
        );
        header.description = Some(TRACEPARENT_DOC.to_string());
        response.headers.insert(TRACEPARENT.to_string(), header);
    }
}

/// JWT Bearer 安全方案（登录 `POST /api/v1/auth/signin` 返回的 `data.token`）
fn bearer() -> Http {
    let mut http = HttpBuilder::new()
        .scheme(HttpAuthScheme::Bearer)
        .bearer_format("JWT")
        .description(Some(
            "登录 `POST /api/v1/auth/signin` 返回的 `data.token`。\n\n\
             请求头：`Authorization: Bearer {{token}}`。\n\n\
             **Apifox**：鉴权组件 Token 请填 `{{token}}`（勿用 `{{bearerToken}}`）；\
             环境变量名统一为 `token`，可在登录接口后置操作写入。",
        ))
        .build();
    // 供 Apifox / 部分客户端识别的默认占位（标准 OAS 无此字段）
    http.extensions = Some(Extensions::from_iter([
        ("x-default", serde_json::json!("{{token}}")),
        ("x-apifox-default", serde_json::json!("{{token}}")),
    ]));
    http
}
