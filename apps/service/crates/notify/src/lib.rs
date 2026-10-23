//! 出站通知能力内核（数据所有权见 README.md）。
//!
//! 状态：**只有边界声明，尚无实现**（实现随 P6 从 `service/src/services/*` 的邮件 / 短信 /
//! webhook 发送逻辑迁入）。
//!
//! 迁入之前：不要在 `service/src/services/**` 里新增通知发送逻辑，
//! 也不要在这里堆放未接线的脚手架——`pnpm arch` 会检查两侧。
