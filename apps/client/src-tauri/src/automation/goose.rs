//! `owner=goose` 的适配层：把任务的 prompt 落成最小 recipe，交给 goose 自己的调度器。
//!
//! 三个已知边界，都来自实测：
//! 1. goose 只接受 **recipe 源**（文件路径或 base64），没有「一句话」入口 —— 所以我们生成
//!    最小 recipe（`instructions` 就是 prompt）；
//! 2. `schedule add` 会把 recipe **复制**进它自己的 `scheduled_recipes/`，删任务不会连带删；
//! 3. goose 没有 update，改名/改 cron 只能先 remove 再 add。
//!
//! 因此本地这份任务只是**镜像**：`nextRunAt` 为空（排期在 goose 手里），`remoteId` 记
//! schedule-id（就是我们自己的任务 id，便于对照），同步失败的原因写进 `lastError`。

use std::fs;
use std::path::PathBuf;

use cogito_database::entity::automation as schema;
use tauri::{AppHandle, Manager};

use crate::utils::goose_serve;

/// recipe 落在应用自己的数据目录下：`<appData>/goose/automation-recipes/<id>.yaml`
const RECIPE_DIR: &str = "automation-recipes";

pub struct GooseSchedule;

impl GooseSchedule {
    /// 建/改：先删再建（goose 没有 update 子命令）
    pub async fn upsert(app: &AppHandle, task: &schema::Model) -> Result<(), String> {
        let recipe = Self::write_recipe(app, task)?;
        // 已存在时 add 会失败，所以先无条件删一次；删不到不算错
        let _ = goose_serve::run_goose(
            app,
            &["schedule", "remove", "--schedule-id", &task.id],
        )
        .await;
        let recipe_text = recipe.to_string_lossy().into_owned();
        goose_serve::run_goose(
            app,
            &[
                "schedule",
                "add",
                "--schedule-id",
                &task.id,
                "--cron",
                &task.schedule,
                "--recipe-source",
                &recipe_text,
            ],
        )
        .await
        .map(|_| ())
    }

    pub async fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
        goose_serve::run_goose(app, &["schedule", "remove", "--schedule-id", id])
            .await
            .map(|_| ())
    }

    pub async fn run_now(app: &AppHandle, id: &str) -> Result<(), String> {
        goose_serve::run_goose(app, &["schedule", "run-now", "--schedule-id", id])
            .await
            .map(|_| ())
    }

    /// 写最小 recipe。只为把一句话交给 goose —— 不引扩展、不带参数。
    fn write_recipe(app: &AppHandle, task: &schema::Model) -> Result<PathBuf, String> {
        let base = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("获取应用数据目录失败: {error}"))?
            .join("goose")
            .join(RECIPE_DIR);
        fs::create_dir_all(&base)
            .map_err(|error| format!("创建 recipe 目录失败 ({}): {error}", base.display()))?;

        // YAML 块标量：每一行都要缩进，空行也要留出两个空格，否则 instructions 会被截断
        let mut instructions = String::new();
        for line in task.prompt.lines() {
            if line.trim().is_empty() {
                instructions.push('\n');
            } else {
                instructions.push_str("  ");
                instructions.push_str(line);
                instructions.push('\n');
            }
        }

        let content = format!(
            "version: 1.0.0\ntitle: {}\ndescription: {}\ninstructions: |\n{}",
            Self::quote(&task.name),
            Self::quote("由 cogito 定时任务生成"),
            instructions
        );
        let path = base.join(format!("{}.yaml", task.id));
        fs::write(&path, content)
            .map_err(|error| format!("写 recipe 失败 ({}): {error}", path.display()))?;
        Ok(path)
    }

    /// YAML 双引号字符串里的转义只处理会破坏语法的那两个字符
    fn quote(value: &str) -> String {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    }
}
