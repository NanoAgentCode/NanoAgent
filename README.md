# NanoAgent

NanoAgent 是一个本地效率助手客户端，使用 Tauri + Rust + React + TypeScript 构建。它面向本地笔记、备忘录、提示词、记忆和 AI 对话工作流，数据默认保存在本机 SQLite 中。

## 功能

- 本地笔记、备忘录、提示词管理
- 备忘录定时提醒和周期提醒
- 对话中识别提醒意图，用户确认后创建备忘录
- 本地记忆库，支持查询、修改、启用/禁用和删除
- 系统按规则自动生成记忆，用户不手动新增记忆
- SQLite 持久化和 FTS5 本地全文搜索
- 对话历史持久化，支持归档、恢复和删除
- Markdown 消息渲染，代码块使用 VS Code 风格
- 模型流式输出，支持思考过程展示
- OpenAI-compatible 和 Anthropic Claude 模型配置
- 支持多组模型配置保存与手动切换
- 可选互联网检索，将检索结果注入当前对话上下文
- 深色、浅色和跟随系统主题，包含原生标题栏主题同步

## 技术栈

- 客户端壳：Tauri v2
- 核心语言：Rust
- UI：React + TypeScript
- 数据库：SQLite
- 搜索：SQLite FTS5
- 模型：OpenAI-compatible `/chat/completions`、Anthropic Messages API

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

构建安装包：

```bash
npm.cmd run tauri build
```

如果 PowerShell 遇到 VS 编译环境问题，可先进入 Visual Studio x64 构建环境后再执行 Tauri 构建。

## 模型配置

应用支持保存多组模型配置，并在对话输入区切换当前模型。

常见配置：

- OpenAI：`https://api.openai.com/v1`
- OpenRouter：`https://openrouter.ai/api/v1`
- Ollama：`http://localhost:11434/v1`
- Anthropic：`https://api.anthropic.com`

Ollama 等本地服务通常可以不填 API key。

## 数据位置

运行时数据库保存在 Tauri 应用数据目录中，文件名为：

```text
nano-agent.sqlite3
```

数据库、构建产物和依赖目录已在 `.gitignore` 中排除。

## 项目结构

```text
src/                 React + TypeScript 前端
src-tauri/           Tauri + Rust 后端
src-tauri/src/db.rs  SQLite 数据访问
src-tauri/src/llm.rs 模型请求和流式解析
src-tauri/icons/     应用图标资源
```

## 说明

当前版本是本地优先客户端。插件系统暂未实现，后续可以在 Tauri command 层和前端工具区扩展。
