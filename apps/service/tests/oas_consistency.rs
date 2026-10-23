//! OAS 路由一致性测试：确保所有已注册路由均在 spec 中记录。

use cogito::oas::{self, OpenDoc, paths::ALL_ROUTES};
use utoipa::OpenApi;
use utoipa::openapi::path::{Operation, PathItem};

/// 契约约定：每个操作都要声明 `traceparent` 请求头参数，每个响应都要回显该头。
const TRACEPARENT: &str = "traceparent";
/// 平台信封端点必须声明的兜底响应。
const DEFAULT_RESPONSE: &str = "default";
const ERROR_ENVELOPE: &str = "ErrorEnvelope";
const RESPONSE_SHAPE_EXTENSION: &str = "x-response-shape";

/// 遍历 spec 中全部操作，返回 `(METHOD path, operation)`。
fn operations(spec: &utoipa::openapi::OpenApi) -> Vec<(String, &Operation)> {
    let mut found = Vec::new();
    for (path, item) in &spec.paths.paths {
        for (method, op) in method_operations(item) {
            found.push((format!("{method} {path}"), op));
        }
    }
    found
}

fn method_operations(item: &PathItem) -> Vec<(&'static str, &Operation)> {
    [
        ("GET", item.get.as_ref()),
        ("PUT", item.put.as_ref()),
        ("POST", item.post.as_ref()),
        ("DELETE", item.delete.as_ref()),
        ("OPTIONS", item.options.as_ref()),
        ("HEAD", item.head.as_ref()),
        ("PATCH", item.patch.as_ref()),
        ("TRACE", item.trace.as_ref()),
    ]
    .into_iter()
    .filter_map(|(method, op)| op.map(|op| (method, op)))
    .collect()
}

fn is_vendor_callback(op: &Operation) -> bool {
    op.extensions
        .as_ref()
        .and_then(|ext| ext.get(RESPONSE_SHAPE_EXTENSION))
        .and_then(|value| value.as_str())
        .is_some_and(|shape| shape == "vendor")
}

#[test]
fn every_operation_declares_a_trace_parameter() {
    let spec = OpenDoc::openapi();

    for (name, op) in operations(&spec) {
        let parameter = op
            .parameters
            .as_ref()
            .and_then(|params| {
                params.iter().find(|p| {
                    p.name == TRACEPARENT
                        && p.parameter_in == utoipa::openapi::path::ParameterIn::Header
                })
            })
            .unwrap_or_else(|| panic!("{name} 缺少 {TRACEPARENT} 请求头参数"));

        assert!(
            parameter.required != utoipa::openapi::Required::True,
            "{name} 的 {TRACEPARENT} 不应是必填项"
        );
    }
}

#[test]
fn every_response_echoes_the_trace_header() {
    let spec = OpenDoc::openapi();
    let mut checked = 0;

    for (name, op) in operations(&spec) {
        assert!(!op.responses.responses.is_empty(), "{name} 未声明任何响应");
        for (status, response) in &op.responses.responses {
            let value = serde_json::to_value(response).expect("响应可序列化");
            if value.get("$ref").is_some() {
                continue;
            }
            let header = value
                .get("headers")
                .and_then(|headers| headers.get(TRACEPARENT))
                .unwrap_or_else(|| panic!("{name} 的 {status} 响应缺少 {TRACEPARENT} 回显头"));
            assert!(header.is_object(), "{name} 的 {status} 响应头不是对象");
            checked += 1;
        }
    }

    assert!(checked >= operations(&spec).len());
}

#[test]
fn every_operation_declares_the_error_contract() {
    let spec = OpenDoc::openapi();

    for (name, op) in operations(&spec) {
        let default = op.responses.responses.get(DEFAULT_RESPONSE);

        if is_vendor_callback(op) {
            assert!(
                default.is_none(),
                "{name} 标记为渠道回调，不应声明 default 信封响应"
            );
            continue;
        }

        let response = default.unwrap_or_else(|| {
            panic!("{name} 缺少 default 错误响应（渠道回调需显式标记 x-response-shape=vendor）")
        });
        let value = serde_json::to_value(response).expect("响应可序列化");
        let reference = value
            .pointer("/content/application~1json/schema/$ref")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert!(
            reference.ends_with(ERROR_ENVELOPE),
            "{name} 的 default 响应应引用 {ERROR_ENVELOPE}，实际为 {reference:?}"
        );
    }
}

#[test]
fn every_operation_declares_one_success_response() {
    let spec = OpenDoc::openapi();

    for (name, op) in operations(&spec) {
        let success: Vec<_> = op
            .responses
            .responses
            .keys()
            .filter(|status| {
                status
                    .parse::<u16>()
                    .is_ok_and(|code| (200..300).contains(&code))
            })
            .collect();
        let redirect: Vec<_> = op
            .responses
            .responses
            .keys()
            .filter(|status| {
                status
                    .parse::<u16>()
                    .is_ok_and(|code| (300..400).contains(&code))
            })
            .collect();

        assert!(
            success.len() <= 1,
            "{name} 声明了多个 2xx 成功响应：{success:?}（前者会被后者覆盖）"
        );
        assert!(
            success.len() == 1 || redirect.len() == 1,
            "{name} 应恰好声明一个 2xx 成功响应（重定向端点则为 3xx），实际 2xx={success:?} 3xx={redirect:?}"
        );
    }
}

