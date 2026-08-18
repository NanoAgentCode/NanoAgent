use std::env;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::code_index::build_project_code_index;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::llm::stream_chat_completion;
use crate::models::{ChatMessage, ChatStreamEvent, ChatStreamRequest, ModelConfig};
use crate::project_files::{list_project_files, project_root};
use crate::project_index::{build_document_index, DOCUMENT_INDEXER};

const APP_IDENTIFIER: &str = "com.nanoagent.desktop";
const EMBEDDING_CONFIG_ID: &str = "embedding-config";
const CODE_MATCH_LIMIT: i64 = 8;
const DOCUMENT_MATCH_LIMIT: i64 = 6;
const MAX_HISTORY_MESSAGES: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionMode {
    Project(PathBuf),
    Temporary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CliOptions {
    mode: SessionMode,
    prompt: Option<String>,
    model: Option<String>,
    data_dir: Option<PathBuf>,
    rebuild_index: bool,
    help: bool,
    version: bool,
}

impl Default for CliOptions {
    fn default() -> Self {
        Self {
            mode: SessionMode::Project(env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
            prompt: None,
            model: None,
            data_dir: None,
            rebuild_index: true,
            help: false,
            version: false,
        }
    }
}

pub fn run() -> i32 {
    let options = match parse_args(env::args().skip(1)) {
        Ok(options) => options,
        Err(err) => {
            eprintln!("nano: {err}\n");
            print_help();
            return 2;
        }
    };

    if options.help {
        print_help();
        return 0;
    }
    if options.version {
        println!("nano {}", env!("CARGO_PKG_VERSION"));
        return 0;
    }

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("nano: 无法启动异步运行时: {err}");
            return 1;
        }
    };

    match runtime.block_on(run_session(options)) {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("nano: {err}");
            1
        }
    }
}

fn parse_args<I>(args: I) -> Result<CliOptions, String>
where
    I: IntoIterator<Item = String>,
{
    let mut options = CliOptions::default();
    let mut args = args.into_iter();
    let mut mode_was_set = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => options.help = true,
            "-V" | "--version" => options.version = true,
            "--temp" => {
                if mode_was_set {
                    return Err("--temp 与 --project 不能同时使用".to_string());
                }
                options.mode = SessionMode::Temporary;
                mode_was_set = true;
            }
            "--project" | "-C" => {
                if mode_was_set {
                    return Err("--project 与 --temp 不能同时使用".to_string());
                }
                options.mode = SessionMode::Project(PathBuf::from(next_value(&mut args, &arg)?));
                mode_was_set = true;
            }
            "-p" | "--prompt" => options.prompt = Some(next_value(&mut args, &arg)?),
            "-m" | "--model" => options.model = Some(next_value(&mut args, &arg)?),
            "--data-dir" => options.data_dir = Some(PathBuf::from(next_value(&mut args, &arg)?)),
            "--no-index" => options.rebuild_index = false,
            _ if arg.starts_with('-') => return Err(format!("未知参数: {arg}")),
            _ => {
                if options.prompt.is_some() {
                    return Err(format!("多余的位置参数: {arg}"));
                }
                options.prompt = Some(arg);
            }
        }
    }

    Ok(options)
}

fn next_value<I>(args: &mut I, option: &str) -> Result<String, String>
where
    I: Iterator<Item = String>,
{
    args.next()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{option} 缺少参数值"))
}

