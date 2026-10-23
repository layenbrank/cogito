use actix_files::Files;
use actix_web::{HttpResponse, web};

/// 单个静态资源挂载点（类似 NestJS `ServeStaticModule` 的一项配置）
#[derive(Debug, Clone)]
pub struct StaticMount {
    /// URL 前缀，如 `/guide`
    pub prefix: &'static str,
    /// 文件系统根目录（相对工作目录）
    pub root: &'static str,
}

/// 静态资源配置
#[derive(Debug, Clone)]
pub struct StaticAssetsConfig {
    /// 按前缀挂载的目录
    pub mounts: Vec<StaticMount>,
    /// 站点根路径默认页（挂载在 `/` 与 `/index.html`）
    pub index: Option<IndexFileConfig>,
}

/// 根路径 index 文件
#[derive(Debug, Clone)]
pub struct IndexFileConfig {
    pub root: &'static str,
    pub file: &'static str,
    pub fallback_html: &'static str,
}

impl StaticAssetsConfig {
    pub fn development() -> Self {
        Self {
            mounts: vec![StaticMount {
                prefix: "/guide",
                root: "guide",
            }],
            index: Some(IndexFileConfig {
                root: ".",
                file: "index.html",
                fallback_html: "<h1>Welcome to the Rust Web Service!</h1>",
            }),
        }
    }

    pub fn mount(mut self, prefix: &'static str, root: &'static str) -> Self {
        self.mounts.push(StaticMount { prefix, root });
        self
    }

    pub fn without_index(mut self) -> Self {
        self.index = None;
        self
    }
}

pub fn configure(cfg: &mut web::ServiceConfig, config: StaticAssetsConfig) {
    if config.index.is_some() {
        cfg.app_data(web::Data::new(config.clone()));
        cfg.route("/", web::get().to(serve_index));
        cfg.route("/index.html", web::get().to(serve_index));
    }

    for mount in &config.mounts {
        cfg.service(Files::new(mount.prefix, mount.root).prefer_utf8(true));
    }
}

async fn serve_index(config: web::Data<StaticAssetsConfig>) -> HttpResponse {
    let Some(index) = &config.index else {
        return HttpResponse::NotFound().finish();
    };

    let path = std::path::Path::new(index.root).join(index.file);
    let body = std::fs::read_to_string(&path).unwrap_or_else(|_| index.fallback_html.to_string());

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(body)
}