#[test]
fn oas_sources_declare_unique_response_statuses() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/oas");
    let mut files = 0;

    for entry in std::fs::read_dir(&dir).expect("读取 src/oas 目录") {
        let path = entry.expect("目录项").path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        files += 1;

        let source = std::fs::read_to_string(&path).expect("读取 oas 源文件");
        for (block, statuses) in response_blocks(&source) {
            let mut seen = std::collections::HashSet::new();
            for status in &statuses {
                assert!(
                    seen.insert(status.clone()),
                    "{} 第 {block} 个 responses 块重复声明状态码 {status}（后者会覆盖前者）",
                    path.display()
                );
            }
        }
    }

    assert!(files > 0, "未找到 src/oas 源文件");
}

/// 扫描 `responses(...)` 块，返回 `(块序号, 状态码列表)`。
fn response_blocks(source: &str) -> Vec<(usize, Vec<String>)> {
    let mut blocks = Vec::new();
    let mut rest = source;
    let mut index = 0;

    while let Some(start) = rest.find("responses(") {
        rest = &rest[start + "responses(".len()..];
        index += 1;

        let mut depth = 1;
        let mut end = rest.len();
        for (offset, ch) in rest.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = offset;
                        break;
                    }
                }
                _ => {}
            }
        }

        blocks.push((index, statuses_of(&rest[..end])));
        rest = &rest[end..];
    }

    blocks
}

fn statuses_of(block: &str) -> Vec<String> {
    let mut statuses = Vec::new();
    let mut rest = block;

    while let Some(start) = rest.find("status") {
        rest = &rest[start + "status".len()..];
        let trimmed = rest.trim_start();
        let Some(rest_of_line) = trimmed.strip_prefix('=') else {
            continue;
        };
        let value = rest_of_line.trim_start();
        let value = value
            .strip_prefix('"')
            .and_then(|value| value.split('"').next())
            .map(str::to_string)
            .or_else(|| {
                value
                    .split(|ch: char| !ch.is_ascii_digit())
                    .next()
                    .filter(|digits| !digits.is_empty())
                    .map(str::to_string)
            });
        if let Some(value) = value {
            statuses.push(value);
            rest = rest_of_line;
        }
    }

    statuses
}

#[test]
fn paths_follow_the_version_policy() {
    let spec = OpenDoc::openapi();
    // 运维探针不参与主版本前缀，其余端点必须在 /api/v1 下
    const VERSION_FREE_PATHS: &[&str] = &["/api/health", "/api/live", "/api/ready"];

    for path in spec.paths.paths.keys() {
        assert!(
            path.starts_with("/api/v1/") || VERSION_FREE_PATHS.contains(&path.as_str()),
            "{path} 未按版本策略放在 /api/v1 下（运维探针需显式加入白名单）"
        );
    }

    for route in ALL_ROUTES {
        assert!(
            route.path.starts_with("/api/v1/") || VERSION_FREE_PATHS.contains(&route.path),
            "路由 {} 未按版本策略放在 /api/v1 下",
            route.path
        );
    }
}

#[test]
fn info_version_tracks_the_build_version() {
    let spec = OpenDoc::openapi();
    let version = spec.info.version.clone();
    assert_eq!(
        version,
        env!("CARGO_PKG_VERSION"),
        "契约版本必须取构建版本（Cargo.toml），手写版本号会与发布脱节"
    );

    let mut parts = version.split('.');
    assert!(
        parts
            .next()
            .is_some_and(|major| major.parse::<u64>().is_ok())
            && parts
                .next()
                .is_some_and(|minor| minor.parse::<u64>().is_ok())
            && parts
                .next()
                .is_some_and(|patch| patch.parse::<u64>().is_ok()),
        "info.version 应为 semver，实际 {version}"
    );
}

#[test]
fn versioning_policy_is_published() {
    let guide = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("guide/api-versioning.md");
    assert!(guide.is_file(), "缺少版本策略文档 {}", guide.display());

    let spec = OpenDoc::openapi();
    let description = spec.info.description.unwrap_or_default();
    assert!(
        description.contains("/guide/api-versioning.md"),
        "契约 info 未指向版本策略文档"
    );
}

#[test]
fn all_registered_routes_exist_in_spec() {
    let spec = OpenDoc::openapi();

    for route in ALL_ROUTES {
        assert!(
            oas::has_route(route.method, route.path, &spec),
            "OAS spec missing route: {} {}",
            route.method,
            route.path
        );
    }
}

#[test]
fn spec_has_unique_operation_ids() {
    let spec = OpenDoc::openapi();
    let mut seen = std::collections::HashSet::new();

    for item in spec.paths.paths.values() {
        for op in [
            item.get.as_ref(),
            item.post.as_ref(),
            item.put.as_ref(),
            item.delete.as_ref(),
            item.patch.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(id) = &op.operation_id {
                assert!(seen.insert(id.clone()), "duplicate operationId: {id}");
            }
        }
    }
}

#[test]
fn spec_json_export_is_valid() {
    let json = oas::json_pretty();
    assert!(json.contains("\"openapi\""));
    assert!(json.contains("/api/v1/auth/signin"));
    assert!(json.contains("bearer_auth"));
    assert!(json.contains("/guide/error-codes.md"));
}

/// 导出必须字节稳定：manifest 里 `securitySchemes.*` 的 Apifox 扩展来自 utoipa 的
/// `Extensions`（内部是 `HashMap`），未规范化时键序随进程随机，会让 CI 的
/// `git diff --exit-code spec/openapi.json` 随机失败。
#[test]
fn spec_json_export_is_deterministic() {
    let first = oas::json_pretty();
    assert_eq!(first, oas::json_pretty(), "同一进程内两次导出结果不一致");

    let apifox = first
        .find("\"x-apifox-default\"")
        .expect("securityScheme 缺少 x-apifox-default");
    let default = first
        .find("\"x-default\"")
        .expect("securityScheme 缺少 x-default");
    assert!(apifox < default, "键序未规范化，导出结果会随运行随机变化");
}
