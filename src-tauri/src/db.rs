use std::path::PathBuf;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{
    Conversation, ConversationDraft, Item, ItemDraft, ItemPatch, Memory, MemoryDraft, MemoryPatch,
    Message, MessageDraft, MessageMetadata, ModelConfig, ModelConfigDraft, PatchField,
    RagChunkMatch, RagFile,
};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: PathBuf) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> AppResult<()> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                status TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                reminder_at TEXT,
                repeat_rule TEXT,
                last_reminded_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
                id UNINDEXED,
                title,
                body,
                tags
            );

            CREATE TABLE IF NOT EXISTS model_configs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key TEXT NOT NULL,
                embedding_base_url TEXT NOT NULL DEFAULT '',
                embedding_model TEXT NOT NULL DEFAULT '',
                embedding_api_key TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model_config_id TEXT,
                project_path TEXT,
                archived INTEGER NOT NULL DEFAULT 0,
                archived_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (model_config_id) REFERENCES model_configs(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
                ON messages(conversation_id, created_at);

            CREATE TABLE IF NOT EXISTS rag_files (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                name TEXT NOT NULL,
                mime TEXT NOT NULL,
                size INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                chunk_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS rag_chunks (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                token_count INTEGER NOT NULL,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (file_id) REFERENCES rag_files(id) ON DELETE CASCADE,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS rag_embeddings (
                chunk_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                embedding BLOB NOT NULL,
                dim INTEGER NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
                chunk_id UNINDEXED,
                conversation_id UNINDEXED,
                file_id UNINDEXED,
                file_name,
                text
            );

            CREATE INDEX IF NOT EXISTS idx_rag_files_conversation
                ON rag_files(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_rag_chunks_conversation
                ON rag_chunks(conversation_id, chunk_index);
            CREATE INDEX IF NOT EXISTS idx_rag_embeddings_conversation
                ON rag_embeddings(conversation_id);

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                id UNINDEXED,
                title,
                content,
                tags
            );
            ",
        )?;
        self.ensure_column("conversations", "project_path", "TEXT")?;
        self.ensure_column("conversations", "archived", "INTEGER NOT NULL DEFAULT 0")?;
        self.ensure_column("conversations", "archived_at", "TEXT")?;
        self.ensure_column("items", "reminder_at", "TEXT")?;
        self.ensure_column("items", "repeat_rule", "TEXT")?;
        self.ensure_column("items", "last_reminded_at", "TEXT")?;
        self.ensure_column("messages", "metadata_json", "TEXT")?;
        self.ensure_column(
            "model_configs",
            "embedding_base_url",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        self.ensure_column(
            "model_configs",
            "embedding_model",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        self.ensure_column(
            "model_configs",
            "embedding_api_key",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        Ok(())
    }

    fn ensure_column(&self, table: &str, column: &str, definition: &str) -> AppResult<()> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;

        if !columns.iter().any(|name| name == column) {
            self.conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                [],
            )?;
        }

        Ok(())
    }

    pub fn list_items(&self, kind: Option<&str>) -> AppResult<Vec<Item>> {
        let sql = match kind {
            Some(_) => {
                "SELECT id, kind, title, body, status, tags_json, reminder_at, repeat_rule, last_reminded_at, created_at, updated_at
                 FROM items WHERE kind = ?1 ORDER BY updated_at DESC"
            }
            None => {
                "SELECT id, kind, title, body, status, tags_json, reminder_at, repeat_rule, last_reminded_at, created_at, updated_at
                 FROM items ORDER BY updated_at DESC"
            }
        };

        let mut stmt = self.conn.prepare(sql)?;
        let rows: Result<Vec<_>, _> = match kind {
            Some(kind) => stmt.query_map([kind], Self::row_to_item)?.collect(),
            None => stmt.query_map([], Self::row_to_item)?.collect(),
        };

        rows.map_err(AppError::from)
    }

    pub fn search_items(&self, query: &str) -> AppResult<Vec<Item>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.list_items(None);
        }

        let fts_query = trimmed
            .split_whitespace()
            .map(|part| format!("{}*", part.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" ");

        let mut stmt = self.conn.prepare(
            "
            SELECT i.id, i.kind, i.title, i.body, i.status, i.tags_json, i.reminder_at, i.repeat_rule, i.last_reminded_at, i.created_at, i.updated_at
            FROM items_fts f
            JOIN items i ON i.id = f.id
            WHERE items_fts MATCH ?1
            ORDER BY rank
            LIMIT 100
            ",
        )?;

        let rows = stmt
            .query_map([fts_query], Self::row_to_item)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn create_item(&self, draft: ItemDraft) -> AppResult<Item> {
        let now = Utc::now();
        let item = Item {
            id: Uuid::new_v4().to_string(),
            kind: clean_or_default(draft.kind, "note"),
            title: clean_or_default(draft.title, "未命名"),
            body: draft.body,
            status: draft.status.unwrap_or_else(|| "active".to_string()),
            tags: draft.tags,
            reminder_at: draft.reminder_at,
            repeat_rule: draft.repeat_rule.filter(|value| !value.trim().is_empty()),
            last_reminded_at: None,
            created_at: now,
            updated_at: now,
        };

        self.upsert_item(&item)?;
        Ok(item)
    }

    pub fn update_item(&self, patch: ItemPatch) -> AppResult<Item> {
        let current = self
            .get_item(&patch.id)?
            .ok_or_else(|| AppError::Message("item not found".to_string()))?;

        let item = Item {
            id: current.id,
            kind: patch.kind.unwrap_or(current.kind),
            title: patch.title.unwrap_or(current.title),
            body: patch.body.unwrap_or(current.body),
            status: patch.status.unwrap_or(current.status),
            tags: patch.tags.unwrap_or(current.tags),
            reminder_at: apply_patch_field(patch.reminder_at, current.reminder_at),
            repeat_rule: apply_patch_field(patch.repeat_rule, current.repeat_rule),
            last_reminded_at: apply_patch_field(patch.last_reminded_at, current.last_reminded_at),
            created_at: current.created_at,
            updated_at: Utc::now(),
        };

        self.upsert_item(&item)?;
        Ok(item)
    }

    pub fn delete_item(&self, id: &str) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM items_fts WHERE id = ?1", params![id])?;
        let affected = self
            .conn
            .execute("DELETE FROM items WHERE id = ?1", params![id])?;
        ensure_affected(affected, "item not found")?;
        Ok(())
    }

    pub fn list_model_configs(&self) -> AppResult<Vec<ModelConfig>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, name, provider, base_url, model, api_key,
                   embedding_base_url, embedding_model, embedding_api_key,
                   created_at, updated_at
            FROM model_configs
            ORDER BY updated_at DESC
            ",
        )?;

        let rows = stmt
            .query_map([], Self::row_to_model_config)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn get_model_config(&self, id: &str) -> AppResult<ModelConfig> {
        self.conn
            .query_row(
                "
                SELECT id, name, provider, base_url, model, api_key,
                       embedding_base_url, embedding_model, embedding_api_key,
                       created_at, updated_at
                FROM model_configs WHERE id = ?1
                ",
                params![id],
                Self::row_to_model_config,
            )
            .optional()?
            .ok_or_else(|| AppError::Message("model config not found".to_string()))
    }

    pub fn save_model_config(&self, draft: ModelConfigDraft) -> AppResult<ModelConfig> {
        let now = Utc::now();
        let id = draft.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = self
            .conn
            .query_row(
                "SELECT created_at FROM model_configs WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|value| parse_time(&value))
            .transpose()?
            .unwrap_or(now);

        let config = ModelConfig {
            id,
            name: clean_or_default(draft.name, "默认模型"),
            provider: clean_or_default(draft.provider, "openai-compatible"),
            base_url: clean_or_default(draft.base_url, "https://api.openai.com/v1"),
            model: clean_or_default(draft.model, "gpt-4o-mini"),
            api_key: draft.api_key,
            embedding_base_url: clean_optional_string(draft.embedding_base_url),
            embedding_model: clean_or_default(draft.embedding_model, "text-embedding-3-small"),
            embedding_api_key: clean_optional_string(draft.embedding_api_key),
            created_at,
            updated_at: now,
        };

        self.conn.execute(
            "
            INSERT INTO model_configs
                (id, name, provider, base_url, model, api_key,
                 embedding_base_url, embedding_model, embedding_api_key,
                 created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                provider = excluded.provider,
                base_url = excluded.base_url,
                model = excluded.model,
                api_key = excluded.api_key,
                embedding_base_url = excluded.embedding_base_url,
                embedding_model = excluded.embedding_model,
                embedding_api_key = excluded.embedding_api_key,
                updated_at = excluded.updated_at
            ",
            params![
                config.id,
                config.name,
                config.provider,
                config.base_url,
                config.model,
                config.api_key,
                config.embedding_base_url,
                config.embedding_model,
                config.embedding_api_key,
                config.created_at.to_rfc3339(),
                config.updated_at.to_rfc3339()
            ],
        )?;

        Ok(config)
    }

    pub fn delete_model_config(&self, id: &str) -> AppResult<()> {
        let affected = self
            .conn
            .execute("DELETE FROM model_configs WHERE id = ?1", params![id])?;
        ensure_affected(affected, "model config not found")?;
        Ok(())
    }

    pub fn list_conversations(&self, project_path: Option<&str>) -> AppResult<Vec<Conversation>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, title, model_config_id, project_path, archived, archived_at, created_at, updated_at
            FROM conversations
            WHERE archived = 0
              AND (
                (?1 IS NULL AND project_path IS NULL)
                OR project_path = ?1
              )
            ORDER BY updated_at DESC
            ",
        )?;

        let rows = stmt
            .query_map([project_path], Self::row_to_conversation)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn list_archived_conversations(
        &self,
        project_path: Option<&str>,
    ) -> AppResult<Vec<Conversation>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, title, model_config_id, project_path, archived, archived_at, created_at, updated_at
            FROM conversations
            WHERE archived = 1
              AND (
                (?1 IS NULL AND project_path IS NULL)
                OR project_path = ?1
              )
            ORDER BY COALESCE(archived_at, updated_at) DESC
            ",
        )?;

        let rows = stmt
            .query_map([project_path], Self::row_to_conversation)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn create_conversation(&self, draft: ConversationDraft) -> AppResult<Conversation> {
        let now = Utc::now();
        let conversation = Conversation {
            id: Uuid::new_v4().to_string(),
            title: clean_or_default(draft.title.unwrap_or_default(), "New chat"),
            model_config_id: draft.model_config_id,
            project_path: draft.project_path,
            archived: false,
            archived_at: None,
            created_at: now,
            updated_at: now,
        };

        self.conn.execute(
            "
            INSERT INTO conversations
                (id, title, model_config_id, project_path, archived, archived_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ",
            params![
                conversation.id,
                conversation.title,
                conversation.model_config_id,
                conversation.project_path,
                if conversation.archived { 1 } else { 0 },
                conversation.archived_at.map(|time| time.to_rfc3339()),
                conversation.created_at.to_rfc3339(),
                conversation.updated_at.to_rfc3339()
            ],
        )?;

        Ok(conversation)
    }

    pub fn archive_conversation(&self, id: &str, archived: bool) -> AppResult<()> {
        let now = Utc::now();
        let affected = self.conn.execute(
            "
            UPDATE conversations
            SET archived = ?2,
                archived_at = ?3,
                updated_at = ?4
            WHERE id = ?1
            ",
            params![
                id,
                if archived { 1 } else { 0 },
                if archived {
                    Some(now.to_rfc3339())
                } else {
                    None
                },
                now.to_rfc3339()
            ],
        )?;
        ensure_affected(affected, "conversation not found")?;
        Ok(())
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> AppResult<()> {
        let now = Utc::now();
        let affected = self.conn.execute(
            "
            UPDATE conversations
            SET title = ?2,
                updated_at = ?3
            WHERE id = ?1
            ",
            params![id, title, now.to_rfc3339()],
        )?;
        ensure_affected(affected, "conversation not found")?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> AppResult<()> {
        self.conn.execute(
            "DELETE FROM rag_chunks_fts WHERE conversation_id = ?1",
            params![id],
        )?;
        let affected = self
            .conn
            .execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        ensure_affected(affected, "conversation not found")?;
        Ok(())
    }

    pub fn list_messages(&self, conversation_id: &str) -> AppResult<Vec<Message>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, conversation_id, role, content, metadata_json, created_at
            FROM messages
            WHERE conversation_id = ?1
            ORDER BY created_at ASC
            ",
        )?;

        let rows = stmt
            .query_map([conversation_id], Self::row_to_message)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn append_message(&self, draft: MessageDraft) -> AppResult<Message> {
        let now = Utc::now();
        let message = Message {
            id: Uuid::new_v4().to_string(),
            conversation_id: draft.conversation_id,
            role: clean_or_default(draft.role, "user"),
            content: draft.content,
            metadata: draft.metadata,
            created_at: now,
        };

        self.conn.execute(
            "
            INSERT INTO messages (id, conversation_id, role, content, metadata_json, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                message.id,
                message.conversation_id,
                message.role,
                message.content,
                serialize_metadata(&message.metadata)?,
                message.created_at.to_rfc3339()
            ],
        )?;

        self.archive_conversation(&message.conversation_id, false)?;

        let title = message
            .content
            .chars()
            .take(30)
            .collect::<String>()
            .trim()
            .to_string();
        if message.role == "user" && !title.is_empty() {
            self.conn.execute(
                "
                UPDATE conversations
                SET title = CASE WHEN title = 'New chat' THEN ?2 ELSE title END,
                    updated_at = ?3
                WHERE id = ?1
                ",
                params![message.conversation_id, title, now.to_rfc3339()],
            )?;
        } else {
            self.conn.execute(
                "UPDATE conversations SET updated_at = ?2 WHERE id = ?1",
                params![message.conversation_id, now.to_rfc3339()],
            )?;
        }

        Ok(message)
    }

    pub fn delete_messages(&self, ids: &[String]) -> AppResult<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!("DELETE FROM messages WHERE id IN ({})", placeholders);
        let mut stmt = self.conn.prepare(&query)?;
        let params = rusqlite::params_from_iter(ids);
        let affected = stmt.execute(params)?;
        if affected != ids.len() {
            return Err(AppError::Message("message not found".to_string()));
        }
        Ok(())
    }

    pub fn list_rag_files(&self, conversation_id: &str) -> AppResult<Vec<RagFile>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, conversation_id, name, mime, size, content_hash, chunk_count,
                   status, error, created_at
            FROM rag_files
            WHERE conversation_id = ?1
            ORDER BY created_at DESC
            ",
        )?;

        let rows = stmt
            .query_map([conversation_id], row_to_rag_file)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn get_rag_file(&self, id: &str) -> AppResult<RagFile> {
        self.conn
            .query_row(
                "
                SELECT id, conversation_id, name, mime, size, content_hash, chunk_count,
                       status, error, created_at
                FROM rag_files
                WHERE id = ?1
                ",
                params![id],
                row_to_rag_file,
            )
            .map_err(AppError::from)
    }

    pub fn delete_rag_file(&self, id: &str) -> AppResult<()> {
        let file = self.get_rag_file(id)?;
        self.conn
            .execute("DELETE FROM rag_chunks_fts WHERE file_id = ?1", params![id])?;
        let affected = self
            .conn
            .execute("DELETE FROM rag_files WHERE id = ?1", params![id])?;
        ensure_affected(affected, "rag file not found")?;
        let _ = file;
        Ok(())
    }

    pub fn replace_rag_file(
        &self,
        conversation_id: &str,
        name: &str,
        mime: &str,
        size: i64,
        content_hash: &str,
        chunks: &[String],
        embeddings: &[Vec<f32>],
        embedding_model: &str,
    ) -> AppResult<RagFile> {
        if chunks.is_empty() {
            return Err(AppError::Message("文件没有可索引文本".to_string()));
        }
        if chunks.len() != embeddings.len() {
            return Err(AppError::Message(
                "chunk 与 embedding 数量不一致".to_string(),
            ));
        }

        let existing_id: Option<String> = self
            .conn
            .query_row(
                "
                SELECT id FROM rag_files
                WHERE conversation_id = ?1 AND content_hash = ?2
                ",
                params![conversation_id, content_hash],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(existing_id) = existing_id {
            self.delete_rag_file(&existing_id)?;
        }

        let now = Utc::now();
        let file = RagFile {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            name: clean_or_default(name.to_string(), "uploaded.txt"),
            mime: clean_optional_string(mime.to_string()),
            size,
            content_hash: content_hash.to_string(),
            chunk_count: chunks.len() as i64,
            status: "ready".to_string(),
            error: None,
            created_at: now,
        };

        self.conn.execute(
            "
            INSERT INTO rag_files
                (id, conversation_id, name, mime, size, content_hash, chunk_count,
                 status, error, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ",
            params![
                file.id,
                file.conversation_id,
                file.name,
                file.mime,
                file.size,
                file.content_hash,
                file.chunk_count,
                file.status,
                file.error,
                file.created_at.to_rfc3339()
            ],
        )?;

        for (index, (text, embedding)) in chunks.iter().zip(embeddings.iter()).enumerate() {
            let chunk_id = Uuid::new_v4().to_string();
            self.conn.execute(
                "
                INSERT INTO rag_chunks
                    (id, file_id, conversation_id, chunk_index, text, token_count,
                     metadata_json, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    chunk_id,
                    file.id,
                    file.conversation_id,
                    index as i64,
                    text,
                    estimate_token_count(text),
                    serde_json::json!({ "file_name": file.name }).to_string(),
                    now.to_rfc3339()
                ],
            )?;
            self.conn.execute(
                "
                INSERT INTO rag_embeddings
                    (chunk_id, conversation_id, embedding, dim, model, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ",
                params![
                    chunk_id,
                    file.conversation_id,
                    encode_embedding(embedding),
                    embedding.len() as i64,
                    embedding_model,
                    now.to_rfc3339()
                ],
            )?;
            self.conn.execute(
                "
                INSERT INTO rag_chunks_fts
                    (chunk_id, conversation_id, file_id, file_name, text)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![chunk_id, file.conversation_id, file.id, file.name, text],
            )?;
        }

        Ok(file)
    }

    pub fn search_rag_chunks(
        &self,
        conversation_id: &str,
        query_embedding: &[f32],
        limit: i64,
    ) -> AppResult<Vec<RagChunkMatch>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT chunks.id, chunks.file_id, files.name, chunks.chunk_index, chunks.text,
                   embeddings.embedding
            FROM rag_chunks chunks
            JOIN rag_files files ON files.id = chunks.file_id
            JOIN rag_embeddings embeddings ON embeddings.chunk_id = chunks.id
            WHERE chunks.conversation_id = ?1
            ",
        )?;

        let mut rows = stmt.query(params![conversation_id])?;
        let mut matches = Vec::new();
        while let Some(row) = rows.next()? {
            let embedding_blob: Vec<u8> = row.get(5)?;
            let embedding = decode_embedding(&embedding_blob)?;
            let score = cosine_similarity(query_embedding, &embedding);
            matches.push(RagChunkMatch {
                chunk_id: row.get(0)?,
                file_id: row.get(1)?,
                file_name: row.get(2)?,
                chunk_index: row.get(3)?,
                text: row.get(4)?,
                score,
            });
        }

        matches.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        matches.truncate(limit.clamp(1, 20) as usize);
        Ok(matches)
    }

    pub fn list_memories(&self) -> AppResult<Vec<Memory>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, title, content, tags_json, enabled, created_at, updated_at
            FROM memories
            ORDER BY enabled DESC, updated_at DESC
            ",
        )?;

        let rows = stmt
            .query_map([], Self::row_to_memory)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn list_enabled_memories(&self) -> AppResult<Vec<Memory>> {
        let mut stmt = self.conn.prepare(
            "
            SELECT id, title, content, tags_json, enabled, created_at, updated_at
            FROM memories
            WHERE enabled = 1
            ORDER BY updated_at DESC
            LIMIT 30
            ",
        )?;

        let rows = stmt
            .query_map([], Self::row_to_memory)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn search_memories(&self, query: &str) -> AppResult<Vec<Memory>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.list_memories();
        }

        let fts_query = trimmed
            .split_whitespace()
            .map(|part| format!("{}*", part.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" ");

        let mut stmt = self.conn.prepare(
            "
            SELECT m.id, m.title, m.content, m.tags_json, m.enabled, m.created_at, m.updated_at
            FROM memories_fts f
            JOIN memories m ON m.id = f.id
            WHERE memories_fts MATCH ?1
            ORDER BY rank
            LIMIT 100
            ",
        )?;

        let rows = stmt
            .query_map([fts_query], Self::row_to_memory)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;

        Ok(rows)
    }

    pub fn create_memory(&self, draft: MemoryDraft) -> AppResult<Memory> {
        let now = Utc::now();
        let memory = Memory {
            id: Uuid::new_v4().to_string(),
            title: clean_or_default(draft.title, "New memory"),
            content: draft.content,
            tags: draft.tags,
            enabled: draft.enabled.unwrap_or(true),
            created_at: now,
            updated_at: now,
        };

        self.upsert_memory(&memory)?;
        Ok(memory)
    }

    pub fn update_memory(&self, patch: MemoryPatch) -> AppResult<Memory> {
        let current = self
            .get_memory(&patch.id)?
            .ok_or_else(|| AppError::Message("memory not found".to_string()))?;

        let memory = Memory {
            id: current.id,
            title: patch.title.unwrap_or(current.title),
            content: patch.content.unwrap_or(current.content),
            tags: patch.tags.unwrap_or(current.tags),
            enabled: patch.enabled.unwrap_or(current.enabled),
            created_at: current.created_at,
            updated_at: Utc::now(),
        };

        self.upsert_memory(&memory)?;
        Ok(memory)
    }

    pub fn delete_memory(&self, id: &str) -> AppResult<()> {
        self.conn
            .execute("DELETE FROM memories_fts WHERE id = ?1", params![id])?;
        let affected = self
            .conn
            .execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        ensure_affected(affected, "memory not found")?;
        Ok(())
    }

    fn get_item(&self, id: &str) -> AppResult<Option<Item>> {
        self.conn
            .query_row(
                "
                SELECT id, kind, title, body, status, tags_json, reminder_at, repeat_rule, last_reminded_at, created_at, updated_at
                FROM items WHERE id = ?1
                ",
                params![id],
                Self::row_to_item,
            )
            .optional()
            .map_err(AppError::from)
    }

    fn get_memory(&self, id: &str) -> AppResult<Option<Memory>> {
        self.conn
            .query_row(
                "
                SELECT id, title, content, tags_json, enabled, created_at, updated_at
                FROM memories WHERE id = ?1
                ",
                params![id],
                Self::row_to_memory,
            )
            .optional()
            .map_err(AppError::from)
    }

    fn upsert_item(&self, item: &Item) -> AppResult<()> {
        let tags_json = serde_json::to_string(&item.tags)?;
        self.conn.execute(
            "
            INSERT INTO items (id, kind, title, body, status, tags_json, reminder_at, repeat_rule, last_reminded_at, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                title = excluded.title,
                body = excluded.body,
                status = excluded.status,
                tags_json = excluded.tags_json,
                reminder_at = excluded.reminder_at,
                repeat_rule = excluded.repeat_rule,
                last_reminded_at = excluded.last_reminded_at,
                updated_at = excluded.updated_at
            ",
            params![
                item.id,
                item.kind,
                item.title,
                item.body,
                item.status,
                tags_json,
                item.reminder_at.as_ref().map(|time| time.to_rfc3339()),
                item.repeat_rule.as_deref(),
                item.last_reminded_at.as_ref().map(|time| time.to_rfc3339()),
                item.created_at.to_rfc3339(),
                item.updated_at.to_rfc3339()
            ],
        )?;

        self.conn
            .execute("DELETE FROM items_fts WHERE id = ?1", params![item.id])?;
        self.conn.execute(
            "INSERT INTO items_fts (id, title, body, tags) VALUES (?1, ?2, ?3, ?4)",
            params![item.id, item.title, item.body, item.tags.join(" ")],
        )?;
        Ok(())
    }

    fn upsert_memory(&self, memory: &Memory) -> AppResult<()> {
        let tags_json = serde_json::to_string(&memory.tags)?;
        self.conn.execute(
            "
            INSERT INTO memories (id, title, content, tags_json, enabled, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                tags_json = excluded.tags_json,
                enabled = excluded.enabled,
                updated_at = excluded.updated_at
            ",
            params![
                memory.id,
                memory.title,
                memory.content,
                tags_json,
                if memory.enabled { 1 } else { 0 },
                memory.created_at.to_rfc3339(),
                memory.updated_at.to_rfc3339()
            ],
        )?;

        self.conn
            .execute("DELETE FROM memories_fts WHERE id = ?1", params![memory.id])?;
        self.conn.execute(
            "INSERT INTO memories_fts (id, title, content, tags) VALUES (?1, ?2, ?3, ?4)",
            params![
                memory.id,
                memory.title,
                memory.content,
                memory.tags.join(" ")
            ],
        )?;
        Ok(())
    }

    fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<Item> {
        let tags_json: String = row.get(5)?;
        let reminder_at: Option<String> = row.get(6)?;
        let repeat_rule: Option<String> = row.get(7)?;
        let last_reminded_at: Option<String> = row.get(8)?;
        let created_at: String = row.get(9)?;
        let updated_at: String = row.get(10)?;

        Ok(Item {
            id: row.get(0)?,
            kind: row.get(1)?,
            title: row.get(2)?,
            body: row.get(3)?,
            status: row.get(4)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            reminder_at: reminder_at
                .map(|value| parse_time_for_row(&value))
                .transpose()?,
            repeat_rule,
            last_reminded_at: last_reminded_at
                .map(|value| parse_time_for_row(&value))
                .transpose()?,
            created_at: parse_time_for_row(&created_at)?,
            updated_at: parse_time_for_row(&updated_at)?,
        })
    }

    fn row_to_model_config(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelConfig> {
        let created_at: String = row.get(9)?;
        let updated_at: String = row.get(10)?;

        Ok(ModelConfig {
            id: row.get(0)?,
            name: row.get(1)?,
            provider: row.get(2)?,
            base_url: row.get(3)?,
            model: row.get(4)?,
            api_key: row.get(5)?,
            embedding_base_url: row.get(6)?,
            embedding_model: row.get(7)?,
            embedding_api_key: row.get(8)?,
            created_at: parse_time_for_row(&created_at)?,
            updated_at: parse_time_for_row(&updated_at)?,
        })
    }

    fn row_to_conversation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Conversation> {
        let archived: i64 = row.get(4)?;
        let archived_at: Option<String> = row.get(5)?;
        let created_at: String = row.get(6)?;
        let updated_at: String = row.get(7)?;

        Ok(Conversation {
            id: row.get(0)?,
            title: row.get(1)?,
            model_config_id: row.get(2)?,
            project_path: row.get(3)?,
            archived: archived == 1,
            archived_at: archived_at
                .map(|value| parse_time_for_row(&value))
                .transpose()?,
            created_at: parse_time_for_row(&created_at)?,
            updated_at: parse_time_for_row(&updated_at)?,
        })
    }

    fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<Message> {
        let metadata_json: Option<String> = row.get(4)?;
        let created_at: String = row.get(5)?;

        Ok(Message {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            metadata: deserialize_metadata(metadata_json),
            created_at: parse_time_for_row(&created_at)?,
        })
    }

    fn row_to_memory(row: &rusqlite::Row<'_>) -> rusqlite::Result<Memory> {
        let tags_json: String = row.get(3)?;
        let enabled: i64 = row.get(4)?;
        let created_at: String = row.get(5)?;
        let updated_at: String = row.get(6)?;

        Ok(Memory {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            enabled: enabled == 1,
            created_at: parse_time_for_row(&created_at)?,
            updated_at: parse_time_for_row(&updated_at)?,
        })
    }
}

fn parse_time(value: &str) -> AppResult<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(value)?.with_timezone(&Utc))
}

