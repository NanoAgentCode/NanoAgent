# 构建、配置与运维

## 1. 本地开发

安装依赖：

```bash
npm.cmd install
```

启动 Tauri 开发模式：

```bash
npm.cmd run tauri dev
```

前端单独启动：

```bash
npm.cmd run dev
```

前端构建和类型检查：

```bash
npm.cmd run build
```

Rust 检查：

```bash
cd src-tauri
cargo check
```

## 2. Windows 打包

推荐命令：

```bash
npm.cmd run package:win
```

该命令执行 `scripts/build-installer.ps1`，流程包括：

1. 定位 Visual Studio Build Tools 的 `vcvars64.bat`。
2. 注入 MSVC x64 构建环境。
3. 调整 PATH，避免 Git for Windows 的 `link.exe` 抢占 MSVC linker。
4. 执行 `npm.cmd run tauri build`。
5. 输出 release exe、NSIS 和 MSI 路径。

常见产物位置：

```text
src-tauri/target/release/nano-agent.exe
src-tauri/target/release/bundle/nsis/*.exe
src-tauri/target/release/bundle/msi/*.msi
```

## 3. 应用数据与清理

运行时数据位于 Tauri app data 目录。主要文件：

- `nano-agent.sqlite3`
- `nano-agent-runtime.sqlite3`
- `nano-agent-observability.sqlite3`
- `settings.json`
- `skills/`
- `temp/`

清理建议：

- 排查业务数据问题时优先备份 `nano-agent.sqlite3`。
- 运行时记录异常膨胀时可考虑清理 `nano-agent-runtime.sqlite3`。
- 观测数据可在设置页清空，也可以删除 `nano-agent-observability.sqlite3` 后重启重建。

## 4. 配置项

### 4.1 模型

聊天模型配置包括：

- provider
- base URL
- model
- API key

Anthropic 使用 Messages API；OpenAI、OpenRouter、Ollama 等走 OpenAI-compatible API。

### 4.2 Embedding

Embedding 配置独立于聊天模型，用于 RAG：

- embedding provider
- embedding base URL
- embedding model
- embedding API key

未填写时会回退到聊天模型配置。默认模型名为 `text-embedding-3-small`。

### 4.3 Tavily

Tavily API key 保存在 `settings.json`，用于可选互联网检索相关能力。

### 4.4 MCP

MCP 配置保存在主业务库。stdio server 可以设置命令、参数、环境变量和工作目录；HTTP 类 server 可以设置 URL 和 headers。

## 5. 观测与排查

观测系统默认只记录部分关键类别，重点覆盖 LLM 和 MCP，部分工具和数据库操作也会通过统一 helper 包装。

排查路径：

1. 在设置页打开观测面板。
2. 按 trace 查看同一次对话或操作的 span。
3. 检查 status、duration、operation、error 和 metadata。
4. 如需释放空间，可使用清空观测数据功能。

观测管线的原则是非阻塞：写入失败会打印错误，但不会让用户操作失败。

## 6. 安全检查清单

开发涉及工具执行或文件系统时，应确认：

- 是否使用项目真实路径 `project_path`，而不是显示名称拼路径。
- 是否通过相对路径归一化防止越界。
- 是否对写入、删除、命令执行保留用户确认。
- 是否避免把 API key 写入日志、观测摘要或错误详情。
- 是否避免把大型文件完整注入模型上下文。
- 是否让外部 MCP 工具结果以可见消息形式回到会话。

## 7. 推荐验证

普通前端/文档改动：

```bash
npm.cmd run build
```

后端 command、数据库或模型链路改动：

```bash
npm.cmd run build
cd src-tauri
cargo check
```

打包路径改动：

```bash
npm.cmd run package:win
```

文档和小范围配置改动可以用 `git diff --check` 做轻量验证。
