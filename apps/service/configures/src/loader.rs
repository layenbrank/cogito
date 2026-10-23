use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use config::{Config, File, FileFormat};

/// 解析 profile：shell `APP_ENV` / `RUST_ENV` 可覆盖，否则读 `config.yaml` 的 `app.env`。
pub fn resolve_profile() -> String {
    if let Ok(v) = std::env::var("APP_ENV").or_else(|_| std::env::var("RUST_ENV")) {
        return v.to_ascii_lowercase();
    }
    peek_app_env_from_base().unwrap_or_else(|| "development".to_string())
}

/// 配置文件目录：可执行文件旁；debug 下回退 crate 根或 workspace 根。
pub fn config_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let exe_config = exe_dir.join("config.yaml");
    if exe_config.exists() {
        return exe_dir;
    }

    if cfg!(debug_assertions) {
        if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
            let root = PathBuf::from(manifest);
            if root.join("config.yaml").exists() {
                return root;
            }
            if let Some(parent) = root.parent() {
                if parent.join("config.yaml").exists() {
                    return parent.to_path_buf();
                }
            }
        }
    }

    exe_dir
}

fn peek_app_env_from_base() -> Option<String> {
    let dir = config_dir();
    let base = dir.join("config.yaml");
    if !base.exists() {
        return None;
    }
    Config::builder()
        .add_source(File::from(base.as_path()).format(FileFormat::Yaml))
        .build()
        .ok()?
        .get_string("app.env")
        .ok()
        .map(|s| s.to_ascii_lowercase())
}

fn yaml_file(dir: &Path, name: &str) -> PathBuf {
    dir.join(name)
}

/// 环境变量覆盖源（优先级最高）：前缀 `COGITO__`，层级用 `__` 分隔，例：
/// `COGITO__DATABASE__URL` → `database.url`、`COGITO__SERVER__PORT` → `server.port`。
///
/// 容器/编排里用它注入密钥与跨服务地址（配置文件里不落明文），本机不设这些变量时行为不变。
fn env_overrides() -> config::Environment {
    config::Environment::with_prefix("COGITO")
        .prefix_separator("__")
        .separator("__")
        .try_parsing(true)
        // 空串视为「未设置」：编排模板里 `${VAR}` 展开成空串时，不该静默把配置清空
        // （`COGITO__SECURITY__JWT_SECRET=` 这类空覆盖会把密钥抹成空串，见 `Configure::validate`）。
        .ignore_empty(true)
}

/// 合并 `config.yaml` → `config.{profile}.yaml` → `config.local.yaml` → `COGITO__*` 环境变量。
pub fn load_merged_config(profile: &str) -> Result<Config> {
    let dir = config_dir();
    let base = yaml_file(&dir, "config.yaml");
    if !base.exists() {
        anyhow::bail!(
            "missing config file: {} (config_dir={})",
            base.display(),
            dir.display()
        );
    }

    let profile_name = format!("config.{}.yaml", profile);
    let profile_file = yaml_file(&dir, &profile_name);
    let local_file = yaml_file(&dir, "config.local.yaml");

    let mut builder =
        Config::builder().add_source(File::from(base.as_path()).format(FileFormat::Yaml));

    if profile_file.exists() {
        builder = builder.add_source(File::from(profile_file.as_path()).format(FileFormat::Yaml));
    }

    if local_file.exists() {
        builder = builder.add_source(File::from(local_file.as_path()).format(FileFormat::Yaml));
    }

    builder = builder.add_source(env_overrides());

    builder
        .build()
        .with_context(|| format!("failed to build config from dir {}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_dir_points_at_repo_config_in_tests() {
        let dir = config_dir();
        assert!(dir.join("config.yaml").exists());
    }

    #[test]
    fn environment_variables_override_config_files() {
        // SAFETY: 本测试独占 `COGITO__SERVER__PORT`，设置后立即还原
        unsafe { std::env::set_var("COGITO__SERVER__PORT", "3456") };
        let merged = load_merged_config(&resolve_profile()).expect("配置应能合并");
        unsafe { std::env::remove_var("COGITO__SERVER__PORT") };

        assert_eq!(merged.get_int("server.port").expect("server.port"), 3456);
    }

    #[test]
    fn empty_environment_variables_are_treated_as_unset() {
        let expected = load_merged_config(&resolve_profile())
            .expect("配置应能合并")
            .get_string("logging.filter")
            .expect("logging.filter");

        // SAFETY: 本测试独占 `COGITO__LOGGING__FILTER`，设置后立即还原
        unsafe { std::env::set_var("COGITO__LOGGING__FILTER", "") };
        let merged = load_merged_config(&resolve_profile()).expect("配置应能合并");
        unsafe { std::env::remove_var("COGITO__LOGGING__FILTER") };

        assert_eq!(
            merged.get_string("logging.filter").expect("logging.filter"),
            expected
        );
    }
}
