use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
struct AppSettings {
    tavily_api_key: String,
}

#[tauri::command]
pub async fn get_tavily_api_key(app: AppHandle) -> AppResult<String> {
    Ok(load_app_settings(&app)?.tavily_api_key)
}

#[tauri::command]
pub async fn save_tavily_api_key(app: AppHandle, api_key: String) -> AppResult<()> {
    let mut settings = load_app_settings(&app)?;
    settings.tavily_api_key = api_key.trim().to_string();
    save_app_settings(&app, &settings)
}

pub fn load_tavily_api_key(app: &AppHandle) -> AppResult<Option<String>> {
    let key = load_app_settings(app)?.tavily_api_key.trim().to_string();
    Ok(if key.is_empty() { None } else { Some(key) })
}

fn app_settings_path(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Message(format!("failed to resolve app data directory: {err}")))?;
    std::fs::create_dir_all(&data_dir)?;
    Ok(data_dir.join("settings.json"))
}

fn load_app_settings(app: &AppHandle) -> AppResult<AppSettings> {
    let path = app_settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = std::fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(AppSettings::default());
    }

    serde_json::from_str(&content)
        .map_err(|err| AppError::Message(format!("读取应用设置失败: {err}")))
}

fn save_app_settings(app: &AppHandle, settings: &AppSettings) -> AppResult<()> {
    let path = app_settings_path(app)?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|err| AppError::Message(format!("序列化应用设置失败: {err}")))?;
    std::fs::write(path, content.as_bytes())?;
    Ok(())
}
