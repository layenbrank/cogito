//! 路由可达性守卫：`ALL_ROUTES` 里登记的每一条都必须真的被 actix 命中。
//!
//! 只校验「spec 里有没有记录」是不够的：路由可以与代码、spec 三者一致，却因为 actix
//! `ResourceMap` 的匹配规则整片 404。这里分两层守：
//!
//! 1. `every_route_belongs_to_a_registered_scope`：对整张 `ALL_ROUTES` 发未登录请求，
//!    要求不是 404。它只覆盖**首段前缀**（`/tenants`、`/gateway`、`/sso`…）是否注册 ——
//!    受保护 scope 上的 `Auth` 守卫会在内层路由匹配**之前**就返回业务错误信封（测试环境
//!    无 Redis 时返回「缓存服务未配置」），因此「scope 内某条路由漏注册 / 被兄弟 scope
//!    吞掉」在这一层永远看不出 404，别把这一层的通过当成熟证据。
//! 2. `subscription_routes_are_registered_relative_to_tenant_scope`：对订阅 / 配额这类
//!    曾整片 404 的路由做**可判别**的模块契约测试：去掉鉴权中间件但保持生产的父子 scope
//!    结构，注册成了绝对路径或漏注册都会真 404。
//! 3. `gateway_audit_routes_are_registered_relative_to_tenant_scope`：同样的契约，针对
//!    租户面审计（路由也住在网关模块里、前缀归 `/tenants`）。

use actix_web::{App, http::Method, test, web};
use cogito::{
    bootstrap::{BootstrapModule, BootstrapOptions},
    middlewares::rate_limit::AuthGovernor,
    oas::paths::{self, ALL_ROUTES},
    services::{
        application::module::ApplicationModule, gateway::module::GatewayModule,
        subscription::module::SubscriptionModule,
    },
};

/// 订阅 / 配额路由挂载的父 scope（完整路径，与 `TenantModule` 中一致）
const TENANT_SCOPE: &str = "/api/v1/tenants";

/// 父 scope 相对 `/api/v1` 的注册路径
const TENANT_SCOPE_RELATIVE: &str = "/tenants";

/// 路径占位段（`{id}`、`{userID}`、`{hash}`…）的替换值：合法 UUID，保证请求能进入中间件与 handler
const PLACEHOLDER: &str = "00000000-0000-4000-8000-000000000001";

#[actix_web::test]
async fn every_route_belongs_to_a_registered_scope() {
    let app = test::init_service(
        App::new()
            .configure(|cfg| BootstrapModule::configure(cfg, &BootstrapOptions::development(false)))
            .configure(|cfg| ApplicationModule::configure(cfg, AuthGovernor(None))),
    )
    .await;

    for route in ALL_ROUTES {
        let request = test::TestRequest::default()
            .method(method_of(route.method))
            .uri(&resolve_path(route.path))
            .to_request();
        let response = test::call_service(&app, request).await;

        assert_ne!(
            response.status(),
            404,
            "{} {} 的首段 scope 未注册：已在 spec 中登记却不可达",
            route.method,
            route.path
        );
    }
}

/// 订阅模块契约：路由必须以**相对 `/api/v1/tenants` 的相对路径**注册。
///
/// 回归目标：`SubscriptionModule` 曾自建 `web::scope("/tenants/{id}/subscriptions")`，与
/// `TenantModule` 的 `/tenants` 前缀 scope 同层并列 —— `ResourceMap` 只会进入先命中的前缀
/// 节点，兄弟 scope 永不查找，订阅与配额三组路由整体 404（订阅闭环直接断掉）。
#[actix_web::test]
async fn subscription_routes_are_registered_relative_to_tenant_scope() {
    let owned = [
        paths::TENANT_SUBSCRIPTIONS,
        paths::TENANT_SUBSCRIPTION_BY_ID,
        paths::TENANT_QUOTA,
    ];

    for path in owned {
        assert!(
            path.starts_with(TENANT_SCOPE),
            "{path} 不再位于 {TENANT_SCOPE} 之下，本测试的挂载结构需要同步调整"
        );
    }

    // 与生产同构：父 scope 提供前缀，模块只注册相对路径（这里故意不挂 Auth，
    // 否则守卫会短路，内层路由是否命中就观察不到了）
    let app =
        test::init_service(App::new().service(
            web::scope("/api/v1").service(
                web::scope(TENANT_SCOPE_RELATIVE).configure(SubscriptionModule::configure),
            ),
        ))
        .await;

    let mut seen = std::collections::HashSet::new();
    for route in ALL_ROUTES.iter().filter(|r| owned.contains(&r.path)) {
        let request = test::TestRequest::default()
            .method(method_of(route.method))
            .uri(&resolve_path(route.path))
            .to_request();
        let response = test::call_service(&app, request).await;

        assert_ne!(
            response.status(),
            404,
            "{} {} 未被订阅模块命中：只能注册相对 {TENANT_SCOPE} 的 web::resource，\
             自建同层 web::scope 会被 actix 前缀节点吞掉",
            route.method,
            route.path
        );
        seen.insert(route.path);
    }

    for path in owned {
        assert!(
            seen.contains(path),
            "{path} 不在 ALL_ROUTES 中，逐条覆盖会漏"
        );
    }
}

/// 网关模块契约：租户面审计的两条路由同样必须以**相对 `/api/v1/tenants` 的相对路径**注册。
///
/// 回归目标与订阅那条相同——只是这次的注册点在 `GatewayModule::configure_tenant`：
/// 网关的其余路由挂在自己的 `/gateway` scope 下，很容易顺手写成绝对路径。
///
/// 这两条**还没有**登记进 `ALL_ROUTES`（OAS 与 spec 的同步在 P7c-oas-routes 一并做），
/// 所以这里按路径常量逐条发请求，而不是从 `ALL_ROUTES` 里筛。
#[actix_web::test]
async fn gateway_audit_routes_are_registered_relative_to_tenant_scope() {
    let owned = [paths::TENANT_AUDIT, paths::TENANT_AUDIT_EXPORT];

    for path in owned {
        assert!(
            path.starts_with(TENANT_SCOPE),
            "{path} 不再位于 {TENANT_SCOPE} 之下，本测试的挂载结构需要同步调整"
        );
    }

    let app =
        test::init_service(App::new().service(web::scope("/api/v1").service(
            web::scope(TENANT_SCOPE_RELATIVE).configure(GatewayModule::configure_tenant),
        )))
        .await;

    for path in owned {
        let response = test::call_service(
            &app,
            test::TestRequest::default()
                .method(Method::GET)
                .uri(&resolve_path(path))
                .to_request(),
        )
        .await;

        assert_ne!(
            response.status(),
            404,
            "GET {path} 未被网关模块命中：只能注册相对 {TENANT_SCOPE} 的 web::resource，\
             自建同层 web::scope 会被 actix 前缀节点吞掉"
        );
    }
}

fn method_of(method: &str) -> Method {
    Method::from_bytes(method.as_bytes()).expect("ALL_ROUTES 中存在非法 HTTP 方法")
}

fn resolve_path(path: &str) -> String {
    let mut resolved = String::with_capacity(path.len());
    let mut rest = path;
    while let Some(start) = rest.find('{') {
        let Some(end) = rest[start..].find('}') else {
            break;
        };
        resolved.push_str(&rest[..start]);
        resolved.push_str(PLACEHOLDER);
        rest = &rest[start + end + 1..];
    }
    resolved.push_str(rest);
    resolved
}
