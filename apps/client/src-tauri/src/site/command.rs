//! 解析站点 favicon：HTML link → /favicon.ico → DuckDuckGo 图标服务。

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use std::time::Duration;
use url::Url;

const TIMEOUT: Duration = Duration::from_secs(8);
const BODY_LIMIT: usize = 256 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

static LINK_ICON_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<link\b[^>]*\brel\s*=\s*["']([^"']*)["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']([^"']*)["'][^>]*>"#,
    )
    .expect("link icon regex")
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchFaviconBody {
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchFaviconResult {
    favicon: String,
}

fn find_icon_fallback(host: &str) -> String {
    // 通用兜底（无域名特例）；预设种子的 mark 在 navigation_seed 里显式配置
    format!("https://www.google.com/s2/favicons?domain={host}&sz=256")
}

fn parse_page_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("url 为空".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&with_scheme).map_err(|err| format!("无效 URL: {err}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("仅支持 http(s)".into());
    }
    if parsed.host_str().is_none() {
        return Err("缺少主机名".into());
    }
    Ok(parsed)
}

fn score_rel(rel: &str) -> i32 {
    let lower = rel.to_ascii_lowercase();
    if lower.contains("apple-touch-icon") {
        return 30;
    }
    if lower.split_whitespace().any(|part| part == "icon") {
        return 20;
    }
    if lower.contains("shortcut") && lower.contains("icon") {
        return 15;
    }
    0
}

fn find_icons_in_html(html: &str, base: &Url) -> Vec<(i32, String)> {
    let mut found = Vec::new();
    for caps in LINK_ICON_RE.captures_iter(html) {
        let (rel, href) = if let (Some(rel), Some(href)) = (caps.get(1), caps.get(2)) {
            (rel.as_str(), href.as_str())
        } else if let (Some(href), Some(rel)) = (caps.get(3), caps.get(4)) {
            (rel.as_str(), href.as_str())
        } else {
            continue;
        };
        let score = score_rel(rel);
        if score <= 0 {
            continue;
        }
        match base.join(href) {
            Ok(absolute) => {
                if absolute.scheme() == "http" || absolute.scheme() == "https" {
                    found.push((score, absolute.to_string()));
                }
            }
            Err(err) => {
                tracing::debug!("favicon href 无法绝对化 {href}: {err}");
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found
}

async fn probe_url(client: &reqwest::Client, candidate: &str) -> bool {
    match client.get(candidate).timeout(TIMEOUT).send().await {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                return false;
            }
            if let Some(ctype) = response.headers().get(reqwest::header::CONTENT_TYPE) {
                if let Ok(text) = ctype.to_str() {
                    let lower = text.to_ascii_lowercase();
                    if lower.contains("text/html") {
                        return false;
                    }
                }
            }
            true
        }
        Err(err) => {
            tracing::debug!("probe favicon failed {candidate}: {err}");
            false
        }
    }
}

/// 解析站点 favicon URL。
#[tauri::command(rename = "site:fetch-favicon")]
pub async fn site_fetch_favicon(body: FetchFaviconBody) -> Result<FetchFaviconResult, String> {
    let page = parse_page_url(&body.url)?;
    let host = page
        .host_str()
        .ok_or_else(|| "缺少主机名".to_string())?
        .to_string();
    let fallback = find_icon_fallback(&host);

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|err| {
            tracing::error!("构建 HTTP 客户端失败: {err}");
            err.to_string()
        })?;

    let html = match client.get(page.clone()).send().await {
        Ok(response) => {
            if response.status().is_success() {
                match response.bytes().await {
                    Ok(bytes) => {
                        let slice = if bytes.len() > BODY_LIMIT {
                            &bytes[..BODY_LIMIT]
                        } else {
                            &bytes
                        };
                        String::from_utf8_lossy(slice).into_owned()
                    }
                    Err(err) => {
                        tracing::warn!("读取页面失败 {}: {err}", page);
                        String::new()
                    }
                }
            } else {
                tracing::debug!("页面状态异常 {}: {}", page, response.status());
                String::new()
            }
        }
        Err(err) => {
            tracing::warn!("请求页面失败 {}: {err}", page);
            String::new()
        }
    };

    for (_score, candidate) in find_icons_in_html(&html, &page) {
        if probe_url(&client, &candidate).await {
            return Ok(FetchFaviconResult { favicon: candidate });
        }
    }

    if let Ok(favicon_ico) = page.join("/favicon.ico") {
        let candidate = favicon_ico.to_string();
        if probe_url(&client, &candidate).await {
            return Ok(FetchFaviconResult { favicon: candidate });
        }
    }

    Ok(FetchFaviconResult { favicon: fallback })
}
