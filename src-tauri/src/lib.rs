mod agent_runner;
mod db;
mod error;
mod llm;
mod models;
mod observability;
mod runtime;
mod skills;
mod web_search;

use agent_runner::{
    AgentModelOutputResolution, AgentToolDefinition, AgentToolExecution, AgentToolExecutionRequest,
};
use db::Database;
use error::AppResult;
use llm::{send_chat_completion, send_chat_completion_stream};
use models::{
    ChatRequest, ChatResponse, ChatStreamRequest, Conversation, ConversationDraft, Item, ItemDraft,
    ItemPatch, Memory, MemoryDraft, MemoryPatch, Message, MessageDraft, ModelConfig,
    ModelConfigDraft, ProjectFileContent, ProjectFileEntry, ProjectFileMoveRequest,
    ProjectFileWriteRequest, WebSearchResponse,
};
use observability::{
    ObservabilityPipeline, ObservabilitySpan, SpanContext, SpanStart, SqliteObservabilitySink,
};
use runtime::{
    AgentRun, AgentRunDraft, AgentStep, AgentStepDraft, AgentToolCall, AgentToolCallDraft,
    RuntimeStore,
};
use skills::{sync_anthropic_skills as fetch_anthropic_skills, GitHubSkill};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use web_search::internet_search as run_internet_search;

struct AppState {
    db: Mutex<Database>,
    observability: Mutex<ObservabilityPipeline>,
    runtime: Mutex<RuntimeStore>,
}

async fn start_observation(
    state: &State<'_, AppState>,
    operation: &str,
    category: &str,
    entity_type: Option<&str>,
    entity_id: Option<String>,
    input_summary: Option<String>,
    metadata: serde_json::Value,
    trace_id: Option<String>,
) -> Option<SpanContext> {
    state.observability.lock().await.start_span(SpanStart {
        trace_id,
        parent_span_id: None,
        operation: operation.to_string(),
        category: category.to_string(),
        entity_type: entity_type.map(str::to_string),
        entity_id,
        input_summary,
        metadata,
    })
}

async fn finish_observation<T>(
    state: &State<'_, AppState>,
    span: Option<SpanContext>,
    result: &AppResult<T>,
    output_summary: Option<String>,
) {
    let (status, error) = match result {
        Ok(_) => ("ok", None),
        Err(err) => ("error", Some(err.to_string())),
    };
    state
        .observability
        .lock()
        .await
        .finish_span(span, status, output_summary, error);
}

fn count_summary<T>(items: &[T]) -> String {
    format!("count={}", items.len())
}