async fn run_session(options: CliOptions) -> AppResult<()> {
    let data_dir = match options.data_dir {
        Some(path) => path,
        None => default_app_data_dir()?,
    };
    std::fs::create_dir_all(&data_dir)?;
    let db = Database::open(data_dir.join("nano-agent.sqlite3"))?;
    let models = chat_models(&db)?;
    if models.is_empty() {
        return Err(AppError::Message(
            "没有可用的聊天模型，请先在 NanoAgent 桌面端的设置中添加模型".to_string(),
        ));
    }
    let mut active_model = resolve_model(&models, options.model.as_deref())?;

    let project = match options.mode {
        SessionMode::Temporary => None,
        SessionMode::Project(path) => {
            let root = project_root(&path.to_string_lossy())?;
            if options.rebuild_index {
                rebuild_project_indexes(&db, &root)?;
            }
            Some(root)
        }
    };

    if let Some(prompt) = options.prompt {
        let mut history = Vec::new();
        ask(
            &db,
            &active_model,
            project.as_deref(),
            &mut history,
            &prompt,
        )
        .await?;
        return Ok(());
    }

    print_banner(&active_model, project.as_deref());
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut history = Vec::new();
    loop {
        print!("nano> ");
        io::stdout().flush()?;
        let Some(line) = lines.next() else {
            println!();
            break;
        };
        let input = line?.trim().to_string();
        if input.is_empty() {
            continue;
        }
        if input == "/exit" || input == "/quit" {
            break;
        }
        if input == "/help" {
            print_interactive_help();
            continue;
        }
        if input == "/clear" {
            history.clear();
            println!("已清空当前临时上下文。");
            continue;
        }
        if input == "/model" {
            print_models(&models, &active_model);
            continue;
        }
        if let Some(selector) = input.strip_prefix("/model ") {
            match resolve_model(&models, Some(selector.trim())) {
                Ok(model) => {
                    active_model = model;
                    println!("已切换到 {} ({})", active_model.name, active_model.model);
                }
                Err(err) => eprintln!("nano: {err}"),
            }
            continue;
        }

        if let Err(err) = ask(&db, &active_model, project.as_deref(), &mut history, &input).await {
            eprintln!("nano: {err}");
        }
    }
    Ok(())
}

fn chat_models(db: &Database) -> AppResult<Vec<ModelConfig>> {
    Ok(db
        .list_model_configs()?
        .into_iter()
        .filter(|model| model.id != EMBEDDING_CONFIG_ID)
        .collect())
}

fn resolve_model(models: &[ModelConfig], selector: Option<&str>) -> AppResult<ModelConfig> {
    let selected = match selector.map(str::trim).filter(|value| !value.is_empty()) {
        None => models.first(),
        Some(selector) => models.iter().find(|model| {
            model.id == selector
                || model.name.eq_ignore_ascii_case(selector)
                || model.model.eq_ignore_ascii_case(selector)
        }),
    };
    selected.cloned().ok_or_else(|| {
        AppError::Message(format!(
            "未找到模型{}；使用 /model 查看可用模型",
            selector
                .map(|value| format!("“{value}”"))
                .unwrap_or_default()
        ))
    })
}

fn rebuild_project_indexes(db: &Database, root: &Path) -> AppResult<()> {
    let canonical = root.to_string_lossy().to_string();
    eprintln!("nano: 正在索引项目 {}", display_project_path(root));
    let code = build_project_code_index(root, &canonical)?;
    db.replace_code_index(
        &canonical,
        code.file_count,
        &code.entities,
        &code.relations,
        &code.chunks,
        None,
    )?;
    let documents = build_document_index(root, &canonical)?;
    db.replace_project_index(
        &canonical,
        DOCUMENT_INDEXER,
        documents.file_count,
        &documents.chunks,
        None,
    )?;
    eprintln!("nano: 项目索引已就绪");
    Ok(())
}

async fn ask(
    db: &Database,
    model: &ModelConfig,
    project: Option<&Path>,
    history: &mut Vec<ChatMessage>,
    input: &str,
) -> AppResult<()> {
    let system = build_system_message(db, project, input).await?;
    let user_message = ChatMessage {
        role: "user".to_string(),
        content: input.to_string(),
    };
    let mut messages = Vec::with_capacity(history.len() + 2);
    messages.push(system);
    messages.extend(history.iter().cloned());
    messages.push(user_message.clone());

    let request_id = Uuid::new_v4().to_string();
    let request = ChatStreamRequest {
        request_id,
        model_config_id: model.id.clone(),
        messages,
        temperature: Some(0.4),
        trace_id: None,
    };
    let mut answer = String::new();
    let mut stream_error = None;
    print!("\nnano: ");
    io::stdout().flush()?;
    stream_chat_completion(model.clone(), request, |event| {
        match event {
            ChatStreamEvent::Delta { content, .. } => {
                print!("{content}");
                io::stdout().flush()?;
                answer.push_str(&content);
            }
            ChatStreamEvent::Error { message, .. } => stream_error = Some(message),
            ChatStreamEvent::ReasoningDelta { .. } | ChatStreamEvent::Done { .. } => {}
        }
        Ok(())
    })
    .await?;
    println!("\n");
    if let Some(message) = stream_error {
        return Err(AppError::Message(message));
    }
    if answer.trim().is_empty() {
        return Err(AppError::Message("模型返回了空响应".to_string()));
    }
    history.push(user_message);
    history.push(ChatMessage {
        role: "assistant".to_string(),
        content: answer,
    });
    if history.len() > MAX_HISTORY_MESSAGES {
        let drain_count = history.len() - MAX_HISTORY_MESSAGES;
        history.drain(0..drain_count);
    }
    Ok(())
}

