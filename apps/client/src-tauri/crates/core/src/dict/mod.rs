//! 状态字典：value 稳定编码，label 可改文案。
mod codes;
mod service;

pub use codes::*;
pub use service::{DictItemView, DictTypeView, Service, UpdateItemInput};
