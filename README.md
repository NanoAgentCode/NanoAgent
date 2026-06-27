# NanoAgent

NanoAgent 是一个本地优先的桌面 AI 工作台，使用 Tauri v2、Rust、React 和 TypeScript 构建。它把对话、项目文件、轻量 RAG、长期记忆、Skills、MCP 工具和运行时观测集中在一个桌面客户端里，业务数据默认保存在本机 SQLite 中。

## 核心能力

- 本地笔记、备忘录、提示词和长期记忆管理，支持 SQLite FTS5 全文检索。
- 持久化 AI 对话，支持归档、恢复、删除、项目作用域隔离和会话级模型选择。
- OpenAI-compatible `/chat/completions`、OpenAI-compatible embeddings 和 Anthropic Messages API。
- 流式回复与 reasoning/thinking 片段展示。
- 轻量 RAG：拖拽文件、抽取文本、分块、生成 embedding，并在对话时召回相关片段。
- 项目工作区：创建项目目录、浏览文件树、读写/重命名/删除项目文件、执行项目命令。
- Agent 运行时：记录 run、step、tool call，支持用户审批后执行文件读取、文件写入、命令和 MCP 工具调用。
- MCP 管理：支持 stdio、SSE、streamable HTTP 传输，连接后把工具注入模型上下文。
- Skills 管理：同步 Anthropic Skills，维护本地 Skills 目录，并在系统提示中注入启用技能。
- 独立观测链路：LLM、MCP、部分工具/数据库操作写入独立 `nano-agent-observability.sqlite3`，可在设置中查看和清理。
- 深色、浅色、跟随系统主题，以及系统托盘最小化。

## 文档

- [系统设计文档](docs/系统设计文档.md)：整体架构、模块边界和主要业务链路。
- [架构与模块设计](docs/architecture.md)：前端、Tauri command、Rust 后端模块分层。
- [数据与存储设计](docs/data-design.md)：三份 SQLite 数据库、核心表、检索和文件边界。
- [Agent、RAG、MCP 与 Skills](docs/agent-runtime.md)：模型上下文组装、工具审批执行、RAG 和外部工具扩展。
- [构建、配置与运维](docs/operations.md)：本地开发、打包、数据位置、观测和安全约束。

## 技术栈

- 桌面壳：Tauri v2
- 后端：Rust、Tokio、rusqlite、reqwest
- 前端：React 18、TypeScript、Vite
- 数据库：SQLite + WAL + FTS5
- 模型：OpenAI-compatible Chat/Embeddings、Anthropic Messages API
- 扩展：MCP、Skills、本地 Agent 工具

## 开发环境

Windows 推荐准备：

- Node.js
- Rust 工具链
- Microsoft C++ Build Tools
- WebView2 Runtime

安装依赖：

```bash
npm.cmd install
```

开发运行：

```bash
npm.cmd run tauri dev
```

前端单独调试：

```bash
npm.cmd run dev
```

类型检查和前端构建：

```bash
npm.cmd run build
```

Windows 打包：

```bash
npm.cmd run package:win
```

`package:win` 会调用 `scripts/build-installer.ps1`，加载 Visual Studio x64 构建环境，修正 Windows 下 Git `link.exe` 抢占 MSVC `link.exe` 的 PATH 问题，然后执行 `tauri build`。构建产物包括 `src-tauri/target/release/nano-agent.exe`、NSIS 安装包和 MSI 安装包。

## 模型配置

应用支持保存多组模型配置，并在对话输入区或会话中切换当前模型。常见配置：

- OpenAI：`https://api.openai.com/v1`
- OpenRouter：`https://openrouter.ai/api/v1`
- Ollama：`http://localhost:11434/v1`
- Anthropic：`https://api.anthropic.com`

Ollama 等本地服务通常可以不填写 API key。轻量 RAG 使用全局唯一的 embedding 配置，未单独填写 embedding base URL、model 或 key 时，会回退到当前模型配置。

## 数据位置

运行时数据保存在 Tauri 应用数据目录下：

```text
nano-agent.sqlite3                 主业务数据
nano-agent-runtime.sqlite3         Agent 运行时数据
nano-agent-observability.sqlite3   观测数据
settings.json                      Tavily 等轻量应用设置
skills/                            本地 Skills 目录
temp/                              无项目上下文时的临时工作目录
```

数据库、构建产物和依赖目录不应提交到仓库。

## 项目结构

```text
src/                         React + TypeScript 前端
src/api.ts                   Tauri command 调用封装
src/hooks/                   对话、模型、项目、RAG、MCP、Skills 等状态逻辑
src/components/              聊天区、侧栏、设置页、观测面板等 UI
src/lib/                     系统提示、工具解析、格式化和安全封装
src-tauri/src/lib.rs         Tauri command 注册、应用状态和启动流程
src-tauri/src/db.rs          主业务 SQLite 数据访问
src-tauri/src/runtime.rs     Agent run/step/tool call 运行时存储
src-tauri/src/observability.rs 观测 sink/pipeline 与观测库
src-tauri/src/llm.rs         Chat、streaming 和 embeddings 请求
src-tauri/src/mcp.rs         MCP client manager 与传输实现
src-tauri/src/agent_runner.rs Agent 工具定义与 tool_call 解析
scripts/build-installer.ps1  Windows 打包脚本
docs/                        系统设计与运维文档
```

## 设计原则

- 本地优先：对话、记忆、项目元数据和运行时记录默认保存在本机。
- 数据隔离：业务数据、Agent 运行时、观测数据分库保存，降低互相影响。
- 用户审批：高风险工具调用必须先形成可见的 tool call，再由用户确认执行。
- 可扩展：模型、MCP、Skills、观测 sink 均保留扩展边界。
- 非阻塞观测：观测写入失败只记录错误，不阻断主业务流程。
