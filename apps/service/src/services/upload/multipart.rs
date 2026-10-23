//! multipart 分片表单解析

use actix_multipart::Multipart;
use futures::StreamExt;

use crate::filters::exception::Exception;

pub struct ChunkForm {
    pub id: String,
    pub index: u32,
    pub hash: String,
    /// CAS 命中时可省略或为空（分片秒传）
    pub data: Option<Vec<u8>>,
}

pub async fn parse_chunk_form(mut payload: Multipart) -> Result<ChunkForm, Exception> {
    let mut id = String::new();
    let mut index: Option<u32> = None;
    let mut hash = String::new();
    let mut data: Option<Vec<u8>> = None;
    let mut saw_chunk_field = false;

    while let Some(fields) = payload.next().await {
        let mut field = match fields {
            Ok(field) => field,
            Err(err) => {
                return Err(Exception::bad_request(format!(
                    "读取 multipart 字段失败: {err}"
                )));
            }
        };

        let field_name = match field.name() {
            Some(name) => name.to_string(),
            None => return Err(Exception::bad_request("缺少字段名")),
        };

        match field_name.as_str() {
            "id" => match extract_field(&mut field).await {
                Ok(value) => id = value,
                Err(err_msg) => {
                    return Err(Exception::bad_request(format!(
                        "读取 id 字段失败: {err_msg}"
                    )));
                }
            },
            "index" => match extract_field(&mut field).await {
                Ok(index_str) => match index_str.parse::<u32>() {
                    Ok(idx) => index = Some(idx),
                    Err(_) => return Err(Exception::bad_request("分片索引格式无效")),
                },
                Err(err_msg) => {
                    return Err(Exception::bad_request(format!(
                        "读取 index 字段失败: {err_msg}"
                    )));
                }
            },
            "chunk" => {
                saw_chunk_field = true;
                match extract_binary_field(&mut field).await {
                    Ok(bytes) => data = Some(bytes),
                    Err(err_msg) => {
                        return Err(Exception::bad_request(format!(
                            "读取 chunk 字段失败: {err_msg}"
                        )));
                    }
                }
            }
            "hash" => match extract_field(&mut field).await {
                Ok(value) => hash = value,
                Err(err_msg) => {
                    return Err(Exception::bad_request(format!(
                        "读取 hash 字段失败: {err_msg}"
                    )));
                }
            },
            _ => {
                if let Err(err_msg) = skip_field(&mut field).await {
                    return Err(Exception::bad_request(format!(
                        "跳过未知字段失败: {err_msg}"
                    )));
                }
            }
        }
    }

    if id.is_empty() {
        return Err(Exception::bad_request("缺少 id 参数"));
    }
    let Some(index) = index else {
        return Err(Exception::bad_request("缺少 index 参数"));
    };
    if hash.is_empty() {
        return Err(Exception::bad_request("缺少 hash 参数"));
    }

    let data = match data {
        Some(bytes) if bytes.is_empty() && saw_chunk_field => Some(Vec::new()),
        other => other,
    };

    Ok(ChunkForm {
        id,
        index,
        hash,
        data,
    })
}

async fn extract_field(field: &mut actix_multipart::Field) -> Result<String, String> {
    let mut data = Vec::new();
    while let Some(bytes_result) = field.next().await {
        let bytes = match bytes_result {
            Ok(bytes) => bytes,
            Err(err) => return Err(format!("读取文本字段失败: {err}")),
        };
        data.extend_from_slice(&bytes);
    }
    String::from_utf8(data).map_err(|_| "文本字段 UTF-8 编码无效".to_string())
}

async fn extract_binary_field(field: &mut actix_multipart::Field) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    while let Some(bytes_result) = field.next().await {
        let bytes = match bytes_result {
            Ok(bytes) => bytes,
            Err(err) => return Err(format!("读取二进制字段失败: {err}")),
        };
        data.extend_from_slice(&bytes);
    }
    Ok(data)
}

async fn skip_field(field: &mut actix_multipart::Field) -> Result<(), String> {
    while let Some(bytes_result) = field.next().await {
        if let Err(err) = bytes_result {
            return Err(format!("跳过字段失败: {err}"));
        }
    }
    Ok(())
}
