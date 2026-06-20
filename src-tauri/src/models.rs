use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone)]
pub enum PatchField<T> {
    Missing,
    Null,
    Value(T),
}

impl<T> Default for PatchField<T> {
    fn default() -> Self {
        Self::Missing
    }
}

impl<'de, T> Deserialize<'de> for PatchField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(|value| match value {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

impl<T> Serialize for PatchField<T>
where
    T: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Missing | Self::Null => serializer.serialize_none(),
            Self::Value(value) => value.serialize(serializer),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub tags: Vec<String>,
    pub reminder_at: Option<DateTime<Utc>>,
    pub repeat_rule: Option<String>,
    pub last_reminded_at: Option<DateTime<Utc>>,
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
    pub reminder_at: Option<DateTime<Utc>>,
    pub repeat_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemPatch {
    pub id: String,
    pub kind: Option<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub reminder_at: PatchField<DateTime<Utc>>,
    #[serde(default)]
    pub repeat_rule: PatchField<String>,
    #[serde(default)]
    pub last_reminded_at: PatchField<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
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
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageDraft {
    pub conversation_id: String,
    pub role: String,
    pub content: String,
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
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
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
