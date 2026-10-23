use std::sync::OnceLock;

static IS_PRODUCTION: OnceLock<bool> = OnceLock::new();

/// 在 [`Configure::load`] 成功后调用，供无 `Configure` 上下文的模块读取运行环境。
pub fn init(is_production: bool) {
    let _ = IS_PRODUCTION.set(is_production);
}

pub fn is_production() -> bool {
    match IS_PRODUCTION.get() {
        Some(v) => *v,
        None => !cfg!(debug_assertions),
    }
}
