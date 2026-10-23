//! 阿里云出站原语：短信（Dysmsapi）、邮件（DirectMail）、对象存储（OSS）与它们共用的
//! RPC 签名 / 传输层。数据所有权与边界见 `README.md`。
//!
//! 这里只有「协议 + 签名 + 传输」；模板、默认值、租户隔离、失败归类等业务策略在
//! `service/src/clients/aliyun.rs`（调用方注入凭据与端点，本 crate 不读配置）。

pub mod mail;
pub mod oss;
pub mod rpc;
pub mod sms;

/// 签名与编码算法；只对 crate 内部开放（签名细节不是对外契约）。
mod signature;

pub use mail::{MailClient, MailError, MailMessage, MailReceipt};
pub use oss::{OssClient, OssError, OssSettings};
pub use rpc::{Credentials, ParamPlacement, RpcClient, RpcError, RpcRequest, SignatureVersion};
pub use sms::{SmsClient, SmsError, SmsMessage, SmsReceipt};
