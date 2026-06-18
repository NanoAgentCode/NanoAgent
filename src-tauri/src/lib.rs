mod db;
mod error;
mod llm;
mod models;
mod web_search;

use db::Database;
use error::AppResult;
use llm::{send_chat_completion, send_chat_completion_stream};
use models::{
    ChatRequest, ChatResponse, ChatStreamRequest, Conversation, ConversationDraft, Item,
    ItemDraft, ItemPatch, Memory, MemoryDraft, MemoryPatch, Message, MessageDraft, ModelConfig,
    ModelConfigDraft, WebSearchResult,
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use web_search::internet_search as run_internet_search;

struct AppState {
    db: Mutex<Database>,
}

#[tauri::command]
async fn list_items(state: State<'_, AppState>, kind: Option<String>) -> AppResult<Vec<Item>> {
    state.db.lock().await.list_items(kind.as_deref())
}

#[tauri::command]
async fn search_items(state: State<'_, AppState>, query: String) -> AppResult<Vec<Item>> {
    state.db.lock().await.search_items(&query)
}

#[tauri::command]
async fn create_item(state: State<'_, AppState>, draft: ItemDraft) -> AppResult<Item> {
    state.db.lock().await.create_item(draft)
}

#[tauri::command]
async fn update_item(state: State<'_, AppState>, patch: ItemPatch) -> AppResult<Item> {
    state.db.lock().await.update_item(patch)
}

#[tauri::command]
async fn delete_item(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.lock().await.delete_item(&id)
}

#[tauri::command]
async fn list_model_configs(state: State<'_, AppState>) -> AppResult<Vec<ModelConfig>> {
    state.db.lock().await.list_model_configs()
}

#[tauri::command]
async fn save_model_config(
    state: State<'_, AppState>,
    draft: ModelConfigDraft,
) -> AppResult<ModelConfig> {
    state.db.lock().await.save_model_config(draft)
}

#[tauri::command]
async fn delete_model_config(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.lock().await.delete_model_config(&id)
}

#[tauri::command]
async fn list_conversations(state: State<'_, AppState>) -> AppResult<Vec<Conversation>> {
    state.db.lock().await.list_conversations()
}

#[tauri::command]
async fn list_archived_conversations(state: State<'_, AppState>) -> AppResult<Vec<Conversation>> {
    state.db.lock().await.list_archived_conversations()
}

#[tauri::command]
async fn create_conversation(
    state: State<'_, AppState>,
    draft: ConversationDraft,
) -> AppResult<Conversation> {
    state.db.lock().await.create_conversation(draft)
}

#[tauri::command]
async fn delete_conversation(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.lock().await.delete_conversation(&id)
}

#[tauri::command]
async fn archive_conversation(
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> AppResult<()> {
    state.db.lock().await.archive_conversation(&id, archived)
}

#[tauri::command]
async fn list_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<Vec<Message>> {
    state.db.lock().await.list_messages(&conversation_id)
}

#[tauri::command]
async fn append_message(state: State<'_, AppState>, draft: MessageDraft) -> AppResult<Message> {
    state.db.lock().await.append_message(draft)
}

#[tauri::command]
async fn list_memories(state: State<'_, AppState>) -> AppResult<Vec<Memory>> {
    state.db.lock().await.list_memories()
}

#[tauri::command]
async fn list_enabled_memories(state: State<'_, AppState>) -> AppResult<Vec<Memory>> {
    state.db.lock().await.list_enabled_memories()
}

#[tauri::command]
async fn search_memories(state: State<'_, AppState>, query: String) -> AppResult<Vec<Memory>> {
    state.db.lock().await.search_memories(&query)
}

#[tauri::command]
async fn create_memory(state: State<'_, AppState>, draft: MemoryDraft) -> AppResult<Memory> {
    state.db.lock().await.create_memory(draft)
}

#[tauri::command]
async fn update_memory(state: State<'_, AppState>, patch: MemoryPatch) -> AppResult<Memory> {
    state.db.lock().await.update_memory(patch)
}

#[tauri::command]
async fn delete_memory(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.lock().await.delete_memory(&id)
}

#[tauri::command]
async fn internet_search(query: String) -> AppResult<Vec<WebSearchResult>> {
    run_internet_search(&query).await
}

#[tauri::command]
async fn chat(state: State<'_, AppState>, request: ChatRequest) -> AppResult<ChatResponse> {
    let config = state
        .db
        .lock()
        .await
        .get_model_config(&request.model_config_id)?;

    send_chat_completion(config, request).await
}

#[tauri::command]
async fn chat_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChatStreamRequest,
) -> AppResult<()> {
    let config = state
        .db
        .lock()
        .await
        .get_model_config(&request.model_config_id)?;

    send_chat_completion_stream(app, config, request).await
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn check_cmd_exists(cmd: &str) -> bool {
    let mut c = std::process::Command::new(cmd);
    c.arg("--version");
    #[cfg(target_os = "windows")]
    c.creation_flags(0x08000000); // CREATE_NO_WINDOW
    c.output().is_ok()
}

fn check_python_exists() -> bool {
    check_cmd_exists("python") || check_cmd_exists("py")
}

#[tauri::command]
async fn check_env(
    node_path: Option<String>,
    python_path: Option<String>,
) -> AppResult<std::collections::HashMap<String, bool>> {
    let mut status = std::collections::HashMap::new();

    let node_ok = if let Some(ref path) = node_path {
        if !path.trim().is_empty() {
            check_cmd_exists(path)
        } else {
            check_cmd_exists("node")
        }
    } else {
        check_cmd_exists("node")
    };

    let python_ok = if let Some(ref path) = python_path {
        if !path.trim().is_empty() {
            check_cmd_exists(path)
        } else {
            check_python_exists()
        }
    } else {
        check_python_exists()
    };

    status.insert("node".to_string(), node_ok);
    status.insert("python".to_string(), python_ok);
    Ok(status)
}

#[tauri::command]
async fn delete_messages(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<()> {
    state.db.lock().await.delete_messages(&ids)
}

#[tauri::command]
async fn install_env(tech: String) -> AppResult<bool> {
    let pkg_id = if tech == "node" {
        "OpenJS.NodeJS"
    } else if tech == "python" {
        "Python.Python.3"
    } else {
        return Err(crate::error::AppError::Message("Unknown technology".to_string()));
    };

    let mut c = std::process::Command::new("winget");
    c.args(&[
        "install",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
        pkg_id,
    ]);
    #[cfg(target_os = "windows")]
    c.creation_flags(0x08000000); // CREATE_NO_WINDOW

    match c.status() {
        Ok(s) => Ok(s.success()),
        Err(e) => Err(crate::error::AppError::Message(e.to_string())),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|err| format!("failed to create app data directory: {err}"))?;
            let db_path = data_dir.join("nano-agent.sqlite3");
            let db = Database::open(db_path).map_err(|err| err.to_string())?;

            app.manage(AppState { db: Mutex::new(db) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_items,
            search_items,
            create_item,
            update_item,
            delete_item,
            list_model_configs,
            save_model_config,
            delete_model_config,
            list_conversations,
            list_archived_conversations,
            create_conversation,
            delete_conversation,
            archive_conversation,
            list_messages,
            append_message,
            delete_messages,
            list_memories,
            list_enabled_memories,
            search_memories,
            create_memory,
            update_memory,
            delete_memory,
            internet_search,
            chat,
            chat_stream,
            check_env,
            install_env
        ])
        .run(tauri::generate_context!())
        .expect("error while running NanoAgent");
}
