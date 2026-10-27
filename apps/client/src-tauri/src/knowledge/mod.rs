//! 知识库域里「只有 app 层做得了」的零碎活儿。
//!
//! 正文、索引、计数的语义都在 `cogito_core::knowledge`；这里只放需要 `AppHandle` 的部分
//! （应用数据目录之类），目前就是旧版备份目录的清理。

pub mod legacy;
