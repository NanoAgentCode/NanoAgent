# 数据与存储设计

## 1. 数据目录

运行时文件保存在 Tauri app data 目录。后端启动时会创建目录，并打开以下文件：

```text
nano-agent.sqlite3
nano-agent-runtime.sqlite3
nano-agent-observability.sqlite3
settings.json
skills/
temp/
```

所有 SQLite 连接启用 WAL，以提升桌面场景下的写入可靠性和读写体验。

## 2. 主业务库

主业务库文件：`nano-agent.sqlite3`。

### 2.1 items

用于本地笔记、备忘录、提示词等工作区条目。

核心字段：

- `id`
- `kind`
- `title`
- `body`
- `status`
- `tags_json`
- `created_at`
- `updated_at`

配套 `items_fts` 支持 title、body、tags 全文检索。

### 2.2 model_configs

保存聊天模型和 embedding 模型配置。

核心字段：

- `provider`
- `base_url`
- `model`
- `api_key`
- `embedding_provider`
- `embedding_base_url`
- `embedding_model`
- `embedding_api_key`

约定：

- 聊天模型可以保存多组。
- embedding 使用特殊配置或回退到聊天配置。
- Ollama 等本地服务可以不填 API key。

### 2.3 mcp_servers

保存 MCP server 配置。

核心字段：

- `transport`：`stdio`、`sse`、`streamable_http`
- `command`、`args_json`、`env_json`、`working_dir`
- `url`、`headers_json`
- `enabled`

运行中的 MCP session 不落主库，只存在 `McpClientManager` 内存状态中。

### 2.4 conversations 与 messages

`conversations` 保存会话：

- `model_config_id`：会话绑定模型，可为空。
- `project_path`：项目会话的真实项目路径；普通会话为空。
- `archived`、`archived_at`：归档状态。

`messages` 保存消息：

- `conversation_id`
- `role`
- `content`
- `metadata_json`
- `created_at`

删除会话会级联删除消息、RAG 文件和 chunk。

### 2.5 RAG 表

RAG 使用四类结构：

- `rag_files`：文件元数据、hash、chunk 数、状态。
- `rag_chunks`：文本分块。
- `rag_embeddings`：chunk embedding 二进制向量、维度、模型名。
- `rag_chunks_fts`：chunk 全文检索。

RAG 数据以 `conversation_id` 隔离。当前实现是对话级轻量 RAG，不是全局知识库。

### 2.6 memories

长期记忆表：

- `title`
- `content`
- `tags_json`
- `enabled`

配套 `memories_fts` 支持搜索。发送对话时仅注入启用的记忆。

## 3. 运行时库

运行时库文件：`nano-agent-runtime.sqlite3`。

### 3.1 agent_runs

记录一次用户消息触发的 Agent 流程：

- `conversation_id`
- `project_path`
- `model_config_id`
- `trigger_message_id`
- `status`
- `error`
- `created_at`、`updated_at`、`completed_at`

### 3.2 agent_steps

记录流程阶段，例如用户消息、模型调用、工具执行、续写、错误：

- `run_id`
- `kind`
- `status`
- `input_summary`
- `output_summary`
- `metadata_json`

### 3.3 agent_tool_calls

记录模型请求执行的工具：

- `run_id`
- `message_id`
- `name`
- `args_json`
- `status`
- `result_summary`
- `error`

工具调用状态服务于 UI 展示、用户审批、执行结果回放和故障排查。

## 4. 观测库

观测库文件：`nano-agent-observability.sqlite3`。

`observability_spans` 字段：

- `id`
- `trace_id`
- `parent_span_id`
- `operation`
- `category`
- `entity_type`
- `entity_id`
- `status`
- `started_at`
- `ended_at`
- `duration_ms`
- `input_summary`
- `output_summary`
- `error`
- `metadata_json`

索引：

- `trace_id, started_at`
- `operation, started_at`
- `status, started_at`

设计原则：

- 观测数据独立于主业务数据。
- sink 失败不阻断业务。
- 默认查询限制为 200，后端 clamp 到 1 到 1000。

## 5. 迁移策略

当前主库采用 `CREATE TABLE IF NOT EXISTS` 加 `ensure_column` 的轻量迁移方式。

适用场景：

- 小型桌面应用。
- 新增可空字段或带默认值字段。
- 低频 schema 演化。

不适合场景：

- 字段类型重构。
- 大规模数据迁移。
- 复杂索引重建。

后续如果 schema 演化频繁，应引入版本表和显式 migration。

## 6. 文件边界

项目文件 API 以 `project_path` 作为根目录，所有相对路径需要归一化后解析，避免 `..` 或绝对路径越界。删除文件要求传入确认文本，降低误删风险。

`read_absolute_file` 用于 RAG 文档导入，读取普通文件、PDF、doc、docx、pptx、xlsx 等格式，最大 10MB。项目内普通文本读取限制更低，避免把大型文件直接塞进对话上下文。