fn parse_time_for_row(value: &str) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc))
        .map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
        })
}

fn clean_or_default(value: String, default: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        default.to_string()
    } else {
        trimmed.to_string()
    }
}

fn clean_optional_string(value: String) -> String {
    value.trim().to_string()
}

fn row_to_rag_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<RagFile> {
    let created_at: String = row.get(9)?;
    Ok(RagFile {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        name: row.get(2)?,
        mime: row.get(3)?,
        size: row.get(4)?,
        content_hash: row.get(5)?,
        chunk_count: row.get(6)?,
        status: row.get(7)?,
        error: row.get(8)?,
        created_at: parse_time_for_row(&created_at)?,
    })
}

fn estimate_token_count(text: &str) -> i64 {
    let chinese_chars = text
        .chars()
        .filter(|ch| ('\u{4e00}'..='\u{9fff}').contains(ch))
        .count();
    let non_chinese = text
        .chars()
        .map(|ch| {
            if ('\u{4e00}'..='\u{9fff}').contains(&ch) {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>();
    let words = non_chinese.split_whitespace().count();
    chinese_chars as i64 + ((words as f64) * 1.3).ceil() as i64
}

fn encode_embedding(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect::<Vec<_>>()
}

fn decode_embedding(bytes: &[u8]) -> AppResult<Vec<f32>> {
    if bytes.len() % 4 != 0 {
        return Err(AppError::Message("invalid embedding blob".to_string()));
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.is_empty() || left.len() != right.len() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut left_norm = 0.0f32;
    let mut right_norm = 0.0f32;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }

    if left_norm == 0.0 || right_norm == 0.0 {
        0.0
    } else {
        dot / (left_norm.sqrt() * right_norm.sqrt())
    }
}

fn apply_patch_field<T>(field: PatchField<T>, current: Option<T>) -> Option<T> {
    match field {
        PatchField::Missing => current,
        PatchField::Null => None,
        PatchField::Value(value) => Some(value),
    }
}

fn serialize_metadata(metadata: &Option<MessageMetadata>) -> AppResult<Option<String>> {
    metadata
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(AppError::from)
}

fn deserialize_metadata(metadata_json: Option<String>) -> Option<MessageMetadata> {
    metadata_json.and_then(|json| serde_json::from_str(&json).ok())
}

fn ensure_affected(affected: usize, message: &str) -> AppResult<()> {
    if affected == 0 {
        return Err(AppError::Message(message.to_string()));
    }
    Ok(())
}
