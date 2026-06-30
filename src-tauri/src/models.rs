use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDraft {
    pub kind: String,
    pub title: String,
    pub body: String,
    pub status: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemPatch {
    pub id: String,
    pub kind: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub embedding_provider: String,
    pub embedding_base_url: String,
    pub embedding_model: String,
    pub embedding_api_key: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfigDraft {
    pub id: Option<String>,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    #[serde(default)]
    pub embedding_provider: String,
    #[serde(default)]
    pub embedding_base_url: String,
    #[serde(default)]
    pub embedding_model: String,
    #[serde(default)]
    pub embedding_api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub command: String,
    pub args_json: String,
    pub env_json: String,
    pub url: String,
    pub headers_json: String,
    pub working_dir: String,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerDraft {
    pub id: Option<String>,
    pub name: String,
    #[serde(default = "default_mcp_transport")]
    pub transport: String,
    pub command: String,
    #[serde(default)]
    pub args_json: String,
    #[serde(default)]
    pub env_json: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers_json: String,
    #[serde(default)]
    pub working_dir: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsServer {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_method: String,
    pub key_path: String,
    pub password: String,
    pub remote_dir: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsServerDraft {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: Option<i64>,
    pub username: String,
    #[serde(default = "default_ops_auth_method")]
    pub auth_method: String,
    #[serde(default)]
    pub key_path: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub remote_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsUploadRequest {
    pub server_id: String,
    pub local_path: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpsAiRequest {
    pub server_id: String,
    pub model_config_id: String,
    pub prompt: String,
    pub last_ssh_output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model_config_id: Option<String>,
    pub project_path: Option<String>,
    pub archived: bool,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationDraft {
    pub title: Option<String>,
    pub model_config_id: Option<String>,
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub metadata: Option<MessageMetadata>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageDraft {
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub metadata: Option<MessageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryDraft {
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryPatch {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model_config_id: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub trace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStreamRequest {
    pub request_id: String,
    pub model_config_id: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub trace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStreamEvent {
    Delta { request_id: String, content: String },
    ReasoningDelta { request_id: String, content: String },
    Done { request_id: String },
    Error { request_id: String, message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageMetadata {
    pub web_search: Option<MessageWebSearchMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageWebSearchMetadata {
    pub engine: String,
    pub used_fallback: bool,
    pub fallback_reason: Option<String>,
    pub result_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagFile {
    pub id: String,
    pub conversation_id: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub content_hash: String,
    pub chunk_count: i64,
    pub status: String,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagFileDraft {
    pub conversation_id: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
    pub content: String,
    pub model_config_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagChunkMatch {
    pub file_id: String,
    pub file_name: String,
    pub chunk_id: String,
    pub chunk_index: i64,
    pub text: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFileContent {
    pub path: String,
    pub content: String,
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFileWriteRequest {
    pub project_path: String,
    pub relative_path: String,
    pub content: String,
    pub expected_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFileMoveRequest {
    pub project_path: String,
    pub from_relative_path: String,
    pub to_relative_path: String,
    pub approval_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatImageAttachmentRequest {
    pub project_path: String,
    pub file_name: String,
    pub content_base64: Option<String>,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatImageAttachment {
    pub name: String,
    pub relative_path: String,
    pub size: u64,
}

fn default_true() -> bool {
    true
}

fn default_mcp_transport() -> String {
    "stdio".to_string()
}

fn default_ops_auth_method() -> String {
    "key".to_string()
}
