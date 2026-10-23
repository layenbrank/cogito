use actix_web::web;

use super::static_assets::{StaticAssetsConfig, configure as configure_static};

/// 启动层选项（静态资源、文档、Swagger 等基础设施）
#[derive(Debug, Clone)]
pub struct BootstrapOptions {
    pub static_assets: StaticAssetsConfig,
    pub enable_swagger: bool,
}

impl BootstrapOptions {
    pub fn development(enable_swagger: bool) -> Self {
        let base = StaticAssetsConfig::development();
        let static_assets = if enable_swagger {
            base
        } else {
            StaticAssetsConfig {
                mounts: vec![],
                index: base.index,
            }
        };

        Self {
            static_assets,
            enable_swagger,
        }
    }
}

pub struct BootstrapModule;

impl BootstrapModule {
    /// 注册系统路由、框架层拒绝处理与静态资源（health、guide、index 等）
    pub fn configure(cfg: &mut web::ServiceConfig, options: &BootstrapOptions) {
        super::errors::configure(cfg);
        super::system::configure(cfg);
        configure_static(cfg, options.static_assets.clone());
    }
}
