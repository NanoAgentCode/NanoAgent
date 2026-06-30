# 架构与模块设计

## 1. 前端分层

前端入口是 `src/App.tsx`，它组合全局状态、布局和弹窗。具体业务逻辑主要下沉到 hooks：

- `useChat`：发送消息、流式事件、上下文压缩、RAG 召回、Agent run、工具执行续写。
- `useConversations`：普通会话、项目会话、归档会话、会话模型绑定。
- `useModel`：模型配置、连接测试、当前模型、embedding 配置。
- `useProjects`：项目列表、项目目录创建、项目会话映射。
- `useRagFiles`：RAG 文件列表、索引状态、召回。
- `useMcp`：MCP server 配置、连接、断开、工具刷新。
- `useSkills`：Skills 同步、本地 Skills、启用状态和临时目录。
- `useWorkspace`、`useMemory`：本地条目和长期记忆管理。
- `useObservability`：观测 span 拉取、trace 分组、展开状态。

`src/api.ts` 是前端唯一的后端调用封装层。组件不直接写 `invoke`，而是调用这里的函数，以保持 command 名称、参数和类型集中管理。

## 2. 后端分层

Rust 后端由 `src-tauri/src/lib.rs` 装配：

- 初始化 Tauri plugin、系统托盘和 app data 目录。
- 打开三份 SQLite 数据库。
- 创建 `AppState`，包含 `Database`、`RuntimeStore`、`ObservabilityPipeline` 和 `McpClientManager`。
- 注册所有 Tauri command。

后端模块边界：

| 模块 | 职责 |
| --- | --- |
| `db.rs` | 主业务数据读写、FTS、RAG、memory、conversation 等 |
| `runtime.rs` | Agent run/step/tool_call 持久化 |
| `observability.rs` | span 数据结构、sink trait、SQLite sink |
| `llm.rs` | 模型请求、流式事件解析、embedding |
| `mcp.rs` | MCP 连接、工具列表、工具调用 |
| `agent_runner.rs` | 工具定义、tool_call XML 解析、参数校验 |
| `skills.rs` | GitHub Skills 同步和本地 Skills 列表 |
| `models.rs` | 前后端共享的序列化模型 |
| `error.rs` | 统一错误类型 |

## 3. Command 设计

Tauri command 按领域分组：

- 本地条目：`list_items`、`search_items`、`create_item`、`update_item`、`delete_item`
- 模型配置：`list_model_configs`、`save_model_config`、`test_llm_connectivity`
- MCP：`list_mcp_servers`、`connect_mcp_server`、`call_mcp_tool`
- 对话：`list_conversations`、`append_message`、`archive_conversation`
- RAG：`index_rag_file`、`search_rag_context`
- 记忆：`list_memories`、`search_memories`、`create_memory`
- Skills：`sync_anthropic_skills`、`list_local_skills`
- 模型调用：`chat`、`chat_stream`
- Agent 运行时：`create_agent_run`、`record_agent_step`、`execute_agent_tool_call`
- 项目文件与附件：`list_project_files`、`read_project_file`、`write_project_file`、`save_chat_image_attachment`
- 观测：`list_observability_spans`、`clear_observability_spans`
- 系统窗口：`minimize_to_tray`、`show_app_window`、`quit_app`

## 4. 状态与并发模型

`AppState` 中的 Rust 状态使用 `tokio::sync::Mutex` 包裹：

- `db`：主业务 SQLite connection。
- `runtime`：运行时 SQLite connection。
- `observability`：观测 pipeline。
- `mcp`：MCP client manager，持有活动 session。

这种设计简单可靠，适合桌面单用户应用。代价是同一类资源的并发访问会串行化。当前业务场景中，数据库和 MCP 操作主要来自 UI 交互，串行化可以降低 SQLite connection 和外部进程状态复杂度。

## 5. 前后端事件

模型流式输出不通过 command 返回完整字符串，而是：

1. 前端生成 `request_id`。
2. 调用 `chat_stream`。
3. Rust 后端向 Tauri event `chat-stream` 发送事件。
4. 前端用 `listen<ChatStreamEvent>` 过滤当前 `request_id`。

事件类型包括：

- `delta`：普通内容增量。
- `reasoning_delta`：reasoning/thinking 增量。
- `error`：流式请求错误。
- `done`：流式结束。

## 6. 页面结构

主界面由以下部分组成：

- 侧栏：普通会话、项目、项目会话、入口按钮。
- 聊天区：消息列表、运行时面板、RAG 文件条、图片附件入口、模型选择、输入框。
- 工作区：笔记、备忘录、提示词、记忆等本地对象管理。
- 设置弹窗：主题、记忆、模型、embedding、归档、观测、Skills、MCP、环境。
- 模态框：新建项目、移除项目确认、环境安装提示、窗口关闭策略。

## 7. 依赖方向

推荐依赖方向：

```text
components -> hooks -> api -> tauri commands -> backend modules
```

避免让组件直接接触复杂 command 参数，避免让后端依赖前端展示概念。项目路径、会话 ID、模型 ID、tool call ID 这些跨层标识应保持显式传递。

