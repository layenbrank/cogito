//! 全局出站 HTTP 代理：读 settings store → 设 HTTP_PROXY / HTTPS_PROXY / NO_PROXY。
//!
//! 参考 llm_wiki `proxy.rs`；store 路径对齐 cogito `settings.json`（tauri-plugin-store）。

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// 默认直连网段。`0.0.0.0` 是通配地址：放到代理里会被转成「代理自己的地址」并回 502，
/// 所以它和 `::` 必须一起进白名单（否则本地模型配成 0.0.0.0 时，报错永远看不懂）。
const DEFAULT_BYPASS_LIST: &str =
    "localhost,127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1,0.0.0.0,::,*.local";
static ACCEPT_INVALID_CERTS: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub url: String,
    #[serde(default = "default_true")]
    pub bypass_local: bool,
    #[serde(default)]
    pub accept_invalid_certs: bool,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            url: String::new(),
            bypass_local: true,
            accept_invalid_certs: false,
        }
    }
}

fn default_true() -> bool {
    true
}

/// settings.json 顶层可直接挂 `proxy`，也可嵌在 `general` 旁；优先读 `proxy`。
pub fn read_proxy_config_from_store(store_path: &Path) -> Option<ProxyConfig> {
    let content = std::fs::read_to_string(store_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let proxy = json.get("proxy")?;
    serde_json::from_value(proxy.clone()).ok()
}

pub fn find_settings_store_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("settings.json"))
}

pub fn bootstrap_from_store<R: Runtime>(app: &AppHandle<R>) {
    let Some(path) = find_settings_store_path(app) else {
        return;
    };
    let config = read_proxy_config_from_store(&path).unwrap_or_default();
    let summary = apply_proxy_env(&config);
    tracing::info!(%summary, path = %path.display(), "proxy bootstrap");
}

pub fn apply_proxy_env(config: &ProxyConfig) -> String {
    let url = config.url.trim();
    let parsed_url = reqwest::Url::parse(url).ok();
    let supported_url = parsed_url.as_ref().is_some_and(|parsed| {
        matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some()
    });

    let proxy_active = config.enabled && supported_url;
    ACCEPT_INVALID_CERTS.store(
        proxy_active && config.accept_invalid_certs,
        Ordering::Relaxed,
    );

    if !proxy_active {
        clear_proxy_env();
        return if !config.enabled {
            "disabled".to_string()
        } else if url.is_empty() {
            "disabled (empty url)".to_string()
        } else if !supported_url {
            format!(
                "disabled (invalid or unsupported proxy url: {})",
                redact_url(url)
            )
        } else {
            "disabled".to_string()
        };
    }

    // SAFETY: setup 阶段或用户显式切换；与 llm_wiki 相同权衡。
    unsafe {
        std::env::set_var("HTTP_PROXY", url);
        std::env::set_var("HTTPS_PROXY", url);
        if config.bypass_local {
            std::env::set_var("NO_PROXY", DEFAULT_BYPASS_LIST);
        } else {
            std::env::remove_var("NO_PROXY");
        }
    }
    format!(
        "enabled ({}, bypass_local={}, accept_invalid_certs={})",
        redact_url(url),
        config.bypass_local,
        config.accept_invalid_certs,
    )
}

pub fn configure_http_client(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder.danger_accept_invalid_certs(ACCEPT_INVALID_CERTS.load(Ordering::Relaxed))
}

fn redact_url(url: &str) -> String {
    let scheme_end = match url.find("://") {
        Some(i) => i + 3,
        None => return url.to_string(),
    };
    let after_scheme = &url[scheme_end..];
    let path_start = after_scheme.find('/').unwrap_or(after_scheme.len());
    let userinfo_end = match after_scheme[..path_start].find('@') {
        Some(i) => i,
        None => return url.to_string(),
    };
    let mut out = String::with_capacity(url.len());
    out.push_str(&url[..scheme_end]);
    out.push_str("***");
    out.push_str(&after_scheme[userinfo_end..]);
    out
}

fn clear_proxy_env() {
    unsafe {
        std::env::remove_var("HTTP_PROXY");
        std::env::remove_var("HTTPS_PROXY");
        std::env::remove_var("NO_PROXY");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn isolated<F: FnOnce()>(f: F) {
        let _guard = ENV_MUTEX.lock().unwrap_or_else(|p| p.into_inner());
        let snap = (
            std::env::var("HTTP_PROXY").ok(),
            std::env::var("HTTPS_PROXY").ok(),
            std::env::var("NO_PROXY").ok(),
        );
        clear_proxy_env();
        f();
        unsafe {
            match snap.0 {
                Some(v) => std::env::set_var("HTTP_PROXY", v),
                None => std::env::remove_var("HTTP_PROXY"),
            }
            match snap.1 {
                Some(v) => std::env::set_var("HTTPS_PROXY", v),
                None => std::env::remove_var("HTTPS_PROXY"),
            }
            match snap.2 {
                Some(v) => std::env::set_var("NO_PROXY", v),
                None => std::env::remove_var("NO_PROXY"),
            }
        }
    }

    #[test]
    fn disabled_sets_no_env() {
        isolated(|| {
            let s = apply_proxy_env(&ProxyConfig {
                enabled: false,
                url: "http://x:1".into(),
                bypass_local: true,
                accept_invalid_certs: false,
            });
            assert!(s.contains("disabled"));
            assert!(std::env::var("HTTP_PROXY").is_err());
        });
    }

    #[test]
    fn enabled_sets_both_proxy_envs() {
        isolated(|| {
            apply_proxy_env(&ProxyConfig {
                enabled: true,
                url: "http://127.0.0.1:7890".into(),
                bypass_local: true,
                accept_invalid_certs: false,
            });
            assert_eq!(
                std::env::var("HTTP_PROXY").unwrap(),
                "http://127.0.0.1:7890"
            );
            assert_eq!(
                std::env::var("HTTPS_PROXY").unwrap(),
                "http://127.0.0.1:7890"
            );
        });
    }
}
