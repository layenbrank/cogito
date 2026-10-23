# Reqwest URL 参数拼接方法

本文档介绍在 Rust 中使用 `reqwest` 拼接 URL 参数的几种方法。

## 方法 1: 使用 `query()` 方法（推荐）⭐

适用于实现了 `Serialize` trait 的结构体或 HashMap。

```rust
use reqwest::Client;
use serde::Serialize;

#[derive(Serialize)]
struct URLParams {
    pt: String,
    qry: String,
    cp: u64,
    csr: String,
    pths: String,
    cvid: String,
}

async fn example() -> Result<(), reqwest::Error> {
    let client = Client::new();
    let params = URLParams {
        pt: "page.home".to_string(),
        qry: "search".to_string(),
        cp: 10,
        csr: "1".to_string(),
        pths: "1".to_string(),
        cvid: "abc123".to_string(),
    };

    // 使用 query() 方法自动序列化
    let response = client
        .get("https://api.example.com/suggestion")
        .query(&params)  // 自动将结构体序列化为查询参数
        .send()
        .await?;

    Ok(())
}
```

**生成的 URL**: `https://api.example.com/suggestion?pt=page.home&qry=search&cp=10&csr=1&pths=1&cvid=abc123`

## 方法 2: 使用 HashMap

适用于动态参数或简单的键值对。

```rust
use reqwest::Client;
use std::collections::HashMap;

async fn example() -> Result<(), reqwest::Error> {
    let client = Client::new();
    let mut params = HashMap::new();
    params.insert("pt", "page.home");
    params.insert("qry", "search");
    params.insert("cp", "10");

    let response = client
        .get("https://api.example.com/suggestion")
        .query(&params)
        .send()
        .await?;

    Ok(())
}
```

## 方法 3: 使用元组向量

适用于少量固定参数。

```rust
use reqwest::Client;

async fn example() -> Result<(), reqwest::Error> {
    let client = Client::new();

    let response = client
        .get("https://api.example.com/suggestion")
        .query(&[
            ("pt", "page.home"),
            ("qry", "search"),
            ("cp", "10"),
            ("csr", "1"),
            ("pths", "1"),
            ("cvid", "abc123"),
        ])
        .send()
        .await?;

    Ok(())
}
```

## 方法 4: 手动构建查询字符串

适用于需要完全控制 URL 格式的场景。

```rust
use reqwest::Client;
use serde_urlencoded;

async fn example() -> Result<(), reqwest::Error> {
    let client = Client::new();
    let params = URLParams {
        pt: "page.home".to_string(),
        qry: "search".to_string(),
        cp: 10,
        csr: "1".to_string(),
        pths: "1".to_string(),
        cvid: "abc123".to_string(),
    };

    // 手动序列化为查询字符串
    let query_string = serde_urlencoded::to_string(&params)?;
    let url = format!("https://api.example.com/suggestion?{}", query_string);

    let response = client.get(&url).send().await?;

    Ok(())
}
```

## 方法 5: 链式调用多个 query()

可以多次调用 `query()` 来添加参数。

```rust
use reqwest::Client;

async fn example() -> Result<(), reqwest::Error> {
    let client = Client::new();

    let response = client
        .get("https://api.example.com/suggestion")
        .query(&[("pt", "page.home")])
        .query(&[("qry", "search")])
        .query(&[("cp", "10")])
        .send()
        .await?;

    Ok(())
}
```

## URL 编码

`reqwest` 的 `query()` 方法会自动处理 URL 编码，例如：

```rust
let params = vec![("q", "hello world")];
// 生成的 URL: https://api.example.com/search?q=hello%20world
```

## 注意事项

1. **类型转换**: 数字类型会自动转换为字符串
2. **空值处理**: `Option<T>` 类型的 `None` 值会被忽略
3. **特殊字符**: 会自动进行 URL 编码
4. **性能**: `query()` 方法在编译时进行序列化，性能较好

## 完整示例

参考项目中的 `src/services/engine/service.rs`:

```rust
use crate::services::engine::schema::{Suggestion, URLParams};
use reqwest::{Client, Error};

pub struct EngineService;

impl EngineService {
    pub async fn suggestion(params: URLParams) -> Result<Suggestion, Error> {
        let client = Client::new();
        let response = client
            .get("https://api.example.com/suggestion")
            .query(&params)  // URLParams 实现了 Serialize，可以直接使用
            .send()
            .await?;
        let suggestion: Suggestion = response.json().await?;
        Ok(suggestion)
    }
}
```