async fn build_system_message(
    db: &Database,
    project: Option<&Path>,
    query: &str,
) -> AppResult<ChatMessage> {
    let memories = db.list_relevant_memories(query, Some(8))?;
    let memory_context = memories
        .iter()
        .map(|memory| format!("- {}: {}", memory.title, memory.content))
        .collect::<Vec<_>>()
        .join("\n");
    let mut sections = vec![
        "你是 NanoAgent 的终端助手。回答应准确、简明、可执行。当前会话只保存在进程内，退出后不会写入对话历史。".to_string(),
    ];
    if !memory_context.is_empty() {
        sections.push(format!(
            "用户相关记忆（仅在与问题有关时使用）：\n{memory_context}"
        ));
    }

    if let Some(root) = project {
        let canonical = root.to_string_lossy().to_string();
        let files = list_project_files(canonical.clone()).await?;
        let file_context = files
            .iter()
            .take(160)
            .map(|entry| {
                if entry.is_dir {
                    format!("- {}/", entry.path)
                } else {
                    format!("- {}", entry.path)
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let code_matches = db.search_code_index(&canonical, query, None, CODE_MATCH_LIMIT)?;
        let code_context = code_matches
            .iter()
            .map(|item| {
                format!(
                    "[{}:{}-{}] {} {}\n{}",
                    item.file_path,
                    item.start_line,
                    item.end_line,
                    item.kind,
                    item.name,
                    item.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let document_matches = db.search_project_index(
            &canonical,
            Some(DOCUMENT_INDEXER),
            query,
            None,
            DOCUMENT_MATCH_LIMIT,
        )?;
        let document_context = document_matches
            .iter()
            .map(|item| {
                format!(
                    "[{}:{}-{}] {}\n{}",
                    item.file_path, item.start_line, item.end_line, item.title, item.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        sections.push(format!(
            "当前项目根目录：{}\n回答项目问题时必须以此目录和下列检索证据为准，不要编造未提供的实现。引用代码时给出项目相对路径和行号。\n\n项目文件（最多 160 项）：\n{}",
            display_project_path(root),
            if file_context.is_empty() { "（空）" } else { &file_context }
        ));
        if !code_context.is_empty() {
            sections.push(format!("当前问题的代码索引结果：\n{code_context}"));
        }
        if !document_context.is_empty() {
            sections.push(format!("当前问题的文档索引结果：\n{document_context}"));
        }
    } else {
        sections.push(
            "当前是普通临时对话，没有绑定项目目录；不要声称已经读取或修改本地项目。".to_string(),
        );
    }

    Ok(ChatMessage {
        role: "system".to_string(),
        content: sections.join("\n\n"),
    })
}

fn default_app_data_dir() -> AppResult<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|path| path.join(APP_IDENTIFIER))
            .ok_or_else(|| AppError::Message("无法确定 APPDATA 目录".to_string()));
    }
    #[cfg(target_os = "macos")]
    {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .map(|path| {
                path.join("Library")
                    .join("Application Support")
                    .join(APP_IDENTIFIER)
            })
            .ok_or_else(|| AppError::Message("无法确定 HOME 目录".to_string()));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(path) = env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(path).join(APP_IDENTIFIER));
        }
        return env::var_os("HOME")
            .map(PathBuf::from)
            .map(|path| path.join(".local").join("share").join(APP_IDENTIFIER))
            .ok_or_else(|| AppError::Message("无法确定 HOME 目录".to_string()));
    }
}

fn print_banner(model: &ModelConfig, project: Option<&Path>) {
    println!("Nano CLI · {} ({})", model.name, model.model);
    match project {
        Some(path) => println!("项目：{}", display_project_path(path)),
        None => println!("模式：普通临时对话（不保存会话）"),
    }
    println!("输入 /help 查看命令，/exit 退出。\n");
}

fn display_project_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        return path
            .strip_prefix(r"\\?\")
            .unwrap_or(path.as_ref())
            .to_string();
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

fn print_models(models: &[ModelConfig], active: &ModelConfig) {
    for model in models {
        let marker = if model.id == active.id { "*" } else { " " };
        println!(
            "{marker} {} · {} · id={}",
            model.name, model.model, model.id
        );
    }
}

fn print_interactive_help() {
    println!("/help          显示交互命令");
    println!("/clear         清空当前进程内的对话上下文");
    println!("/model         查看可用模型");
    println!("/model <名称>  切换模型（也可使用模型 ID 或模型名）");
    println!("/exit          退出 nano");
}

fn print_help() {
    println!(
        "NanoAgent 终端交互客户端\n\n用法:\n  nano [选项] [问题]\n\n默认行为:\n  在当前目录启动项目问答交互。会话仅保存在当前进程中。\n\n选项:\n  -C, --project <目录>  指定项目目录\n      --temp            启动不绑定项目的普通临时对话\n  -p, --prompt <问题>   单次提问后退出\n  -m, --model <模型>    按名称、模型名或 ID 选择模型\n      --no-index        使用已有项目索引，不在启动时重建\n      --data-dir <目录> 覆盖 NanoAgent 应用数据目录\n  -h, --help            显示帮助\n  -V, --version         显示版本\n\n示例:\n  nano\n  nano --project D:\\workspace\\demo\n  nano --temp\n  nano -p \"这个项目的启动入口在哪里？\"\n  nano --temp -p \"帮我写一个周报提纲\""
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parses_temporary_one_shot_session() {
        let options = parse_args(args(&["--temp", "-p", "hello", "--model", "local"]))
            .expect("options should parse");
        assert_eq!(options.mode, SessionMode::Temporary);
        assert_eq!(options.prompt.as_deref(), Some("hello"));
        assert_eq!(options.model.as_deref(), Some("local"));
    }

    #[test]
    fn parses_explicit_project_session() {
        let options = parse_args(args(&["-C", "D:/workspace/demo", "question"]))
            .expect("options should parse");
        assert_eq!(
            options.mode,
            SessionMode::Project(PathBuf::from("D:/workspace/demo"))
        );
        assert_eq!(options.prompt.as_deref(), Some("question"));
    }

    #[test]
    fn rejects_conflicting_session_modes() {
        let error = parse_args(args(&["--temp", "--project", "."]))
            .expect_err("conflicting modes should fail");
        assert!(error.contains("不能同时使用"));
    }

    #[test]
    fn rebuilds_code_and_document_indexes_for_project_questions() {
        let root = env::temp_dir().join(format!("nano-cli-project-{}", Uuid::new_v4()));
        let source_dir = root.join("src");
        std::fs::create_dir_all(&source_dir).expect("project directory should be created");
        std::fs::write(
            source_dir.join("main.rs"),
            "fn greet_user() -> &'static str { \"hello\" }\n",
        )
        .expect("source should be written");
        std::fs::write(root.join("README.md"), "# Demo\nRun with cargo run.\n")
            .expect("readme should be written");
        let db = Database::open(root.join("nano-test.sqlite3")).expect("database should open");

        rebuild_project_indexes(&db, &root).expect("indexes should rebuild");
        let canonical = root.to_string_lossy().to_string();
        let code = db
            .search_code_index(&canonical, "greet_user", None, 8)
            .expect("code search should work");
        let documents = db
            .search_project_index(&canonical, Some(DOCUMENT_INDEXER), "cargo run", None, 6)
            .expect("document search should work");

        assert!(code.iter().any(|item| item.file_path == "src/main.rs"));
        assert!(documents.iter().any(|item| item.file_path == "README.md"));
        drop(db);
        std::fs::remove_dir_all(root).expect("temporary project should be removed");
    }

    #[test]
    fn temporary_system_message_does_not_bind_a_project() {
        let root = env::temp_dir().join(format!("nano-cli-temp-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temporary directory should be created");
        let db = Database::open(root.join("nano-test.sqlite3")).expect("database should open");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime should build");

        let message = runtime
            .block_on(build_system_message(&db, None, "hello"))
            .expect("system message should build");

        assert!(message.content.contains("普通临时对话"));
        assert!(!message.content.contains("当前项目根目录"));
        drop(db);
        std::fs::remove_dir_all(root).expect("temporary directory should be removed");
    }
}