#[tauri::command]
async fn list_items(state: State<'_, AppState>, kind: Option<String>) -> AppResult<Vec<Item>> {
    let span = start_observation(
        &state,
        "list_items",
        "db",
        Some("item"),
        None,
        kind.as_ref().map(|value| format!("kind={value}")),
        serde_json::json!({}),
        None,
    )
    .await;
    let result = state.db.lock().await.list_items(kind.as_deref());
    let output = result.as_ref().ok().map(|items| count_summary(items));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn search_items(state: State<'_, AppState>, query: String) -> AppResult<Vec<Item>> {
    let span = start_observation(
        &state,
        "search_items",
        "db",
        Some("item"),
        None,
        Some(format!("query_chars={}", query.chars().count())),
        serde_json::json!({}),
        None,
    )
    .await;
    let result = state.db.lock().await.search_items(&query);
    let output = result.as_ref().ok().map(|items| count_summary(items));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn create_item(state: State<'_, AppState>, draft: ItemDraft) -> AppResult<Item> {
    let span = start_observation(
        &state,
        "create_item",
        "db",
        Some("item"),
        None,
        Some(format!("kind={}", draft.kind)),
        serde_json::json!({ "title_chars": draft.title.chars().count() }),
        None,
    )
    .await;
    let result = state.db.lock().await.create_item(draft);
    let output = result
        .as_ref()
        .ok()
        .map(|item| format!("item_id={}", item.id));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn update_item(state: State<'_, AppState>, patch: ItemPatch) -> AppResult<Item> {
    let entity_id = patch.id.clone();
    let span = start_observation(
        &state,
        "update_item",
        "db",
        Some("item"),
        Some(entity_id.clone()),
        None,
        serde_json::json!({}),
        Some(entity_id),
    )
    .await;
    let result = state.db.lock().await.update_item(patch);
    let output = result
        .as_ref()
        .ok()
        .map(|item| format!("item_id={}", item.id));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn delete_item(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let span = start_observation(
        &state,
        "delete_item",
        "db",
        Some("item"),
        Some(id.clone()),
        None,
        serde_json::json!({}),
        Some(id.clone()),
    )
    .await;
    let result = state.db.lock().await.delete_item(&id);
    finish_observation(&state, span, &result, Some("deleted=true".to_string())).await;
    result
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
    let project_path = draft.project_path.clone();
    let span = start_observation(
        &state,
        "create_conversation",
        "db",
        Some("conversation"),
        project_path.clone(),
        draft
            .title
            .as_ref()
            .map(|title| format!("title_chars={}", title.chars().count())),
        serde_json::json!({ "project_path": project_path }),
        None,
    )
    .await;
    let result = state.db.lock().await.create_conversation(draft);
    let output = result
        .as_ref()
        .ok()
        .map(|conversation| format!("conversation_id={}", conversation.id));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn delete_conversation(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let span = start_observation(
        &state,
        "delete_conversation",
        "db",
        Some("conversation"),
        Some(id.clone()),
        None,
        serde_json::json!({}),
        Some(id.clone()),
    )
    .await;
    let result = state.db.lock().await.delete_conversation(&id);
    finish_observation(&state, span, &result, Some("deleted=true".to_string())).await;
    result
}

#[tauri::command]
async fn rename_conversation(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> AppResult<()> {
    state.db.lock().await.rename_conversation(&id, &title)
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
    let span = start_observation(
        &state,
        "list_messages",
        "db",
        Some("conversation"),
        Some(conversation_id.clone()),
        None,
        serde_json::json!({}),
        Some(conversation_id.clone()),
    )
    .await;
    let result = state.db.lock().await.list_messages(&conversation_id);
    let output = result.as_ref().ok().map(|messages| count_summary(messages));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn append_message(state: State<'_, AppState>, draft: MessageDraft) -> AppResult<Message> {
    let span = start_observation(
        &state,
        "append_message",
        "db",
        Some("message"),
        Some(draft.conversation_id.clone()),
        Some(format!("role={}", draft.role)),
        serde_json::json!({ "content_chars": draft.content.chars().count() }),
        Some(draft.conversation_id.clone()),
    )
    .await;
    let result = state.db.lock().await.append_message(draft);
    let output = result.as_ref().ok().map(|message| {
        format!(
            "message_id={}, conversation_id={}",
            message.id, message.conversation_id
        )
    });
    finish_observation(&state, span, &result, output).await;
    result
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
async fn internet_search(
    state: State<'_, AppState>,
    query: String,
    tavily_api_key: Option<String>,
) -> AppResult<WebSearchResponse> {
    let span = start_observation(
        &state,
        "internet_search",
        "external",
        Some("web_search"),
        None,
        Some(format!("query_chars={}", query.chars().count())),
        serde_json::json!({ "has_tavily_key": tavily_api_key.as_deref().is_some_and(|key| !key.trim().is_empty()) }),
        None,
    )
    .await;
    let result = run_internet_search(&query, tavily_api_key.as_deref()).await;
    let output = result
        .as_ref()
        .ok()
        .map(|response| count_summary(&response.results));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn sync_anthropic_skills() -> AppResult<Vec<GitHubSkill>> {
    fetch_anthropic_skills().await
}

#[tauri::command]
async fn list_local_skills(app: AppHandle) -> AppResult<(String, Vec<GitHubSkill>)> {
    skills::list_local_skills(&app).await
}

#[tauri::command]
async fn chat(state: State<'_, AppState>, request: ChatRequest) -> AppResult<ChatResponse> {
    let model_config_id = request.model_config_id.clone();
    let trace_id = request.trace_id.clone();
    let span = start_observation(
        &state,
        "chat",
        "llm",
        Some("model_config"),
        Some(model_config_id.clone()),
        Some(format!("messages={}", request.messages.len())),
        serde_json::json!({ "temperature": request.temperature }),
        trace_id,
    )
    .await;
    let config_result = { state.db.lock().await.get_model_config(&model_config_id) };
    let result = match config_result {
        Ok(config) => send_chat_completion(config, request).await,
        Err(err) => Err(err),
    };
    let output = result
        .as_ref()
        .ok()
        .map(|response| format!("content_chars={}", response.content.chars().count()));
    finish_observation(&state, span, &result, output).await;
    result
}

#[tauri::command]
async fn chat_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChatStreamRequest,
) -> AppResult<()> {
    let model_config_id = request.model_config_id.clone();
    let trace_id = request
        .trace_id
        .clone()
        .unwrap_or_else(|| request.request_id.clone());
    let span = start_observation(
        &state,
        "chat_stream",
        "llm",
        Some("chat_request"),
        Some(request.request_id.clone()),
        Some(format!("messages={}", request.messages.len())),
        serde_json::json!({ "temperature": request.temperature }),
        Some(trace_id),
    )
    .await;
    let config_result = { state.db.lock().await.get_model_config(&model_config_id) };
    let result = match config_result {
        Ok(config) => send_chat_completion_stream(app, config, request).await,
        Err(err) => Err(err),
    };
    finish_observation(&state, span, &result, None).await;
    result
}

#[tauri::command]
async fn create_agent_run(state: State<'_, AppState>, draft: AgentRunDraft) -> AppResult<AgentRun> {
    state.runtime.lock().await.create_run(draft)
}

#[tauri::command]
async fn finish_agent_run(
    state: State<'_, AppState>,
    id: String,
    status: String,
    error: Option<String>,
) -> AppResult<AgentRun> {
    state.runtime.lock().await.finish_run(&id, &status, error)
}

#[tauri::command]
async fn list_agent_runs(
    state: State<'_, AppState>,
    conversation_id: String,
    limit: Option<i64>,
) -> AppResult<Vec<AgentRun>> {
    state
        .runtime
        .lock()
        .await
        .list_runs(&conversation_id, limit.unwrap_or(50))
}

#[tauri::command]
async fn record_agent_step(
    state: State<'_, AppState>,
    draft: AgentStepDraft,
) -> AppResult<AgentStep> {
    state.runtime.lock().await.record_step(draft)
}

#[tauri::command]
async fn create_agent_tool_call(
    state: State<'_, AppState>,
    draft: AgentToolCallDraft,
) -> AppResult<AgentToolCall> {
    state.runtime.lock().await.create_tool_call(draft)
}

#[tauri::command]
async fn update_agent_tool_call(
    state: State<'_, AppState>,
    id: String,
    status: String,
    result_summary: Option<String>,
    error: Option<String>,
) -> AppResult<AgentToolCall> {
    state
        .runtime
        .lock()
        .await
        .update_tool_call(&id, &status, result_summary, error)
}

#[tauri::command]
async fn approve_agent_tool_call(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<AgentToolCall> {
    let runtime = state.runtime.lock().await;
    let tool_call = runtime.approve_tool_call(&id)?;
    runtime.record_step(AgentStepDraft {
        run_id: tool_call.run_id.clone(),
        kind: "approval".to_string(),
        status: "approved".to_string(),
        input_summary: Some(tool_call.name.clone()),
        output_summary: Some("user_approved".to_string()),
        metadata_json: Some(serde_json::json!({ "tool_call_id": tool_call.id }).to_string()),
    })?;
    Ok(tool_call)
}

#[tauri::command]
async fn reject_agent_tool_call(
    state: State<'_, AppState>,
    id: String,
    reason: Option<String>,
) -> AppResult<AgentToolCall> {
    let runtime = state.runtime.lock().await;
    let tool_call = runtime.reject_tool_call(&id, reason.clone())?;
    runtime.record_step(AgentStepDraft {
        run_id: tool_call.run_id.clone(),
        kind: "approval".to_string(),
        status: "rejected".to_string(),
        input_summary: Some(tool_call.name.clone()),
        output_summary: reason.or_else(|| Some("user_rejected".to_string())),
        metadata_json: Some(serde_json::json!({ "tool_call_id": tool_call.id }).to_string()),
    })?;
    runtime.finish_run(&tool_call.run_id, "rejected", None)?;
    Ok(tool_call)
}

#[tauri::command]
async fn list_agent_tool_definitions() -> AppResult<Vec<AgentToolDefinition>> {
    Ok(agent_runner::tool_definitions())
}

#[tauri::command]
async fn resolve_agent_model_output(
    state: State<'_, AppState>,
    run_id: String,
    message_id: String,
    content: String,
    step_kind: Option<String>,
    input_summary: Option<String>,
) -> AppResult<AgentModelOutputResolution> {
    let parsed = match agent_runner::parse_tool_call(&content) {
        Ok(parsed) => parsed,
        Err(err) => {
            let runtime = state.runtime.lock().await;
            let _ = runtime.record_step(AgentStepDraft {
                run_id: run_id.clone(),
                kind: step_kind.unwrap_or_else(|| "model".to_string()),
                status: "failed".to_string(),
                input_summary,
                output_summary: Some(err.to_string()),
                metadata_json: Some(serde_json::json!({ "message_id": message_id }).to_string()),
            });
            let _ = runtime.finish_run(&run_id, "failed", Some(err.to_string()));
            return Err(err);
        }
    };

    let runtime = state.runtime.lock().await;
    runtime.record_step(AgentStepDraft {
        run_id: run_id.clone(),
        kind: step_kind.unwrap_or_else(|| "model".to_string()),
        status: "completed".to_string(),
        input_summary,
        output_summary: Some(format!("content_chars={}", content.chars().count())),
        metadata_json: Some(serde_json::json!({ "message_id": message_id }).to_string()),
    })?;

    let tool_call = if let Some(parsed) = parsed {
        let tool_call = runtime.create_tool_call(AgentToolCallDraft {
            run_id: run_id.clone(),
            message_id,
            name: parsed.name,
            args_json: agent_runner::args_to_json(&parsed.args)?,
        })?;
        runtime.finish_run(&run_id, "awaiting_tool", None)?;
        Some(tool_call)
    } else {
        runtime.finish_run(&run_id, "completed", None)?;
        None
    };

    Ok(AgentModelOutputResolution {
        run_id,
        status: if tool_call.is_some() {
            "awaiting_tool".to_string()
        } else {
            "completed".to_string()
        },
        tool_call,
    })
}

#[tauri::command]
async fn execute_agent_tool_call(
    state: State<'_, AppState>,
    request: AgentToolExecutionRequest,
) -> AppResult<AgentToolExecution> {
    let running_tool_call = {
        let runtime = state.runtime.lock().await;
        let tool_call = runtime.get_tool_call(&request.tool_call_id)?;
        if tool_call.status != "approved" {
            return Err(crate::error::AppError::Message(format!(
                "tool call must be approved before execution; current status: {}",
                tool_call.status
            )));
        }
        runtime.update_tool_call(&tool_call.id, "running", None, None)?
    };

    let result = execute_registered_tool(
        &running_tool_call,
        &request.project_path,
        request.allow_command,
    );

    match result {
        Ok(result_text) => {
            let runtime = state.runtime.lock().await;
            runtime.record_step(AgentStepDraft {
                run_id: running_tool_call.run_id.clone(),
                kind: "tool".to_string(),
                status: "completed".to_string(),
                input_summary: Some(running_tool_call.name.clone()),
                output_summary: Some(agent_runner::summarize(&result_text, 500)),
                metadata_json: Some(
                    serde_json::json!({ "tool_call_id": running_tool_call.id }).to_string(),
                ),
            })?;
            let tool_call = runtime.update_tool_call(
                &running_tool_call.id,
                "completed",
                Some(agent_runner::summarize(&result_text, 500)),
                None,
            )?;
            Ok(AgentToolExecution {
                tool_call,
                result_text,
            })
        }
        Err(err) => {
            let runtime = state.runtime.lock().await;
            let _ = runtime.record_step(AgentStepDraft {
                run_id: running_tool_call.run_id.clone(),
                kind: "tool".to_string(),
                status: "failed".to_string(),
                input_summary: Some(running_tool_call.name.clone()),
                output_summary: Some(err.to_string()),
                metadata_json: Some(
                    serde_json::json!({ "tool_call_id": running_tool_call.id }).to_string(),
                ),
            });
            let _ = runtime.update_tool_call(
                &running_tool_call.id,
                "failed",
                None,
                Some(err.to_string()),
            );
            Err(err)
        }
    }
}

fn execute_registered_tool(
    tool_call: &AgentToolCall,
    project_path: &str,
    allow_command: bool,
) -> AppResult<String> {
    let args = agent_runner::parse_args_json(&tool_call.args_json)?;
    agent_runner::validate_tool_args(&tool_call.name, &args)?;

    match tool_call.name.as_str() {
        "read_file" => {
            let relative_path = required_tool_arg(&args, "path")?;
            let content = read_project_text(project_path, relative_path)?;
            Ok(format!(
                "读取文件 {relative_path} 成功，内容如下：\n\n```\n{content}\n```"
            ))
        }
        "write_file" => {
            let relative_path = required_tool_arg(&args, "path")?;
            let content = required_tool_arg(&args, "content")?;
            write_project_text(project_path, relative_path, content)?;
            Ok(format!(
                "File {relative_path} written successfully; content length: {} characters.",
                content.chars().count()
            ))
        }
        "execute_command" => {
            if !allow_command {
                return Err(crate::error::AppError::Message(
                    "Bash Tool 技能已被禁用，请在设置中启用后再试。".to_string(),
                ));
            }
            let command = required_tool_arg(&args, "command")?;
            let output = run_project_command(project_path, command)?;
            Ok(format!(
                "命令执行成功，输出结果如下：\n\n```\n{output}\n```"
            ))
        }
        _ => Err(crate::error::AppError::Message(format!(
            "unknown tool: {}",
            tool_call.name
        ))),
    }
}

fn required_tool_arg<'a>(
    args: &'a std::collections::BTreeMap<String, String>,
    name: &str,
) -> AppResult<&'a str> {
    args.get(name)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| crate::error::AppError::Message(format!("missing tool argument: {name}")))
}

fn read_project_text(project_path: &str, relative_path: &str) -> AppResult<String> {
    const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;

    let root = project_root(project_path)?;
    let target_path = resolve_project_relative_path(&root, relative_path)?;
    let metadata = std::fs::metadata(&target_path)?;
    if !metadata.is_file() {
        return Err(crate::error::AppError::Message(
            "Can only read regular files".to_string(),
        ));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(crate::error::AppError::Message(
            "File exceeds 1MB; please use an appropriate skill".to_string(),
        ));
    }
    std::fs::read_to_string(target_path).map_err(crate::error::AppError::from)
}

fn write_project_text(project_path: &str, relative_path: &str, content: &str) -> AppResult<()> {
    let root = project_root(project_path)?;
    let target_path = resolve_project_relative_path(&root, relative_path)?;
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(target_path, content.as_bytes()).map_err(crate::error::AppError::from)
}

fn run_project_command(project_path: &str, command: &str) -> AppResult<String> {
    let root = project_root(project_path)?;
    let mut c = if cfg!(target_os = "windows") {
        let mut cmd = std::process::Command::new("powershell.exe");
        cmd.arg("-NoProfile").arg("-Command").arg(command);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd
    } else {
        let mut cmd = std::process::Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    };

    c.current_dir(root);
    let output = c.output()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(crate::error::AppError::Message(format!(
            "Command failed with code {:?}\nStdout: {}\nStderr: {}",
            output.status.code(),
            stdout,
            stderr
        )))
    }
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

    let output = c
        .output()
        .map_err(|err| crate::error::AppError::Message(err.to_string()))?;
    if output.status.success() {
        return Ok(true);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(crate::error::AppError::Message(format!(
        "install failed with code {:?}\nStdout: {}\nStderr: {}",
        output.status.code(),
        stdout,
        stderr
    )))
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

#[tauri::command]
async fn execute_bash_command(
    state: State<'_, AppState>,
    project_path: String,
    command: String,
) -> AppResult<String> {
    let span = start_observation(
        &state,
        "execute_bash_command",
        "tool",
        Some("project"),
        Some(project_path.clone()),
        Some(format!("command_chars={}", command.chars().count())),
        serde_json::json!({ "project_path": project_path.clone() }),
        None,
    )
    .await;
    let result = (|| -> AppResult<String> {
        let root = project_root(&project_path)?;
        let mut c = if cfg!(target_os = "windows") {
            let mut cmd = std::process::Command::new("powershell.exe");
            cmd.arg("-NoProfile").arg("-Command").arg(&command);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            cmd
        } else {
            let mut cmd = std::process::Command::new("sh");
            cmd.arg("-c").arg(&command);
            cmd
        };

        c.current_dir(root);
        let output = c.output()?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            Ok(stdout)
        } else {
            Err(crate::error::AppError::Message(format!(
                "Command failed with code {:?}\nStdout: {}\nStderr: {}",
                output.status.code(),
                stdout,
                stderr
            )))
        }
    })();
    let summary = result
        .as_ref()
        .ok()
        .map(|stdout| format!("stdout_chars={}", stdout.chars().count()));
    finish_observation(&state, span, &result, summary).await;
    result
}

#[tauri::command]
async fn write_local_file(
    state: State<'_, AppState>,
    project_path: String,
    path: String,
    content: String,
) -> AppResult<()> {
    let span = start_observation(
        &state,
        "write_local_file",
        "tool",
        Some("file"),
        Some(path.clone()),
        Some(format!("content_chars={}", content.chars().count())),
        serde_json::json!({ "project_path": project_path.clone() }),
        None,
    )
    .await;
    let result = (|| -> AppResult<()> {
        let root = project_root(&project_path)?;
        let target_path = resolve_project_relative_path(&root, &path)?;
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(target_path, content.as_bytes())?;
        Ok(())
    })();
    finish_observation(&state, span, &result, Some("written=true".to_string())).await;
    result
}

#[tauri::command]
async fn read_local_file(
    state: State<'_, AppState>,
    project_path: String,
    path: String,
) -> AppResult<String> {
    let span = start_observation(
        &state,
        "read_local_file",
        "tool",
        Some("file"),
        Some(path.clone()),
        None,
        serde_json::json!({ "project_path": project_path.clone() }),
        None,
    )
    .await;
    let result = (|| -> AppResult<String> {
        const MAX_TEXT_FILE_BYTES: u64 = 1024 * 1024;

        let root = project_root(&project_path)?;
        let target_path = resolve_project_relative_path(&root, &path)?;
        let metadata = std::fs::metadata(&target_path)?;
        if !metadata.is_file() {
            return Err(crate::error::AppError::Message(
                "Can only read regular files".to_string(),
            ));
        }
        if metadata.len() > MAX_TEXT_FILE_BYTES {
            return Err(crate::error::AppError::Message(
                "File exceeds 1MB; please use an appropriate skill".to_string(),
            ));
        }

        Ok(std::fs::read_to_string(target_path)?)
    })();
    let summary = result
        .as_ref()
        .ok()
        .map(|content| format!("content_chars={}", content.chars().count()));
    finish_observation(&state, span, &result, summary).await;
    result
}

#[tauri::command]
async fn list_observability_spans(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> AppResult<Vec<ObservabilitySpan>> {
    state.observability.lock().await.list_spans(limit)
}

#[tauri::command]
async fn clear_observability_spans(state: State<'_, AppState>) -> AppResult<()> {
    state.observability.lock().await.clear()
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
            let temp_dir = data_dir.join("temp");
            std::fs::create_dir_all(&temp_dir)
                .map_err(|err| format!("failed to create temp directory: {err}"))?;
            let db_path = data_dir.join("nano-agent.sqlite3");
            let db = Database::open(db_path).map_err(|err| err.to_string())?;
            let runtime_path = data_dir.join("nano-agent-runtime.sqlite3");
            let runtime = RuntimeStore::open(runtime_path).map_err(|err| err.to_string())?;
            let observability_path = data_dir.join("nano-agent-observability.sqlite3");
            let observability = match SqliteObservabilitySink::open(observability_path) {
                Ok(sink) => ObservabilityPipeline::new(vec![Box::new(sink)]),
                Err(err) => {
                    eprintln!("observability disabled: {err}");
                    ObservabilityPipeline::disabled()
                }
            };

            app.manage(AppState {
                db: Mutex::new(db),
                observability: Mutex::new(observability),
                runtime: Mutex::new(runtime),
            });
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
            rename_conversation,
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
            list_local_skills,
            chat,
            chat_stream,
            create_agent_run,
            finish_agent_run,
            list_agent_runs,
            record_agent_step,
            create_agent_tool_call,
            update_agent_tool_call,
            approve_agent_tool_call,
            reject_agent_tool_call,
            list_agent_tool_definitions,
            resolve_agent_model_output,
            execute_agent_tool_call,
            check_env,
            install_env,
            create_project_directory,
            list_project_files,
            read_project_file,
            create_project_file,
            write_project_file,
            delete_project_file,
            rename_project_file,
            execute_bash_command,
            write_local_file,
            read_local_file,
            list_observability_spans,
            clear_observability_spans
        ])
        .run(tauri::generate_context!())
        .expect("error while running NanoAgent");
}
