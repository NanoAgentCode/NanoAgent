# NanoAgent

NanoAgent 是一个本地优先的桌面 AI 工作台，使用 Tauri v2、Rust、React 和 TypeScript 构建。它把持久化对话、项目文件、轻量 RAG、长期记忆、Skills、MCP 工具、OCR 图片附件、Ops SSH 工作台和运行时观测集中在一个桌面客户端里，业务数据默认保存在本机 SQLite。

## 核心能力

- 本地笔记、提示词和长期记忆管理，支持 SQLite FTS5 全文检索。
- 持久化 AI 对话，支持归档、恢复、删除、项目作用域隔离和会话级模型选择。
- OpenAI-compatible Chat/Embeddings、Anthropic Messages API，以及 Ollama/OpenRouter 等兼容服务。
- 流式回复、reasoning/thinking 片段展示和长对话上下文压缩。
- 轻量 RAG：拖拽文件、抽取文本、分块、生成 embedding，并在对话时召回相关片段。
- 图片附件和 OCR：图片保存到 `.nano-agent/uploads/images/`，消息中渲染缩略图，点击可预览，并可通过 `ocr_image` 调用本机 PaddleOCR。
- 归档预览：设置页的 Archive 预览复用普通聊天的消息渲染链路，项目会话使用 `project_path`，普通会话回退到 app data 下的 `temp/`。
- 项目工作区：创建项目目录、浏览文件树、读写/重命名/删除项目文件、执行项目命令。
- Agent 运行时：记录 run、step、tool call，支持用户审批后执行文件读写、命令、OCR 和 MCP 工具。
- MCP 管理：支持 stdio、SSE、streamable HTTP，连接后把工具注入模型上下文。
- Skills 管理：同步 Anthropic Skills、维护本地 Skills 目录，并在系统提示中注入启用技能。
- Ops 工作台：管理 SSH 服务器、测试连接、上传文件、打开交互式 SSH 终端。
- 独立观测链路：LLM、MCP、Ops、部分工具和数据库操作写入 `nano-agent-observability.sqlite3`，可在设置中查看和清理。
- 深色、浅色、跟随系统主题，以及系统托盘最小化。

## 文档

- [系统设计文档](docs/系统设计文档.md)：整体定位、模块边界、关键业务链路和系统约束。
- [架构与模块设计](docs/架构与模块设计.md)：前端、Tauri command、Rust 后端模块分层。
- [数据与存储设计](docs/数据与存储设计.md)：SQLite 数据库、核心表、索引、文件边界和附件存储。
- [Agent、RAG、MCP 与 Skills](docs/智能体检索增强与扩展工具设计.md)：模型上下文、工具审批、RAG、OCR、MCP 和 Skills。
- [PaddleOCR OCR 工具](docs/图片文字识别工具.md)：本地 OCR 依赖、图片附件、运行时兼容和资源限制。
- [构建、配置与运维](docs/构建配置与运维.md)：开发、打包、数据位置、配置、安全和排查。
- [技术栈学习路线](docs/技术栈学习路线.md)：按当前项目技术栈设计的分阶段学习路径。

## 技术栈

- 桌面壳：Tauri v2
- 前端：React 18、TypeScript、Vite、lucide-react、react-markdown、remark-gfm
- 后端：Rust、Tokio、rusqlite、reqwest、serde、thiserror
- 数据库：SQLite + WAL + FTS5
- 模型：OpenAI-compatible Chat/Embeddings、Anthropic Messages API
- 扩展：MCP、Skills、本地 Agent 工具、PaddleOCR
- 运维：SSH/SFTP、Windows NSIS/MSI 打包

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

Rust 检查：

```bash
cd src-tauri
cargo check
```

Windows 打包：

```bash
npm.cmd run package:win
```

`package:win` 会调用 `scripts/build-installer.ps1`，加载 Visual Studio x64 构建环境，修正 Windows 下 Git `link.exe` 抢占 MSVC `link.exe` 的 PATH 问题，然后执行 Tauri build。常见产物包括 `src-tauri/target/release/nano-agent.exe`、NSIS 安装包和 MSI 安装包。

## 数据位置

运行时数据保存在 Tauri app data 目录下：

```text
nano-agent.sqlite3                 主业务数据
nano-agent-runtime.sqlite3         Agent 运行时数据
nano-agent-observability.sqlite3   观测数据
settings.json                      Tavily 等轻量应用设置
skills/                            本地 Skills 目录
temp/                              无项目上下文时的临时工作目录
```

项目内图片附件保存在对应根目录下的 `.nano-agent/uploads/images/`。普通对话没有真实项目路径时，会使用 app data 下的 `temp/` 作为附件和工具工作目录。

## 项目结构

```text
src/                           React + TypeScript 前端
src/api.ts                     Tauri command 调用封装
src/hooks/                     对话、模型、项目、RAG、MCP、Skills、Ops 等状态逻辑
src/components/                聊天区、侧栏、设置页、观测面板、Ops 工作台等 UI
src/lib/                       系统提示、工具解析、格式化和安全封装
src-tauri/src/lib.rs           Tauri command 注册、应用状态和启动流程
src-tauri/src/db.rs            主业务 SQLite 数据访问
src-tauri/src/runtime.rs       Agent run/step/tool call 运行时存储
src-tauri/src/observability.rs 观测 sink/pipeline 与观测库
src-tauri/src/llm.rs           Chat、streaming 和 embeddings 请求
src-tauri/src/mcp.rs           MCP client manager 与传输实现
src-tauri/src/agent_runner.rs  Agent 工具定义与 tool_call 解析
scripts/build-installer.ps1    Windows 打包脚本
docs/                          系统设计、运维和学习路线文档
```

## 设计原则

- 本地优先：对话、记忆、项目元数据和运行时记录默认保存在本机。
- 数据隔离：业务数据、Agent 运行时、观测数据分库保存，降低互相影响。
- 显式路径：项目路径、会话 ID、模型 ID、tool call ID 等跨层标识显式传递。
- 用户审批：高风险工具调用必须先形成可见的 tool call，再由用户确认执行。
- 可扩展：模型、MCP、Skills、观测 sink 和 Agent 工具都保留扩展边界。
- 非阻塞观测：观测写入失败只记录错误，不阻断主业务流程。
