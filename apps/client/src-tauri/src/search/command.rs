//! Bing 搜索建议：Tauri 直连 HTTP，供主窗 Command Omnibar 使用。

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestBody {
    qry: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    q: String,
    #[serde(default)]
    u: String,
    #[serde(default)]
    t: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestResult {
    s: Vec<SuggestItem>,
}

#[derive(Debug, Deserialize)]
struct BingSuggestion {
    #[serde(default)]
    s: Vec<SuggestItem>,
}

/// 搜索建议。不走未注册的 corex `engine.suggestion`。
#[tauri::command(rename = "search:suggest")]
pub async fn search_suggest(body: SuggestBody) -> Result<SuggestResult, String> {
    let qry = body.qry.trim().to_string();
    if qry.is_empty() {
        return Ok(SuggestResult { s: Vec::new() });
    }
    let cursor = qry.chars().count().to_string();
    let cvid = Uuid::new_v4().simple().to_string();
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|err| err.to_string())?;
    let text = client
        .get("https://cn.bing.com/AS/Suggestions")
        .query(&[
            ("pt", "page.home"),
            ("qry", qry.as_str()),
            ("cp", cursor.as_str()),
            ("csr", "1"),
            ("pths", "1"),
            ("cvid", cvid.as_str()),
        ])
        .send()
        .await
        .map_err(|err| err.to_string())?
        .text()
        .await
        .map_err(|err| err.to_string())?;
    let parsed: BingSuggestion =
        serde_json::from_str(&text).unwrap_or(BingSuggestion { s: Vec::new() });
    let s = parsed
        .s
        .into_iter()
        .filter(|item| !item.q.trim().is_empty())
        .take(8)
        .collect();
    Ok(SuggestResult { s })
}
