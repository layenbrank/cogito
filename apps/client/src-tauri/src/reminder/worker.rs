//! Reminder ticker: claim-then-notify with catch-up.

use std::time::Duration;

use chrono::{Local, TimeZone, Utc};
use cogito_core::reminder::{Service, is_one_shot, should_fire};
use cogito_database::Storage;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

const POLL_INTERVAL_SECS: u64 = 12;

/// Spawn the reminder polling task. Safe to call once during `setup`.
pub fn spawn_worker<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        // Tick immediately so minute-end startup does not miss.
        if let Err(err) = tick_once(&app).await {
            tracing::warn!("reminder ticker: {err}");
        }
        loop {
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
            if let Err(err) = tick_once(&app).await {
                tracing::warn!("reminder ticker: {err}");
            }
        }
    });
}

async fn tick_once<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let storage = app
        .try_state::<Storage>()
        .ok_or_else(|| "storage not ready".to_string())?;
    let reminders = Service::toReadSchedulable(storage.connection())
        .await
        .map_err(|e| e.to_string())?;
    if reminders.is_empty() {
        return Ok(());
    }

    let now_ms = Utc::now().timestamp_millis();

    for reminder in reminders {
        if !should_fire(&reminder, now_ms) {
            continue;
        }

        let one_shot = is_one_shot(&reminder.week_days);
        let claimed = Service::toClaimFire(storage.connection(), &reminder.id, one_shot)
            .await
            .map_err(|e| e.to_string())?;
        let Some(claimed) = claimed else {
            continue;
        };

        let title = if claimed.title.is_empty() {
            "提醒".to_string()
        } else {
            claimed.title.clone()
        };
        let body = claimed
            .fire_time
            .clone()
            .or_else(|| {
                claimed.due_at.map(|ts| {
                    Local
                        .timestamp_millis_opt(ts)
                        .single()
                        .map(|d| d.format("%H:%M").to_string())
                        .unwrap_or_else(|| "到期".to_string())
                })
            })
            .unwrap_or_else(|| "提醒".to_string());

        #[cfg(desktop)]
        {
            let _ = app
                .notification()
                .builder()
                .title(&title)
                .body(&body)
                .show();
        }

        let _ = app.emit("reminder:fired", claimed.id);
    }

    Ok(())
}
