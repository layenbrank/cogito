#![allow(non_snake_case)]

pub mod bootstrap {
    pub mod admin;
    pub mod errors;
    pub mod module;
    pub mod static_assets;
    pub mod system;

    #[cfg(feature = "openapi")]
    pub mod swagger;

    pub use admin::ensure_bootstrap_admin;
    pub use module::{BootstrapModule, BootstrapOptions};
    pub use static_assets::{IndexFileConfig, StaticAssetsConfig, StaticMount};
}

/// 构建基础 Actix App（须在 `HttpServer::new` 闭包内展开，以保证类型推断）
#[macro_export]
macro_rules! bootstrap_app {
    ($store:expr, $config:expr, $redis:expr, $durable:expr, $compute:expr, $bootstrap:expr, $auth_governor:expr) => {{
        use actix_web::{App, web::Data};
        use $crate::middlewares::access_log::AccessLog;
        use $crate::middlewares::cors::cors;
        use $crate::middlewares::reject::RejectNormalizer;
        use $crate::middlewares::trace::Trace;

        App::new()
            .app_data(Data::new($store))
            .app_data(Data::new($config))
            .app_data(Data::new($redis))
            // `None` = 编排运行时没接通：进程照常起，用到它的接口才回 503
            .app_data(Data::new($durable))
            // `None` = compute 计算车间没接通：MCP 的工具调用才回「暂不可用」
            .app_data(Data::new($compute))
            // 归一中间件最内层：最先接住框架自产响应（如 405 空体），其余 wrap 都在信封之外
            .wrap(RejectNormalizer)
            .wrap(cors($config.as_ref()))
            .wrap(AccessLog)
            // 链路中间件在最外层：限流、CORS 预检等未进入 Handler 的响应同样带 traceID
            .wrap(Trace)
            .configure(|cfg| $crate::bootstrap::BootstrapModule::configure(cfg, &$bootstrap))
            .configure(|cfg| {
                $crate::services::application::module::ApplicationModule::configure(
                    cfg,
                    $auth_governor.clone(),
                )
            })
    }};
}

pub mod clients {
    pub mod compute;
    pub mod durable;
    pub mod aliyun;
    pub mod gocaptcha;
    pub mod redis;
}

pub mod databases {
    pub mod database;
    pub mod scope;
}

/// 后台进程（事件发布 worker）：不监听端口，只连数据库与下游端点。
pub mod worker {
    pub mod dispatcher;
    pub mod runner;
    pub mod scheduler;
}

/// 长任务（可靠执行）：编排与活动的装配点，只有 orchestrator 二进制会运行它。
pub mod orchestrations;

pub extern crate configures;

pub mod middlewares {
    //! HTTP 层 wrap（Nest Middleware 角色）：CORS、链路追踪、访问日志、限流、框架响应归一。
    pub mod access_log;
    pub mod cors;
    pub mod rate_limit;
    pub mod reject;
    pub mod trace;
}

/// 鉴权守卫（Nest Guard 角色）：能否进入受保护 Handler。
pub mod guards {
    pub mod account;
    pub mod asset;
    pub mod auth;
    pub mod blacklist;
    pub mod payment;
    pub mod platform;
    pub mod public;
    pub mod service;
    pub mod session;
    pub mod sso;
    pub mod tenant;
}

/// 异常响应信封（Nest Filter 角色）
pub mod filters {
    pub mod exception;
    pub use exception::Exception;
}

/// 成功响应信封（Nest Interceptor 角色）
pub mod interceptors {
    pub mod envelope;
    pub use envelope::{Envelope, Paginated};
}

pub mod utils {
    pub mod client_ip;
    pub mod code;
    pub mod db;
    pub mod encryption;
    pub mod generate;
    pub mod jwt;
    pub mod logger;
    pub mod telemetry;
    pub mod timestamp;
    pub mod token;
}

pub mod services {
    pub mod application {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    pub mod markdown {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    /// agent 任务：编排入口与台账查询。
    ///
    /// 四文件约定之外多两个文件——`error.rs` 是领域错误，`dispatch.rs` 是编排状态回收。
    /// 本域按能力 crate 的方向组织（能力在 `crates/agent`，这里只有 HTTP 与接线），
    /// 所以不套用那套以「单文件分层」为前提的约定。
    pub mod agent {
        pub mod controller;
        pub mod dispatch;
        pub mod error;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    pub mod engine {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    /// rag 索引任务：起任务、查进度与结果。
    ///
    /// 与 `agent` 同形：`error.rs` 是领域错误，`dispatch.rs` 是编排状态回收，
    /// 台账归 `crates/rag`，编排在 `orchestrations/rag.rs`。
    pub mod rag {
        pub mod controller;
        pub mod dispatch;
        pub mod error;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    /// 服务端定时任务（`owner=cloud`）：CRUD 在 API，执行在 worker。
    pub mod schedule {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    /// 会话同步：推一批改动、拉增量窗口。
    ///
    /// 没有 `dispatch.rs`：本域不跑编排，水位与冲突规则全在 `crates/chat`，
    /// 这里只有校验、形状映射与路由。
    pub mod chat {
        pub mod controller;
        pub mod error;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    /// MCP（Model Context Protocol）：`/api/v1/mcp` 上的 JSON-RPC 端点。
    ///
    /// 工具目录写死在 `schema.rs`，读工具转发给 compute 的直通通道，写工具进目录但
    /// 调用即拒绝（审批通道在服务端 agent）。响应不走统一 REST 信封，所以多一个
    /// `error.rs` 放 JSON-RPC 错误对象。
    pub mod mcp {
        pub mod controller;
        pub mod error;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    pub mod user {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    /// Backend Console 偏好：侧栏序 / 钉选 / 看板小部件 / 书签。
    pub mod console {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    /// 客户端异常上报与平台运维查询（对标 Node Exception）。
    pub mod exception {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    pub mod auth {
        pub mod captcha;
        pub mod controller;
        pub mod module;
        pub mod otp;
        pub mod schema;
        pub mod service;
    }

    pub mod upload {
        pub mod controller;
        pub mod error;
        pub mod module;
        pub mod multipart;
        pub mod repository;
        pub mod schema;
        pub mod service;
        pub mod storage;
        pub mod validation;
    }

    pub mod tenant {
        pub mod admin_controller;
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    pub mod gateway {
        pub mod client;
        pub mod controller;
        pub mod module;
        pub mod quota;
        pub mod render;
        pub mod repository;
        pub mod schema;
        pub mod service;
        pub mod service_token;
    }

    pub mod sso {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    pub mod subscription {
        pub mod controller;
        pub mod module;
        pub mod schema;
        pub mod service;
    }

    pub mod payment {
        pub mod billing_controller;
        pub mod billing_price;
        pub mod channel;
        pub mod controller;
        pub mod module;
        pub mod reconcile;
        pub mod render;
        pub mod schema;
        pub mod service;
    }
}

pub mod oas;
