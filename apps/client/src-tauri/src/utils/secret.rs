//! OS Keyring 密钥读写（JWT / provider apiKey）。
//!
//! 不用 Stronghold（官方弃用）。goose 侧车仍通过 `cogito_token` 的 jwt 文件桥接。

use keyring::Entry;

fn entry(service: &str, account: &str) -> Result<Entry, String> {
    Entry::new(service, account).map_err(|e| format!("创建 keyring entry 失败: {e}"))
}

pub fn get_secret(service: &str, account: &str) -> Result<Option<String>, String> {
    let item = entry(service, account)?;
    match item.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("读取密钥失败: {e}")),
    }
}

pub fn set_secret(service: &str, account: &str, secret: &str) -> Result<(), String> {
    let item = entry(service, account)?;
    item.set_password(secret)
        .map_err(|e| format!("写入密钥失败: {e}"))
}

pub fn delete_secret(service: &str, account: &str) -> Result<(), String> {
    let item = entry(service, account)?;
    match item.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("删除密钥失败: {e}")),
    }
}
