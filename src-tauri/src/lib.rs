mod db;
mod error;
mod llm;
mod models;
mod skills;
mod web_search;

use db::Database;
use error::AppResult;
use llm::{send_chat_completion, send_chat_completion_stream};
use models::{
    ChatRequest, ChatResponse, ChatStreamRequest, Conversation, ConversationDraft, Item, ItemDraft,
    ItemPatch, Memory, MemoryDraft, MemoryPatch, Message, MessageDraft, ModelConfig,
    ModelConfigDraft, ProjectFileContent, ProjectFileEntry, ProjectFileMoveRequest,
    ProjectFileWriteRequest, WebSearchResult,
};
use skills::{sync_anthropic_skills as fetch_anthropic_skills, GitHubSkill};
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
async fn list_conversations(
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> AppResult<Vec<Conversation>> {
    state
        .db
        .lock()
        .await
        .list_conversations(project_path.as_deref())
}

#[tauri::command]
async fn list_archived_conversations(
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> AppResult<Vec<Conversation>> {
    state
        .db
        .lock()
        .await
        .list_archived_conversations(project_path.as_deref())
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
async fn sync_anthropic_skills() -> AppResult<Vec<GitHubSkill>> {
    fetch_anthropic_skills().await
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
        return Err(crate::error::AppError::Message(
            "Unknown technology".to_string(),
        ));
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

#[tauri::command]
async fn create_project_directory(parent_path: String, name: String) -> AppResult<String> {
    let project_name = name.trim();
    if project_name.is_empty() {
        return Err(crate::error::AppError::Message(
            "项目名称不能为空".to_string(),
        ));
    }

    if project_name.contains(['/', '\\']) || project_name == "." || project_name == ".." {
        return Err(crate::error::AppError::Message(
            "项目名称不能包含路径分隔符".to_string(),
        ));
    }

    let parent = std::path::PathBuf::from(parent_path);
    if !parent.is_dir() {
        return Err(crate::error::AppError::Message(
            "请选择有效的父目录".to_string(),
        ));
    }

    let project_path = parent.join(project_name);
    if project_path.exists() {
        return Err(crate::error::AppError::Message(
            "目标项目目录已存在".to_string(),
        ));
    }

    std::fs::create_dir(&project_path)
        .map_err(|err| crate::error::AppError::Message(format!("创建项目目录失败: {err}")))?;

    Ok(project_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn list_project_files(project_path: String) -> AppResult<Vec<ProjectFileEntry>> {
    const MAX_ENTRIES: usize = 300;
    const MAX_DEPTH: usize = 5;
    const SKIP_DIRS: &[&str] = &[
        ".git",
        ".idea",
        ".vscode",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        ".nuxt",
        "coverage",
    ];

    let root = std::path::PathBuf::from(project_path);
    if !root.is_dir() {
        return Err(crate::error::AppError::Message(
            "当前项目目录不可访问".to_string(),
        ));
    }

    let mut entries = Vec::new();
    collect_project_files(
        &root,
        &root,
        0,
        MAX_DEPTH,
        MAX_ENTRIES,
        SKIP_DIRS,
        &mut entries,
    )?;
    Ok(entries)
}

#[tauri::command]
async fn read_project_file(
    project_path: String,
    relative_path: String,
) -> AppResult<ProjectFileContent> {
    const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;

    let root = project_root(&project_path)?;
    let file_path = resolve_project_relative_path(&root, &relative_path)?;
    let metadata = std::fs::metadata(&file_path)
        .map_err(|err| crate::error::AppError::Message(format!("读取文件信息失败: {err}")))?;

    if !metadata.is_file() {
        return Err(crate::error::AppError::Message(
            "只能读取普通文件".to_string(),
        ));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(crate::error::AppError::Message(
            "文件超过 1MB，请交给对应 skill 处理".to_string(),
        ));
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|err| crate::error::AppError::Message(format!("读取文本文件失败: {err}")))?;

    Ok(ProjectFileContent {
        path: normalize_relative_path(&relative_path)?,
        hash: content_hash(&content),
        size: metadata.len(),
        content,
    })
}

#[tauri::command]
async fn create_project_file(request: ProjectFileWriteRequest) -> AppResult<ProjectFileContent> {
    write_project_file_inner(request, false)
}

#[tauri::command]
async fn write_project_file(request: ProjectFileWriteRequest) -> AppResult<ProjectFileContent> {
    write_project_file_inner(request, true)
}

#[tauri::command]
async fn delete_project_file(
    project_path: String,
    relative_path: String,
    approval_text: String,
) -> AppResult<()> {
    let normalized = normalize_relative_path(&relative_path)?;
    if approval_text.trim() != normalized {
        return Err(crate::error::AppError::Message(
            "删除文件需要输入完整相对路径作为审批确认".to_string(),
        ));
    }

    let root = project_root(&project_path)?;
    let file_path = resolve_project_relative_path(&root, &normalized)?;
    let metadata = std::fs::metadata(&file_path)
        .map_err(|err| crate::error::AppError::Message(format!("读取文件信息失败: {err}")))?;

    if !metadata.is_file() {
        return Err(crate::error::AppError::Message(
            "当前仅允许删除普通文件，目录删除后续单独审批".to_string(),
        ));
    }

    std::fs::remove_file(&file_path)
        .map_err(|err| crate::error::AppError::Message(format!("删除文件失败: {err}")))?;
    Ok(())
}

#[tauri::command]
async fn rename_project_file(request: ProjectFileMoveRequest) -> AppResult<ProjectFileEntry> {
    let from_normalized = normalize_relative_path(&request.from_relative_path)?;
    let to_normalized = normalize_relative_path(&request.to_relative_path)?;
    if request.approval_text.trim() != from_normalized {
        return Err(crate::error::AppError::Message(
            "重命名文件需要输入原完整相对路径作为审批确认".to_string(),
        ));
    }

    let root = project_root(&request.project_path)?;
    let from_path = resolve_project_relative_path(&root, &from_normalized)?;
    let to_path = resolve_project_relative_path(&root, &to_normalized)?;
    let metadata = std::fs::metadata(&from_path)
        .map_err(|err| crate::error::AppError::Message(format!("读取文件信息失败: {err}")))?;

    if !metadata.is_file() {
        return Err(crate::error::AppError::Message(
            "当前仅允许重命名普通文件".to_string(),
        ));
    }
    if to_path.exists() {
        return Err(crate::error::AppError::Message(
            "目标路径已存在".to_string(),
        ));
    }
    if let Some(parent) = to_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| crate::error::AppError::Message(format!("创建父目录失败: {err}")))?;
    }

    std::fs::rename(&from_path, &to_path)
        .map_err(|err| crate::error::AppError::Message(format!("重命名文件失败: {err}")))?;

    let new_metadata = std::fs::metadata(&to_path)
        .map_err(|err| crate::error::AppError::Message(format!("读取文件信息失败: {err}")))?;
    Ok(ProjectFileEntry {
        path: to_normalized,
        is_dir: false,
        size: Some(new_metadata.len()),
    })
}

fn write_project_file_inner(
    request: ProjectFileWriteRequest,
    allow_overwrite: bool,
) -> AppResult<ProjectFileContent> {
    let normalized = normalize_relative_path(&request.relative_path)?;
    let root = project_root(&request.project_path)?;
    let file_path = resolve_project_relative_path(&root, &normalized)?;
    let exists = file_path.exists();

    if exists && !allow_overwrite {
        return Err(crate::error::AppError::Message("文件已存在".to_string()));
    }
    if !exists && allow_overwrite {
        return Err(crate::error::AppError::Message(
            "文件不存在，请先新建文件".to_string(),
        ));
    }
    if exists {
        let metadata = std::fs::metadata(&file_path)
            .map_err(|err| crate::error::AppError::Message(format!("读取文件信息失败: {err}")))?;
        if !metadata.is_file() {
            return Err(crate::error::AppError::Message(
                "只能写入普通文件".to_string(),
            ));
        }
        if let Some(expected_hash) = request.expected_hash.as_deref() {
            let current_content = std::fs::read_to_string(&file_path).map_err(|err| {
                crate::error::AppError::Message(format!("读取当前文件失败: {err}"))
            })?;
            if content_hash(&current_content) != expected_hash {
                return Err(crate::error::AppError::Message(
                    "文件已发生变化，请重新读取后再保存".to_string(),
                ));
            }
        }
    }

    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| crate::error::AppError::Message(format!("创建父目录失败: {err}")))?;
    }

    std::fs::write(&file_path, request.content.as_bytes())
        .map_err(|err| crate::error::AppError::Message(format!("写入文件失败: {err}")))?;

    let metadata = std::fs::metadata(&file_path)
        .map_err(|err| crate::error::AppError::Message(format!("读取文件信息失败: {err}")))?;

    Ok(ProjectFileContent {
        path: normalized,
        hash: content_hash(&request.content),
        size: metadata.len(),
        content: request.content,
    })
}

fn collect_project_files(
    root: &std::path::Path,
    dir: &std::path::Path,
    depth: usize,
    max_depth: usize,
    max_entries: usize,
    skip_dirs: &[&str],
    entries: &mut Vec<ProjectFileEntry>,
) -> AppResult<()> {
    if depth > max_depth || entries.len() >= max_entries {
        return Ok(());
    }

    let mut children = std::fs::read_dir(dir)
        .map_err(|err| crate::error::AppError::Message(format!("读取项目目录失败: {err}")))?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();

    children.sort_by_key(|entry| {
        let is_file = entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false);
        (is_file, entry.file_name())
    });

    for child in children {
        if entries.len() >= max_entries {
            break;
        }

        let path = child.path();
        let file_type = match child.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let name = child.file_name().to_string_lossy().to_string();

        if file_type.is_dir()
            && skip_dirs
                .iter()
                .any(|skip| skip.eq_ignore_ascii_case(&name))
        {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let size = if file_type.is_file() {
            child.metadata().ok().map(|metadata| metadata.len())
        } else {
            None
        };

        entries.push(ProjectFileEntry {
            path: relative,
            is_dir: file_type.is_dir(),
            size,
        });

        if file_type.is_dir() {
            collect_project_files(
                root,
                &path,
                depth + 1,
                max_depth,
                max_entries,
                skip_dirs,
                entries,
            )?;
        }
    }

    Ok(())
}

fn project_root(project_path: &str) -> AppResult<std::path::PathBuf> {
    let root = std::path::PathBuf::from(project_path);
    let canonical = root
        .canonicalize()
        .map_err(|err| crate::error::AppError::Message(format!("当前项目目录不可访问: {err}")))?;
    if !canonical.is_dir() {
        return Err(crate::error::AppError::Message(
            "当前项目目录不可访问".to_string(),
        ));
    }
    Ok(canonical)
}

fn normalize_relative_path(relative_path: &str) -> AppResult<String> {
    let trimmed = relative_path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err(crate::error::AppError::Message(
            "文件路径不能为空".to_string(),
        ));
    }
    if trimmed.starts_with('/') || trimmed.contains(':') {
        return Err(crate::error::AppError::Message(
            "请使用项目内相对路径".to_string(),
        ));
    }

    let mut parts = Vec::new();
    for part in trimmed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(crate::error::AppError::Message(
                "文件路径不能包含 ..".to_string(),
            ));
        }
        parts.push(part);
    }

    if parts.is_empty() {
        return Err(crate::error::AppError::Message(
            "文件路径不能为空".to_string(),
        ));
    }

    Ok(parts.join("/"))
}

fn resolve_project_relative_path(
    root: &std::path::Path,
    relative_path: &str,
) -> AppResult<std::path::PathBuf> {
    let normalized = normalize_relative_path(relative_path)?;
    let full_path = root.join(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
    let mut existing_ancestor = full_path.parent().unwrap_or(root).to_path_buf();
    while !existing_ancestor.exists() {
        let Some(parent) = existing_ancestor.parent() else {
            break;
        };
        existing_ancestor = parent.to_path_buf();
    }

    let canonical_parent = existing_ancestor
        .canonicalize()
        .map_err(|err| crate::error::AppError::Message(format!("解析文件路径失败: {err}")))?;

    if !canonical_parent.starts_with(root) {
        return Err(crate::error::AppError::Message(
            "文件路径必须位于当前项目内".to_string(),
        ));
    }

    Ok(full_path)
}

fn content_hash(content: &str) -> String {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            sync_anthropic_skills,
            chat,
            chat_stream,
            check_env,
            install_env,
            create_project_directory,
            list_project_files,
            read_project_file,
            create_project_file,
            write_project_file,
            delete_project_file,
            rename_project_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running NanoAgent");
}
