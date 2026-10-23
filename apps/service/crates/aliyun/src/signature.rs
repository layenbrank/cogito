//! 阿里云 RPC 风格 API 的签名算法：V3（`ACS3-HMAC-SHA256`，官方现行推荐）与
//! V1（`SignatureVersion=1.0`，HMAC-SHA1，老网关/专有云仍在用）。
//!
//! 纯计算：不碰网络、不读时钟、不生成随机数（那些在 [`crate::rpc`]）。
//! 规范来源与官方示例见本文件末尾的测试——改实现前先看那两组向量。
//!
//! 覆盖范围：只做官方文档给出的「基础类型参数」。列表/字典参数的 `k.1`、`k.sub`
//! 展开没有调用方（短信/邮件/OSS 都不用），故未实现。

use base64::Engine as _;
use hmac::{Hmac, KeyInit as _, Mac};
use sha1::Sha1;
use sha2::{Digest as _, Sha256};

/// RFC3986 百分号编码：仅 `A-Za-z0-9-_.~` 原样保留，其余按大写十六进制编码。
pub(crate) fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            _ => {
                const HEX: &[u8; 16] = b"0123456789ABCDEF";
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }
    out
}

/// 小写十六进制（不为此引入 hex 依赖）。
pub(crate) fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

/// `Key=Value&…`：键与值各自编码后，按**编码后的键**排序（官方实现就是 `sorted()`）。
pub(crate) fn canonical_query(pairs: &[(String, String)]) -> String {
    let mut encoded: Vec<(String, String)> = pairs
        .iter()
        .map(|(key, value)| (percent_encode(key), percent_encode(value)))
        .collect();
    encoded.sort();

    encoded
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// 表单 body：`urlencoded`（空格按表单惯例编成 `+`）。键排序只为输出可复现。
pub(crate) fn form_encode(pairs: &[(String, String)]) -> String {
    let mut encoded: Vec<(String, String)> = pairs
        .iter()
        .map(|(key, value)| {
            let value = percent_encode(value).replace("%20", "+");
            (percent_encode(key), value)
        })
        .collect();
    encoded.sort();

    encoded
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// V1 `StringToSign = Method + "&%2F&" + Encode(CanonicalizedQueryString)`
/// （末尾这一步是对规范串的**二次**编码，`%3A` 会变成 `%253A`）。
///
/// `pairs` 必须是「公共参数 + 业务参数」，且**不含** `Signature`。
pub(crate) fn v1_string_to_sign(method: &str, pairs: &[(String, String)]) -> String {
    format!("{method}&%2F&{}", percent_encode(&canonical_query(pairs)))
}

/// V1 `Signature = Base64(HMAC-SHA1(secret + "&", StringToSign))`。
pub(crate) fn v1_signature(
    access_key_secret: &str,
    method: &str,
    pairs: &[(String, String)],
) -> String {
    let key = format!("{access_key_secret}&");
    let mut mac = Hmac::<Sha1>::new_from_slice(key.as_bytes()).expect("HMAC 接受任意长度密钥");
    mac.update(v1_string_to_sign(method, pairs).as_bytes());

    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

/// V3 `CanonicalHeaders`：只保留 `host` / `content-type` / `x-acs-*`，按名排序。
///
/// 返回（每行以 `\n` 结尾的规范头串, 以 `;` 连接的 `SignedHeaders`）；两者都会进签名，
/// 所以 `host` 必须真的发出去（reqwest 会按 URL 自动带上同一个值）。
pub(crate) fn v3_canonical_headers(headers: &[(String, String)]) -> (String, String) {
    let mut selected: Vec<(String, String)> = headers
        .iter()
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .filter(|(name, _)| name == "host" || name == "content-type" || name.starts_with("x-acs-"))
        .collect();
    selected.sort();

    let canonical = selected
        .iter()
        .map(|(name, value)| format!("{name}:{value}\n"))
        .collect::<String>();
    let signed = selected
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(";");

    (canonical, signed)
}

/// 官方「用换行符连接六个部分」。第五个分隔符前是空行：`canonical_headers` 自带尾换行。
pub(crate) fn v3_canonical_request(
    method: &str,
    uri: &str,
    canonical_query: &str,
    canonical_headers: &str,
    signed_headers: &str,
    hashed_payload: &str,
) -> String {
    format!(
        "{method}\n{uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"
    )
}

/// V3 `StringToSign = "ACS3-HMAC-SHA256" + "\n" + Hex(SHA256(CanonicalRequest))`。
pub(crate) fn v3_string_to_sign(canonical_request: &str) -> String {
    format!(
        "ACS3-HMAC-SHA256\n{}",
        sha256_hex(canonical_request.as_bytes())
    )
}

/// V3 `Signature = Hex(HMAC-SHA256(StringToSign, AccessKeySecret))`。
///
/// 注意与 V1 的差别：V3 直接用裸密钥，**不**拼 `&`。
pub(crate) fn v3_signature(access_key_secret: &str, string_to_sign: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(access_key_secret.as_bytes())
        .expect("HMAC 接受任意长度密钥");
    mac.update(string_to_sign.as_bytes());

    hex_lower(&mac.finalize().into_bytes())
}

pub(crate) fn v3_authorization(
    access_key_id: &str,
    signed_headers: &str,
    signature: &str,
) -> String {
    format!(
        "ACS3-HMAC-SHA256 Credential={access_key_id},SignedHeaders={signed_headers},Signature={signature}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn percent_encoding_keeps_only_unreserved() {
        assert_eq!(percent_encode("aZ0-_.~"), "aZ0-_.~");
        assert_eq!(percent_encode(" "), "%20");
        assert_eq!(percent_encode("*"), "%2A");
        assert_eq!(percent_encode("/"), "%2F");
        assert_eq!(percent_encode("a b+c"), "a%20b%2Bc");
        assert_eq!(percent_encode("中文"), "%E4%B8%AD%E6%96%87");
    }

    #[test]
    fn form_encoding_uses_plus_for_space() {
        assert_eq!(
            form_encode(&pairs(&[("Subject", "验证码 123456"), ("b", "x")])),
            "Subject=%E9%AA%8C%E8%AF%81%E7%A0%81+123456&b=x"
        );
    }

    /// 官方《RPC 调用机制》示例：ECS `DescribeDedicatedHosts`（V1）。
    ///
    /// 逐项复刻文档 Step 1–4（含 StringToSign 与期望签名），任何一步都能定位到 bug。
    #[test]
    fn v1_matches_official_example() {
        let params = pairs(&[
            ("AccessKeyId", "testid"),
            ("Action", "DescribeDedicatedHosts"),
            ("Format", "JSON"),
            ("RegionId", "cn-beijing"),
            ("SignatureMethod", "HMAC-SHA1"),
            ("SignatureNonce", "edb2b34af0af9a6d14deaf7c1a5315eb"),
            ("SignatureVersion", "1.0"),
            ("Timestamp", "2023-03-13T08:34:30Z"),
            ("Version", "2014-05-26"),
        ]);

        assert_eq!(
            canonical_query(&params),
            "AccessKeyId=testid&Action=DescribeDedicatedHosts&Format=JSON&RegionId=cn-beijing&SignatureMethod=HMAC-SHA1&SignatureNonce=edb2b34af0af9a6d14deaf7c1a5315eb&SignatureVersion=1.0&Timestamp=2023-03-13T08%3A34%3A30Z&Version=2014-05-26"
        );
        assert_eq!(
            v1_string_to_sign("GET", &params),
            "GET&%2F&AccessKeyId%3Dtestid%26Action%3DDescribeDedicatedHosts%26Format%3DJSON%26RegionId%3Dcn-beijing%26SignatureMethod%3DHMAC-SHA1%26SignatureNonce%3Dedb2b34af0af9a6d14deaf7c1a5315eb%26SignatureVersion%3D1.0%26Timestamp%3D2023-03-13T08%253A34%253A30Z%26Version%3D2014-05-26"
        );
        assert_eq!(
            v1_signature("testsecret", "GET", &params),
            "9NaGiOspFP5UPcwX8Iwt2YJXXuk="
        );
    }

    /// 官方《签名机制 V3》示例：ECS `RunInstances`（RPC 风格，业务参数在 query）。
    #[test]
    fn v3_matches_official_example() {
        let query = pairs(&[
            (
                "ImageId",
                "win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd",
            ),
            ("RegionId", "cn-shanghai"),
        ]);
        let body = b"";
        let hashed_payload = sha256_hex(body);
        assert_eq!(
            hashed_payload,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        let headers = pairs(&[
            ("host", "ecs.cn-shanghai.aliyuncs.com"),
            ("x-acs-action", "RunInstances"),
            ("x-acs-content-sha256", hashed_payload.as_str()),
            ("x-acs-date", "2023-10-26T10:22:32Z"),
            ("x-acs-signature-nonce", "3156853299f313e23d1673dc12e1703d"),
            ("x-acs-version", "2014-05-26"),
        ]);
        let (canonical_headers, signed_headers) = v3_canonical_headers(&headers);
        assert_eq!(
            signed_headers,
            "host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version"
        );

        let canonical_request = v3_canonical_request(
            "POST",
            "/",
            &canonical_query(&query),
            &canonical_headers,
            &signed_headers,
            &hashed_payload,
        );
        assert_eq!(
            canonical_request,
            "POST\n/\nImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai\nhost:ecs.cn-shanghai.aliyuncs.com\nx-acs-action:RunInstances\nx-acs-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nx-acs-date:2023-10-26T10:22:32Z\nx-acs-signature-nonce:3156853299f313e23d1673dc12e1703d\nx-acs-version:2014-05-26\n\nhost;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        let string_to_sign = v3_string_to_sign(&canonical_request);
        assert!(
            string_to_sign
                .ends_with("7ea06492da5221eba5297e897ce16e55f964061054b7695beedaac1145b1e259")
        );

        let signature = v3_signature("YourAccessKeySecret", &string_to_sign);
        assert_eq!(
            signature,
            "06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0"
        );
        assert_eq!(
            v3_authorization("YourAccessKeyId", &signed_headers, &signature),
            "ACS3-HMAC-SHA256 Credential=YourAccessKeyId,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0"
        );
    }

    /// 非 `x-acs-*` / 非 `host` 的自定义头不进签名（否则会随代理变来变去）。
    #[test]
    fn v3_canonical_headers_filters_and_sorts() {
        let (canonical, signed) = v3_canonical_headers(&pairs(&[
            ("X-Acs-Date", " 2023-10-26T10:22:32Z "),
            ("user-agent", "curl"),
            ("Content-Type", "application/x-www-form-urlencoded"),
            ("host", "example.com"),
        ]));

        assert_eq!(
            canonical,
            "content-type:application/x-www-form-urlencoded\nhost:example.com\nx-acs-date:2023-10-26T10:22:32Z\n"
        );
        assert_eq!(signed, "content-type;host;x-acs-date");
    }
}
