import { useEffect, useMemo, useRef, useState } from "react";
import { setTheme } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Activity,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Cpu,
  Edit,
  FileText,
  Folder,
  Info,
  MessageSquare,
  Monitor,
  Moon,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  SendHorizontal,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  appendMessage,
  archiveConversation,
  renameConversation,
  updateConversationModel,
  chat,
  chatStream,
  createConversation,
  createItem,
  createMemory,
  createProjectDirectory,
  deleteConversation,
  deleteItem,
  deleteMemory,
  deleteMessages,
  deleteModelConfig,
  deleteMcpServer,
  testLlmConnectivity,
  testEmbeddingConnectivity,
  deleteRagFile,
  connectMcpServer,
  disconnectMcpServer,
  refreshMcpTools,
  indexRagFile,
  listEnabledMemories,
  listArchivedConversations,
  listConversations,
  listItems,
  listMemories,
  listMessages,
  listModelConfigs,
  listMcpServers,
  listProjectFiles,
  listRagFiles,
  saveModelConfig,
  saveMcpServer,
  searchRagContext,
  searchItems,
  searchMemories,
  listLocalSkills,
  getTavilyApiKey,
  saveTavilyApiKey,
  updateItem,
  updateMemory,
  checkEnv,
  installEnv,
  listObservabilitySpans,
  clearObservabilitySpans,
  listAgentRunTimelines,
  createAgentRun,
  finishAgentRun,
  recordAgentStep,
  createAgentToolCall,
  updateAgentToolCall,
  approveAgentToolCall,
  rejectAgentToolCall,
  resolveAgentModelOutput,
  executeAgentToolCall,
  readAbsoluteFile
} from "./api";
import MarkdownMessage from "./MarkdownMessage";
import type {
  ChatMessage,
  ChatStreamEvent,
  AgentRun,
  AgentRunTimeline,
  AgentRunDraft,
  AgentStep,
  AgentStepDraft,
  AgentToolCallDraft,
  AgentToolCall,
  AgentToolExecutionRequest,
  Conversation,
  Item,
  ItemKind,
  MessageMetadata,
  Memory,
  McpServerDraft,
  McpServerView,
  ModelConfig,
  ModelConfigDraft,
  ObservabilitySpan,
  ProjectEntry,
  ProjectFileEntry,
  PersistedMessage,
  RagChunkMatch,
  RagFile,
  WebSearchResponse,
  WebSearchResult,
  WebSearchStatus
} from "./types";

const kindLabels: Record<ItemKind, string> = {
  note: "笔记",
  prompt: "提示词"
};

const statusLabels: Record<string, string> = {
  active: "活跃",
  archived: "已归档"
};

type WorkspaceView = ItemKind | "all" | "memory";
type ThemeMode = "system" | "light" | "dark";
type AgentTimelineEvent = {
  id: string;
  time: string;
  status: string;
  title: string;
  subtitle: string;
  detail: string;
};
type SettingsTab =
  | "memory"
  | "theme"
  | "archive"
  | "model"
  | "embedding"
  | "skills"
  | "mcp"
  | "observability"
  | "environment";



function getWebSearchEngineLabel(engine: string) {
  if (engine === "tavily") return "Tavily";
  if (engine === "duckduckgo") return "DuckDuckGo";
  return engine || "未知引擎";
}

function formatWebSearchBadge(status: WebSearchStatus, resultCount: number) {
  const engineLabel = getWebSearchEngineLabel(status.engine);
  if (status.used_fallback) {
    return `网络检索: 已回退到 ${engineLabel} (${resultCount} 条结果)`;
  }
  return `网络检索: ${engineLabel} (${resultCount} 条结果)`;
}

const workspaceLabels: Record<WorkspaceView, string> = {
  all: "全部",
  note: "笔记",
  prompt: "提示词",
  memory: "记忆系统"
};

const systemMessage: ChatMessage = {
  role: "system",
  content: "你是一个专注的本地效率助手。请保持回答简明且实用。记忆写入由应用本地功能处理；除非应用明确提供结果，否则不要声称已经保存或更新记忆。"
};

const emptyModelDraft: ModelConfigDraft = {
  name: "OpenAI",
  provider: "openai-compatible",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  api_key: "",
  embedding_provider: "openai-compatible",
  embedding_base_url: "https://api.openai.com/v1",
  embedding_model: "text-embedding-3-small",
  embedding_api_key: ""
};

const emptyEmbeddingDraft: ModelConfigDraft = {
  id: "embedding-config",
  name: "嵌入模型",
  provider: "openai-compatible",
  base_url: "https://api.openai.com/v1",
  model: "text-embedding-3-small",
  api_key: "",
  embedding_provider: "openai-compatible",
  embedding_base_url: "https://api.openai.com/v1",
  embedding_model: "text-embedding-3-small",
  embedding_api_key: ""
};

const emptyMcpDraft: McpServerDraft = {
  name: "filesystem-server",
  transport: "stdio",
  command: "npx",
  args_json: "[\"-y\", \"@modelcontextprotocol/server-filesystem\", \"C:\\\\Users\\\\13439\\\\Desktop\"]",
  env_json: "{}",
  url: "",
  headers_json: "{}",
  working_dir: "",
  enabled: true
};

const providerDefaults: Record<string, Pick<ModelConfigDraft, "base_url" | "model">> = {
  "openai-compatible": {
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  anthropic: {
    base_url: "https://api.anthropic.com",
    model: "claude-3-5-sonnet-latest"
  }
};

const embeddingProviderDefaults: Record<string, Pick<ModelConfigDraft, "embedding_base_url" | "embedding_model">> = {
  "openai-compatible": {
    embedding_base_url: "https://api.openai.com/v1",
    embedding_model: "text-embedding-3-small"
  }
};

function normalizeModelDraft(model: ModelConfig | ModelConfigDraft): ModelConfigDraft {
  return {
    ...model,
    embedding_provider: model.embedding_provider || "openai-compatible",
    embedding_base_url: model.embedding_base_url || "https://api.openai.com/v1",
    embedding_model: model.embedding_model || "text-embedding-3-small",
    embedding_api_key: model.embedding_api_key || ""
  };
}

const themeLabels: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "白天主题",
  dark: "夜晚主题"
};

const projectStorageKey = "nano-agent-projects";
const activeProjectStorageKey = "nano-agent-active-project-id";

function loadSavedProjects() {
  const saved = localStorage.getItem(projectStorageKey);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as ProjectEntry[];
    const uniqueProjects = new Map<string, ProjectEntry>();
    for (const project of parsed) {
      if (!project.id || !project.name || !project.path) {
        continue;
      }
      const normalizedPath = project.path.trim().replace(/[\\/]+$/, "");
      if (!normalizedPath) {
        continue;
      }
      const normalizedProject = {
        ...project,
        id: normalizedPath,
        name: project.name,
        path: normalizedPath
      };
      uniqueProjects.set(normalizedPath.toLowerCase(), normalizedProject);
    }
    return Array.from(uniqueProjects.values());
  } catch (error) {
    console.error("Failed to parse projects from localStorage", error);
    return [];
  }
}

function projectNameFromPath(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized || "未命名项目";
}

function saveProjects(projects: ProjectEntry[], activeProjectId: string) {
  localStorage.setItem(projectStorageKey, JSON.stringify(projects));
  if (activeProjectId) {
    localStorage.setItem(activeProjectStorageKey, activeProjectId);
  } else {
    localStorage.removeItem(activeProjectStorageKey);
  }
}

interface ParsedToolCall {
  name: string;
  args: Record<string, string>;
  raw: string;
}

interface ParsedToolResult {
  name: string;
  status: "success" | "failed" | "rejected" | "unknown";
  summary: string;
  detail: string;
}

function parseToolCall(content: string): ParsedToolCall | null {
  if (!content) return null;
  const match = content.match(/<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/);
  if (!match) return null;

  const name = match[1];
  const body = match[2];
  const args: Record<string, string> = {};

  const tagRegex = /<([^>]+)>([\s\S]*?)<\/\1>/g;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(body)) !== null) {
    args[tagMatch[1]] = tagMatch[2].trim();
  }

  return { name, args, raw: match[0] };
}

function parseToolResult(content: string): ParsedToolResult | null {
  if (!content) return null;
  const match = content.match(/^\[工具执行结果: ([^\]]+)\]\s*([\s\S]*)$/);
  if (!match) return null;

  const name = match[1].trim();
  const body = match[2].trim();
  if (body.startsWith("执行失败")) {
    return {
      name,
      status: "failed",
      summary: "执行失败",
      detail: body.replace(/^执行失败[:：]?\s*/, "").trim() || body
    };
  }
  if (body.startsWith("执行结果如下")) {
    return {
      name,
      status: "success",
      summary: "执行完成",
      detail: body.replace(/^执行结果如下[:：]?\s*/, "").trim() || body
    };
  }
  if (body.includes("用户拒绝")) {
    return {
      name,
      status: "rejected",
      summary: "用户拒绝",
      detail: body
    };
  }

  return {
    name,
    status: "unknown",
    summary: "工具结果",
    detail: body
  };
}

function renderMessageContent(content: string) {
  const toolResult = parseToolResult(content);
  if (toolResult) {
    return <ToolResultMessage result={toolResult} />;
  }
  return <MarkdownMessage content={content} />;
}

function ToolResultMessage({ result }: { result: ParsedToolResult }) {
  return (
    <details className={`tool-result-panel ${result.status}`}>
      <summary className="tool-result-summary">
        <span className="tool-result-title">工具执行结果</span>
        <code>{result.name}</code>
        <span className="tool-result-status">{result.summary}</span>
      </summary>
      <div className="tool-result-detail">
        <MarkdownMessage content={result.detail || "无输出"} />
      </div>
    </details>
  );
}

interface Skill {
  id: string;
  name: string;
  provider: string;
  description: string;
  enabled: boolean;
  parameters: Record<string, string>;
  docUrl: string;
}

const defaultSkills: Skill[] = [
  {
    id: "text_editor",
    name: "Text Editor (str_replace_editor)",
    provider: "Anthropic",
    description: "专为大模型优化设计的文本编辑器，支持查看文件、搜索内容、以及精确替换文件内代码块。",
    enabled: true,
    parameters: {
      workspace_root: "C:\\Users\\13439\\Desktop"
    },
    docUrl: "https://docs.anthropic.com/en/docs/agents-and-tools/tool-use"
  },
  {
    id: "bash_tool",
    name: "Bash Tool",
    provider: "Anthropic",
    description: "允许 AI 助手在本地受控制的安全终端中执行 shell 命令行与自动化脚本。",
    enabled: true,
    parameters: {
      shell_path: "powershell.exe",
      allowed_prefixes: "git,npm,node,cargo,tsc"
    },
    docUrl: "https://docs.anthropic.com/en/docs/agents-and-tools/tool-use"
  },
  {
    id: "document_creator",
    name: "Document Creator",
    provider: "Anthropic",
    description: "利用自动化引擎生成和处理 Word、Excel、PowerPoint、PDF 等格式的工作文档与报表。",
    enabled: true,
    parameters: {
      output_dir: "C:\\Users\\13439\\Desktop"
    },
    docUrl: "https://github.com/anthropics/skills"
  },
  {
    id: "frontend_designer",
    name: "Frontend Designer",
    provider: "Anthropic",
    description: "生成符合现代 UI 规范的 HTML、CSS 以及 React 组件原型，提供完整的交互式前端设计方案。",
    enabled: true,
    parameters: {
      framework: "React + Vite"
    },
    docUrl: "https://github.com/anthropics/skills"
  },
  {
    id: "algorithmic_art",
    name: "Algorithmic Art Creator",
    provider: "Anthropic",
    description: "通过 SVG 路径、Canvas API 等编程算法，生成高度自定义的数字艺术图形与矢量艺术资产。",
    enabled: true,
    parameters: {
      canvas_format: "SVG"
    },
    docUrl: "https://github.com/anthropics/skills"
  },
  {
    id: "skill_creator",
    name: "Skill Creator",
    provider: "Anthropic",
    description: "通过与 AI 进行自然语言交互，动态生成、设计并自动打包一个新的 Agent 技能（Skill）。",
    enabled: true,
    parameters: {
      skills_root: "C:\\Users\\13439\\Desktop\\NanoAgent\\.agents\\skills"
    },
    docUrl: "https://github.com/anthropics/skills"
  },
  {
    id: "tavily_search",
    name: "tavily-search",
    provider: "Tavily",
    description: "通过 Tavily CLI 执行面向大模型优化的网页搜索，支持域名过滤、时间范围、新闻/金融主题和不同搜索深度。",
    enabled: true,
    parameters: {
      command: "tvly search",
      auth: "TAVILY_API_KEY or tvly login"
    },
    docUrl: "https://github.com/tavily-ai/skills/tree/main/skills/tavily-search"
  },
  {
    id: "tavily_cli",
    name: "tavily-cli",
    provider: "Tavily",
    description: "Tavily CLI 工作流指南，覆盖安装、登录、搜索、抽取、映射、抓取和研究的推荐使用路径。",
    enabled: true,
    parameters: {
      install: "uv tool install tavily-cli or pip install tavily-cli",
      auth: "tvly login --api-key tvly-YOUR_KEY"
    },
    docUrl: "https://github.com/tavily-ai/skills/tree/main/skills/tavily-cli"
  }
];

const defaultSkillIds = new Set(defaultSkills.map((skill) => skill.id));

function isBuiltInSkill(skillId: string) {
  return defaultSkillIds.has(skillId);
}

function normalizeSkills(skills: Skill[]) {
  const skillMap = new Map(skills.map((skill) => [skill.id, skill]));
  defaultSkills.forEach((defaultSkill) => {
    const existing = skillMap.get(defaultSkill.id);
    skillMap.set(
      defaultSkill.id,
      existing
        ? {
            ...existing,
            name: defaultSkill.name,
            provider: defaultSkill.provider,
            description: defaultSkill.description,
            parameters: {
              ...defaultSkill.parameters,
              ...existing.parameters
            },
            docUrl: defaultSkill.docUrl
          }
        : defaultSkill
    );
  });
  return Array.from(skillMap.values());
}

function App() {
  const listRequestRef = useRef(0);
  const messageLoadRequestRef = useRef(0);
  const activeConversationIdRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeKind, setActiveKind] = useState<WorkspaceView>("note");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [status, setStatus] = useState("active");
  const [memoryItems, setMemoryItems] = useState<Memory[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryTagsText, setMemoryTagsText] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelDraft, setModelDraft] = useState<ModelConfigDraft>(emptyModelDraft);
  const [activeModelId, setActiveModelId] = useState("");
  const [embeddingDraft, setEmbeddingDraft] = useState<ModelConfigDraft>(emptyEmbeddingDraft);
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([]);
  const [mcpDraft, setMcpDraft] = useState<McpServerDraft>(emptyMcpDraft);
  const [stdioCommandLine, setStdioCommandLine] = useState(formatStdioCommandLine(emptyMcpDraft));
  const [selectedMcpServerId, setSelectedMcpServerId] = useState("");
  const [mcpBusyId, setMcpBusyId] = useState("");

  const [llmTestStatus, setLlmTestStatus] = useState<{
    status: "idle" | "testing" | "success" | "error";
    message?: string;
  }>({ status: "idle" });

  const [modelTestStatuses, setModelTestStatuses] = useState<Record<string, {
    status: "idle" | "testing" | "success" | "error";
    message?: string;
  }>>({});

  useEffect(() => {
    const modelId = modelDraft.id || "new-config";
    const savedModel = models.find((m) => m.id === modelDraft.id);
    const isDirty = savedModel 
      ? (modelDraft.name !== savedModel.name ||
         modelDraft.provider !== savedModel.provider ||
         modelDraft.base_url !== savedModel.base_url ||
         modelDraft.model !== savedModel.model ||
         modelDraft.api_key !== savedModel.api_key)
      : (modelDraft.name !== emptyModelDraft.name ||
         modelDraft.provider !== emptyModelDraft.provider ||
         modelDraft.base_url !== emptyModelDraft.base_url ||
         modelDraft.model !== emptyModelDraft.model ||
         modelDraft.api_key !== emptyModelDraft.api_key);

    if (isDirty) {
      const currentStatus = modelTestStatuses[modelId]?.status || "idle";
      if (currentStatus !== "idle") {
        setModelTestStatuses((prev) => ({
          ...prev,
          [modelId]: { status: "idle" }
        }));
      }
    }
  }, [
    modelDraft.id,
    modelDraft.name,
    modelDraft.provider,
    modelDraft.base_url,
    modelDraft.model,
    modelDraft.api_key,
    models,
    modelTestStatuses
  ]);

  useEffect(() => {
    const modelId = modelDraft.id || "new-config";
    setLlmTestStatus(modelTestStatuses[modelId] || { status: "idle" });
  }, [modelDraft.id, modelTestStatuses]);

  const [embeddingTestStatus, setEmbeddingTestStatus] = useState<{
    status: "idle" | "testing" | "success" | "error";
    message?: string;
  }>({ status: "idle" });

  useEffect(() => {
    setEmbeddingTestStatus({ status: "idle" });
  }, [
    embeddingDraft.embedding_provider,
    embeddingDraft.embedding_base_url,
    embeddingDraft.embedding_model,
    embeddingDraft.embedding_api_key
  ]);

  useEffect(() => {
    const existing = models.find((m) => m.id === "embedding-config");
    if (existing) {
      setEmbeddingDraft(normalizeModelDraft(existing));
    } else {
      setEmbeddingDraft(emptyEmbeddingDraft);
    }
  }, [models]);
  const [projects, setProjects] = useState<ProjectEntry[]>(() => loadSavedProjects());
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem(activeProjectStorageKey) || "");
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() => {
    const activeId = localStorage.getItem(activeProjectStorageKey) || "";
    return activeId ? [activeId] : [];
  });
  const [projectsSectionExpanded, setProjectsSectionExpanded] = useState(true);
  const [chatsSectionExpanded, setChatsSectionExpanded] = useState(true);
  const [projectConversations, setProjectConversations] = useState<Record<string, Conversation[]>>({});
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectParent, setNewProjectParent] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<ProjectEntry | null>(null);
  const [projectApprovalText, setProjectApprovalText] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  const [skillsDir, setSkillsDir] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
    conversation: Conversation | null;
    project: ProjectEntry | null;
  }>({ x: 0, y: 0, visible: false, conversation: null, project: null });

  const tempDir = skillsDir
    ? skillsDir.replace(/[\\/]skills$/, "") + (skillsDir.includes("/") ? "/temp" : "\\temp")
    : "C:\\Users\\13439\\Desktop\\temp";
  const [previewArchivedId, setPreviewArchivedId] = useState("");
  const [previewMessages, setPreviewMessages] = useState<PersistedMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [messages, setMessages] = useState<PersistedMessage[]>([]);
  const [messageReasoning, setMessageReasoning] = useState<Record<string, string>>({});
  const [chatInput, setChatInput] = useState("");
  const [ragFiles, setRagFiles] = useState<RagFile[]>([]);
  const [isRagDragging, setIsRagDragging] = useState(false);
  const [indexingRagFileName, setIndexingRagFileName] = useState("");
  const [promptSuggestions, setPromptSuggestions] = useState<Item[]>([]);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [promptTriggerIndex, setPromptTriggerIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("theme");
  const [observabilitySpans, setObservabilitySpans] = useState<ObservabilitySpan[]>([]);
  const [agentRunTimelines, setAgentRunTimelines] = useState<AgentRunTimeline[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState("");
  const [expandedObservabilityRows, setExpandedObservabilityRows] = useState<string[]>([]);
  const [agentRuntimeCollapsed, setAgentRuntimeCollapsed] = useState(false);
  const [traceTimelineCollapsed, setTraceTimelineCollapsed] = useState(false);
  const [isLoadingObservability, setIsLoadingObservability] = useState(false);
  const [skills, setSkills] = useState<Skill[]>(() => {
    const saved = localStorage.getItem("nano-agent-skills");
    if (saved) {
      try {
        return normalizeSkills(JSON.parse(saved) as Skill[]);
      } catch (e) {
        console.error("Failed to parse skills from localStorage", e);
      }
    }
    return defaultSkills;
  });
  const [selectedSkillId, setSelectedSkillId] = useState<string>("text_editor");
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [newSkillDraft, setNewSkillDraft] = useState<{
    id: string;
    name: string;
    provider: string;
    description: string;
    docUrl: string;
  }>({
    id: "",
    name: "",
    provider: "Custom",
    description: "",
    docUrl: ""
  });
  const [nodePath, setNodePath] = useState(() => localStorage.getItem("nano-agent-node-path") || "");
  const [pythonPath, setPythonPath] = useState(() => localStorage.getItem("nano-agent-python-path") || "");
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [isSavingTavilyApiKey, setIsSavingTavilyApiKey] = useState(false);
  const [envStatus, setEnvStatus] = useState<Record<string, boolean>>({ node: true, python: true });
  const [showCustomPaths, setShowCustomPaths] = useState(false);
  const [showEnvActionsMenu, setShowEnvActionsMenu] = useState(false);
  const [showEnvPrompt, setShowEnvPrompt] = useState(false);
  const [isCheckingEnv, setIsCheckingEnv] = useState(false);
  const [isInstallingEnv, setIsInstallingEnv] = useState(false);
  const [envInstallProgress, setEnvInstallProgress] = useState("");
  const [workspaceListRatio, setWorkspaceListRatio] = useState(38);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("nano-agent-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId),
    [items, selectedId]
  );
  const selectedMemory = useMemo(
    () => memoryItems.find((memory) => memory.id === selectedMemoryId),
    [memoryItems, selectedMemoryId]
  );
  const activeConversation = useMemo(() => {
    const allProjectConversations = Object.values(projectConversations).flat();
    return [...conversations, ...allProjectConversations].find(
      (conversation) => conversation.id === activeConversationId
    );
  }, [activeConversationId, conversations, projectConversations]);
  const activeConversationProject = useMemo(
    () =>
      activeConversation?.project_path
        ? projects.find((project) => project.path === activeConversation.project_path) || null
        : null,
    [activeConversation, projects]
  );
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects]
  );
  const selectedMcpServer = useMemo(
    () => mcpServers.find((server) => server.config.id === selectedMcpServerId) || null,
    [mcpServers, selectedMcpServerId]
  );
  const traceGroups = useMemo(() => {
    const groups = new Map<string, ObservabilitySpan[]>();
    for (const span of observabilitySpans) {
      const current = groups.get(span.trace_id) || [];
      current.push(span);
      groups.set(span.trace_id, current);
    }

    return Array.from(groups.entries())
      .map(([traceId, spans]) => {
        const sorted = [...spans].sort(
          (left, right) => Date.parse(left.started_at) - Date.parse(right.started_at)
        );
        const errors = sorted.filter((span) => span.status === "error").length;
        const duration = sorted.reduce((sum, span) => sum + (span.duration_ms || 0), 0);
        const startedAt = sorted[0]?.started_at || "";
        const lastSpan = sorted[sorted.length - 1];
        return {
          traceId,
          spans: sorted,
          errors,
          duration,
          startedAt,
          lastOperation: lastSpan?.operation || ""
        };
      })
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  }, [observabilitySpans]);
  const selectedTrace =
    traceGroups.find((trace) => trace.traceId === selectedTraceId) || traceGroups[0] || null;
  const activeRunTimeline = agentRunTimelines[0] || null;
  const activeRunTimelineEvents = useMemo(
    () => (activeRunTimeline ? buildAgentTimelineEvents(activeRunTimeline) : []),
    [activeRunTimeline]
  );
  const activeTraceTimelineItems = selectedTrace?.spans || [];

  useEffect(() => {
    setExpandedObservabilityRows([]);
    setTraceTimelineCollapsed(false);
  }, [selectedTrace?.traceId]);

  useEffect(() => {
    if (projects.length === 0) {
      if (activeProjectId) {
        setActiveProjectId("");
        localStorage.removeItem(activeProjectStorageKey);
      }
      return;
    }

    if (!projects.some((project) => project.id === activeProjectId)) {
      const nextActiveProjectId = projects[0].id;
      setActiveProjectId(nextActiveProjectId);
      localStorage.setItem(activeProjectStorageKey, nextActiveProjectId);
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjectIds((current) =>
        current.includes(activeProjectId) ? current : [...current, activeProjectId]
      );
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refreshProjectConversationMap(projects);
  }, [projects]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void loadAll();
    void checkLocalSkills();
    getTavilyApiKey()
      .then((apiKey) => setTavilyApiKey(apiKey))
      .catch((error) => console.error("Failed to load Tavily API key:", error));
    
    // Check if skills contain "computer_use" and clean it up
    const saved = localStorage.getItem("nano-agent-skills");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Skill[];
        if (parsed.some((s) => s.id === "computer_use")) {
          localStorage.removeItem("nano-agent-skills");
          setSkills(defaultSkills);
          setSelectedSkillId("text_editor");
        }
      } catch (e) {
        // ignore
      }
    }

    // Auto-sync logic removed

    // First-time environment check
    const isEnvChecked = localStorage.getItem("nano-agent-env-checked") === "true";
    const currentNodePath = localStorage.getItem("nano-agent-node-path") || "";
    const currentPythonPath = localStorage.getItem("nano-agent-python-path") || "";
    
    setIsCheckingEnv(true);
    checkEnv(currentNodePath, currentPythonPath)
      .then((status) => {
        setEnvStatus(status);
        if (!isEnvChecked && (!status.node || !status.python)) {
          setShowEnvPrompt(true);
        } else if (!isEnvChecked) {
          localStorage.setItem("nano-agent-env-checked", "true");
        }
      })
      .catch((e) => {
        console.error("Failed to run startup environment check:", e);
      })
      .finally(() => {
        setIsCheckingEnv(false);
      });
  }, []);

  useEffect(() => {
    void refreshItems(query, activeKind);
  }, [activeKind, query]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      let resolvedTheme = themeMode;
      if (themeMode === "system") {
        resolvedTheme = media.matches ? "dark" : "light";
      }
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = themeMode;
      localStorage.setItem("nano-agent-theme", themeMode);
      
      const tauriTheme = resolvedTheme === "light" ? "light" : "dark";
      void setTheme(tauriTheme);
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    if (!showModelConfig || activeSettingsTab !== "archive") {
      setPreviewArchivedId("");
      setPreviewMessages([]);
    }
  }, [showModelConfig, activeSettingsTab]);

  useEffect(() => {
    if (!selectedItem) {
      setTitle("");
      setBody("");
      setTagsText("");
      setStatus("active");
      return;
    }

    setTitle(selectedItem.title);
    setBody(selectedItem.body);
    setTagsText(selectedItem.tags.join(", "));
    setStatus(selectedItem.status);
  }, [selectedItem]);

  useEffect(() => {
    if (!selectedMemory) {
      setMemoryTitle("");
      setMemoryContent("");
      setMemoryTagsText("");
      setMemoryEnabled(true);
      return;
    }

    setMemoryTitle(selectedMemory.title);
    setMemoryContent(selectedMemory.content);
    setMemoryTagsText(selectedMemory.tags.join(", "));
    setMemoryEnabled(selectedMemory.enabled);
  }, [selectedMemory]);

  useEffect(() => {
    if (!selectedMcpServer) {
      setMcpDraft(emptyMcpDraft);
      setStdioCommandLine(formatStdioCommandLine(emptyMcpDraft));
      return;
    }

    const nextDraft = {
      id: selectedMcpServer.config.id,
      name: selectedMcpServer.config.name,
      transport: selectedMcpServer.config.transport || "stdio",
      command: selectedMcpServer.config.command,
      args_json: selectedMcpServer.config.args_json,
      env_json: selectedMcpServer.config.env_json,
      url: selectedMcpServer.config.url,
      headers_json: selectedMcpServer.config.headers_json,
      working_dir: selectedMcpServer.config.working_dir,
      enabled: selectedMcpServer.config.enabled
    };
    setMcpDraft(nextDraft);
    setStdioCommandLine(formatStdioCommandLine(nextDraft));
  }, [selectedMcpServer]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    setMessageReasoning({});
    if (!activeConversationId) {
      setMessages([]);
      setRagFiles([]);
      return;
    }

    void loadMessages(activeConversationId);
    void refreshRagFiles(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    const conversationModelId = activeConversation?.model_config_id || "";
    if (!conversationModelId) {
      return;
    }
    if (!models.some((model) => model.id === conversationModelId)) {
      return;
    }
    if (conversationModelId !== activeModelId) {
      setActiveModelId(conversationModelId);
    }
  }, [activeConversation?.id, activeConversation?.model_config_id, activeModelId, models]);

  useEffect(() => {
    if (showModelConfig && activeSettingsTab === "observability") {
      void refreshObservability();
    }
  }, [showModelConfig, activeSettingsTab, activeConversationId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;
    
    void getCurrentWebviewWindow().onDragDropEvent((event) => {
      const { type, paths } = event.payload as any;
      if (type === "enter" || type === "over") {
        setIsRagDragging(true);
      } else if (type === "leave") {
        setIsRagDragging(false);
      } else if (type === "drop") {
        setIsRagDragging(false);
        if (paths && paths.length > 0) {
          void handleDroppedFilePaths(paths);
        }
      }
    }).then((fn) => {
      if (isMounted) {
        unlisten = fn;
      } else {
        fn();
      }
    });
    
    return () => {
      isMounted = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [activeConversationId, activeModelId]);

  async function refreshObservability() {
    setIsLoadingObservability(true);
    try {
      const spans = await listObservabilitySpans(200);
      setObservabilitySpans(spans);
      if (activeConversationId) {
        setAgentRunTimelines(await listAgentRunTimelines(activeConversationId, 20));
      } else {
        setAgentRunTimelines([]);
      }
      setSelectedTraceId((current) =>
        current && spans.some((span) => span.trace_id === current)
          ? current
          : spans[0]?.trace_id || ""
      );
    } catch (error) {
      setNotice(String(error));
    } finally {
      setIsLoadingObservability(false);
    }
  }

  async function handleClearObservability() {
    if (!confirm("Clear all observability spans?")) {
      return;
    }

    try {
      await clearObservabilitySpans();
      setObservabilitySpans([]);
      setAgentRunTimelines([]);
      setSelectedTraceId("");
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function loadAll() {
    try {
      const [nextItems, nextModels, nextConversations, nextArchivedConversations, nextMemories, nextMcpServers] = await Promise.all([
        listItems(),
        listModelConfigs(),
        listConversations(),
        listArchivedConversations(),
        loadVisibleMemories(""),
        listMcpServers()
      ]);
      setItems(nextItems);
      setModels(nextModels);
      setConversations(nextConversations);
      setArchivedConversations(nextArchivedConversations);
      setMemoryItems(nextMemories);
      setMcpServers(nextMcpServers);
      setSelectedId((current) => current || nextItems[0]?.id || "");
      setActiveModelId((current) => current || nextModels.find((m) => m.id !== "embedding-config")?.id || "");
      setActiveConversationId((current) => current || nextConversations[0]?.id || "");
      setSelectedMemoryId((current) => current || nextMemories[0]?.id || "");
      setSelectedMcpServerId((current) => current || nextMcpServers[0]?.config.id || "");
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function loadMessages(conversationId: string) {
    const requestId = ++messageLoadRequestRef.current;
    try {
      const nextMessages = await listMessages(conversationId);
      if (requestId === messageLoadRequestRef.current && activeConversationIdRef.current === conversationId) {
        setMessages(nextMessages);
      }
    } catch (error) {
      if (requestId === messageLoadRequestRef.current) {
        setNotice(String(error));
      }
    }
  }

  async function refreshRagFiles(conversationId: string) {
    try {
      setRagFiles(await listRagFiles(conversationId));
    } catch (error) {
      console.error("Failed to list RAG files:", error);
      setRagFiles([]);
    }
  }

  async function refreshMcpServers(selectId?: string) {
    try {
      const servers = await listMcpServers();
      setMcpServers(servers);
      setSelectedMcpServerId((current) => {
        if (selectId && servers.some((server) => server.config.id === selectId)) {
          return selectId;
        }
        if (current && servers.some((server) => server.config.id === current)) {
          return current;
        }
        return servers[0]?.config.id || "";
      });
    } catch (error) {
      setNotice(`加载 MCP 配置失败：${String(error)}`);
    }
  }

  function updateMcpServerView(view: McpServerView) {
    setMcpServers((current) => {
      const exists = current.some((server) => server.config.id === view.config.id);
      if (!exists) return [view, ...current];
      return current.map((server) => (server.config.id === view.config.id ? view : server));
    });
  }

  function handleNewMcpServer() {
    setSelectedMcpServerId("");
    setMcpDraft(emptyMcpDraft);
    setStdioCommandLine(formatStdioCommandLine(emptyMcpDraft));
  }

  async function handleSaveMcpServer() {
    try {
      const isStdio = mcpDraft.transport === "stdio";
      const stdioCommand = isStdio ? parseStdioCommandLine(stdioCommandLine) : null;
      const saved = await saveMcpServer({
        ...mcpDraft,
        command: stdioCommand ? stdioCommand.command : "",
        args_json: stdioCommand ? JSON.stringify(stdioCommand.args) : "[]",
        env_json: isStdio ? mcpDraft.env_json : "{}",
        url: isStdio ? "" : mcpDraft.url,
        headers_json: isStdio ? "{}" : mcpDraft.headers_json,
        working_dir: isStdio ? mcpDraft.working_dir : "",
        enabled: true
      });
      await refreshMcpServers(saved.id);
      setNotice("MCP 服务器配置已保存。");
    } catch (error) {
      setNotice(`保存 MCP 服务器失败：${String(error)}`);
    }
  }

  async function handleDeleteMcpServer() {
    if (!mcpDraft.id) {
      handleNewMcpServer();
      return;
    }
    if (!confirm("确定要删除该 MCP 服务器配置吗？")) {
      return;
    }
    setMcpBusyId(mcpDraft.id);
    try {
      await deleteMcpServer(mcpDraft.id);
      await refreshMcpServers();
      setNotice("MCP 服务器已删除。");
    } catch (error) {
      setNotice(`删除 MCP 服务器失败：${String(error)}`);
    } finally {
      setMcpBusyId("");
    }
  }

  async function handleConnectMcpServer(id: string) {
    setMcpBusyId(id);
    try {
      const view = await connectMcpServer(id);
      updateMcpServerView(view);
      setSelectedMcpServerId(id);
      setNotice(`MCP 服务器 ${view.config.name} 已连接，发现 ${view.tools.length} 个工具。`);
    } catch (error) {
      await refreshMcpServers(id);
      setNotice(`连接 MCP 服务器失败：${String(error)}`);
    } finally {
      setMcpBusyId("");
    }
  }

  async function handleDisconnectMcpServer(id: string) {
    setMcpBusyId(id);
    try {
      await disconnectMcpServer(id);
      await refreshMcpServers(id);
      setNotice("MCP 服务器已断开。");
    } catch (error) {
      setNotice(`断开 MCP 服务器失败：${String(error)}`);
    } finally {
      setMcpBusyId("");
    }
  }

  async function handleRefreshMcpTools(id: string) {
    setMcpBusyId(id);
    try {
      const tools = await refreshMcpTools(id);
      setMcpServers((current) =>
        current.map((server) =>
          server.config.id === id
            ? {
                ...server,
                tools,
                status: {
                  ...server.status,
                  connected: true,
                  tool_count: tools.length,
                  error: null
                }
              }
            : server
        )
      );
      setNotice(`工具列表已刷新，共 ${tools.length} 个工具。`);
    } catch (error) {
      setNotice(`刷新 MCP 工具失败：${String(error)}`);
    } finally {
      setMcpBusyId("");
    }
  }

  async function handleRagFiles(files: FileList | File[]) {
    const selectedFiles = Array.from(files).filter((file) => isSupportedRagFile(file.name));
    if (selectedFiles.length === 0) {
      setNotice("仅支持文本类文件：txt、md、json、csv、log、代码文件等。");
      return;
    }

    const modelConfigId = resolveConversationModelId(activeConversationId);
    if (!modelConfigId) {
      setNotice("请先保存并选择一个模型配置。");
      return;
    }

    const projectHint = getConversationProjectHint();
    const conversationId = await ensureConversation(projectHint);
    try {
      for (const file of selectedFiles) {
        setIndexingRagFileName(file.name);
        const content = await file.text();
        await indexRagFile({
          conversation_id: conversationId,
          name: file.name,
          mime: file.type || "text/plain",
          size: file.size,
          content,
          model_config_id: modelConfigId
        });
      }
      await refreshRagFiles(conversationId);
      setNotice(`已索引 ${selectedFiles.length} 个文件到当前对话。`);
    } catch (error) {
      console.error("Failed to index RAG file:", error);
      setNotice(`文件索引失败：${String(error)}`);
    } finally {
      setIndexingRagFileName("");
      setIsRagDragging(false);
    }
  }

  async function handleDroppedFilePaths(paths: string[]) {
    const supportedPaths = paths.filter((p) => isSupportedRagFile(p));
    if (supportedPaths.length === 0) {
      setNotice("仅支持文本类文件：txt、md、json、csv、log、代码文件等。");
      return;
    }

    const modelConfigId = resolveConversationModelId(activeConversationId);
    if (!modelConfigId) {
      setNotice("请先保存并选择一个模型配置。");
      return;
    }

    const projectHint = getConversationProjectHint();
    const conversationId = await ensureConversation(projectHint);
    
    try {
      for (const filePath of supportedPaths) {
        const fileName = filePath.split(/[/\\]/).pop() || "unknown";
        setIndexingRagFileName(fileName);
        
        const fileData = await readAbsoluteFile(filePath);
        
        await indexRagFile({
          conversation_id: conversationId,
          name: fileData.name || fileName,
          mime: "text/plain",
          size: fileData.size || 0,
          content: fileData.content,
          model_config_id: modelConfigId
        });
      }
      await refreshRagFiles(conversationId);
      setNotice(`已索引 ${supportedPaths.length} 个文件到当前对话。`);
    } catch (error) {
      console.error("Failed to index dropped files:", error);
      setNotice(`文件索引失败：${String(error)}`);
    } finally {
      setIndexingRagFileName("");
      setIsRagDragging(false);
    }
  }

  async function handleDeleteRagFile(id: string) {
    try {
      await deleteRagFile(id);
      if (activeConversationId) {
        await refreshRagFiles(activeConversationId);
      }
    } catch (error) {
      console.error("Failed to delete RAG file:", error);
      setNotice(`删除文件索引失败：${String(error)}`);
    }
  }

  async function loadRagMatches(
    conversationId: string,
    queryText: string,
    modelConfigId: string
  ): Promise<RagChunkMatch[]> {
    if (!conversationId || !queryText.trim() || !modelConfigId || ragFiles.length === 0) {
      return [];
    }

    try {
      return await searchRagContext(conversationId, queryText, modelConfigId, 6);
    } catch (error) {
      console.error("Failed to search RAG context:", error);
      setNotice(`文件检索失败，将跳过 RAG 上下文：${String(error)}`);
      return [];
    }
  }

  async function loadArchivedPreview(conversationId: string) {
    setPreviewArchivedId(conversationId);
    try {
      setPreviewMessages(await listMessages(conversationId));
    } catch (error) {
      setNotice(String(error));
      setPreviewMessages([]);
    }
  }

  async function handleInputChange(value: string, cursorIndex: number) {
    setChatInput(value);

    const textBeforeCursor = value.substring(0, cursorIndex);
    const lastHashIndex = textBeforeCursor.lastIndexOf("#");

    if (lastHashIndex !== -1) {
      const charBeforeHash = lastHashIndex > 0 ? textBeforeCursor[lastHashIndex - 1] : "";
      const isWordStart = lastHashIndex === 0 || /\s/.test(charBeforeHash);
      const textAfterHash = textBeforeCursor.substring(lastHashIndex + 1);

      if (isWordStart && !/\s/.test(textAfterHash)) {
        setPromptTriggerIndex(lastHashIndex);
        try {
          const allPrompts = await listItems("prompt");
          const search = textAfterHash.toLowerCase();
          const filtered = allPrompts.filter((p) =>
            p.title.toLowerCase().includes(search) ||
            p.body.toLowerCase().includes(search)
          );
          setPromptSuggestions(filtered);
          setSelectedPromptIndex(0);
        } catch (e) {
          console.error("Failed to list prompts", e);
        }
        return;
      }
    }

    setPromptSuggestions([]);
    setPromptTriggerIndex(-1);
  }

  function insertPrompt(prompt: Item) {
    if (promptTriggerIndex === -1) return;

    const textarea = document.querySelector(".chat-input textarea") as HTMLTextAreaElement | null;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const value = chatInput;

    const before = value.substring(0, promptTriggerIndex);
    const after = value.substring(selectionStart);
    const newValue = before + prompt.body + after;

    setChatInput(newValue);
    setPromptSuggestions([]);
    setPromptTriggerIndex(-1);

    const newCursorIndex = promptTriggerIndex + prompt.body.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorIndex, newCursorIndex);
    }, 0);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (promptSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = (selectedPromptIndex + 1) % promptSuggestions.length;
        setSelectedPromptIndex(nextIndex);
        setTimeout(() => {
          const activeEl = document.querySelector(".prompt-suggestion-item.selected");
          if (activeEl) {
            activeEl.scrollIntoView({ block: "nearest" });
          }
        }, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = (selectedPromptIndex - 1 + promptSuggestions.length) % promptSuggestions.length;
        setSelectedPromptIndex(nextIndex);
        setTimeout(() => {
          const activeEl = document.querySelector(".prompt-suggestion-item.selected");
          if (activeEl) {
            activeEl.scrollIntoView({ block: "nearest" });
          }
        }, 0);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = promptSuggestions[selectedPromptIndex];
        if (selected) {
          insertPrompt(selected);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setPromptSuggestions([]);
        setPromptTriggerIndex(-1);
      }
    } else {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!busy && chatInput.trim()) {
          void handleSendMessage();
        }
      }
    }
  }

  function handleToggleSkill(id: string, enabled: boolean) {
    const nextSkills = skills.map((s) =>
      s.id === id ? { ...s, enabled } : s
    );
    setSkills(nextSkills);
    localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
  }

  function toggleProjectExpanded(projectId: string) {
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }

  async function refreshProjectConversationMap(projectList = projects) {
    if (projectList.length === 0) {
      setProjectConversations({});
      return;
    }

    const pairs = await Promise.all(
      projectList.map(async (project) => {
        const projectItems = await listConversations(project.path);
        return [project.id, projectItems] as const;
      })
    );
    setProjectConversations(Object.fromEntries(pairs));
  }

  function selectProject(project: ProjectEntry) {
    setActiveProjectId(project.id);
    saveProjects(projects, project.id);
    setExpandedProjectIds((current) => (current.includes(project.id) ? current : [...current, project.id]));
  }

  function findConversationById(conversationId: string) {
    const allProjectConversations = Object.values(projectConversations).flat();
    return [...conversations, ...allProjectConversations].find(
      (conversation) => conversation.id === conversationId
    ) || null;
  }

  function findConversationProject(conversation: Conversation | null) {
    return conversation?.project_path
      ? projects.find((project) => project.path === conversation.project_path) || null
      : null;
  }

  function resolveConversationModelId(conversationId?: string | null) {
    const savedModelId =
      (conversationId ? findConversationById(conversationId)?.model_config_id : activeConversation?.model_config_id) ||
      "";

    if (savedModelId && models.some((model) => model.id === savedModelId)) {
      return savedModelId;
    }

    return activeModelId;
  }

  function upsertProject(path: string) {
    const normalizedPath = path.trim().replace(/[\\/]+$/, "");
    if (!normalizedPath) return;

    const now = new Date().toISOString();
    const existing = projects.find(
      (project) => project.path.toLowerCase() === normalizedPath.toLowerCase()
    );
    const nextProject: ProjectEntry = existing
      ? { ...existing, opened_at: now }
      : {
          id: normalizedPath,
          name: projectNameFromPath(normalizedPath),
          path: normalizedPath,
          opened_at: now
        };
    const nextProjects = [
      nextProject,
      ...projects.filter((project) => project.id !== nextProject.id)
    ];

    setProjects(nextProjects);
    setActiveProjectId(nextProject.id);
    setExpandedProjectIds((current) => (current.includes(nextProject.id) ? current : [...current, nextProject.id]));
    saveProjects(nextProjects, nextProject.id);
    setNotice(`已打开项目：${nextProject.name}`);
  }

  async function handleOpenProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "打开项目"
      });

      if (typeof selected === "string") {
        upsertProject(selected);
      }
    } catch (error) {
      setNotice(`打开项目失败：${String(error)}`);
    }
  }

  async function handleSelectNewProjectParent() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择新项目所在目录"
      });

      if (typeof selected === "string") {
        setNewProjectParent(selected);
      }
    } catch (error) {
      setNotice(`选择目录失败：${String(error)}`);
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!newProjectParent || !name) {
      setNotice("请选择父目录并填写项目名称");
      return;
    }

    try {
      const projectPath = await createProjectDirectory(newProjectParent, name);
      upsertProject(projectPath);
      setShowNewProjectDialog(false);
      setNewProjectParent("");
      setNewProjectName("");
    } catch (error) {
      setNotice(`新建项目失败：${String(error)}`);
    }
  }

  function handleRemoveProjectApproval(project: ProjectEntry) {
    setPendingProjectRemoval(project);
    setProjectApprovalText("");
  }

  function handleConfirmRemoveProject() {
    if (!pendingProjectRemoval || projectApprovalText.trim() !== pendingProjectRemoval.name) {
      return;
    }

    const nextProjects = projects.filter((project) => project.id !== pendingProjectRemoval.id);
    const nextActiveProjectId =
      activeProjectId === pendingProjectRemoval.id ? nextProjects[0]?.id || "" : activeProjectId;

    setProjects(nextProjects);
    setActiveProjectId(nextActiveProjectId);
    setExpandedProjectIds((current) => current.filter((id) => id !== pendingProjectRemoval.id));
    setProjectConversations((current) => {
      const { [pendingProjectRemoval.id]: _, ...rest } = current;
      return rest;
    });
    saveProjects(nextProjects, nextActiveProjectId);
    setPendingProjectRemoval(null);
    setProjectApprovalText("");
    setNotice("项目入口已移除，磁盘文件未删除。");
  }



  async function checkLocalSkills() {
    try {
      const [skillsDir, localSkills] = await listLocalSkills();
      setSkillsDir(skillsDir);
      setSkills((current) => {
        const skillMap = new Map(current.map((s) => [s.id, s]));
        const scannedLocalIds = new Set<string>();

        localSkills.forEach((localSkill) => {
          const id = `local_${localSkill.slug}`;
          scannedLocalIds.add(id);

          if (!skillMap.has(id)) {
            skillMap.set(id, {
              id,
              name: localSkill.name,
              provider: "Local",
              description: localSkill.description,
              enabled: true,
              parameters: {
                workspace_root: "C:\\Users\\13439\\Desktop"
              },
              docUrl: localSkill.doc_url
            });
          } else {
            const existing = skillMap.get(id);
            if (existing) {
              skillMap.set(id, {
                ...existing,
                name: localSkill.name || existing.name,
                description: localSkill.description || existing.description,
                docUrl: localSkill.doc_url || existing.docUrl
              });
            }
          }
        });

        // Remove local skills that are no longer in the directory
        Array.from(skillMap.keys()).forEach((id) => {
          if (id.startsWith("local_") && !scannedLocalIds.has(id)) {
            skillMap.delete(id);
          }
        });

        // Update default skill_creator's skills_root parameter dynamically
        const skillCreator = skillMap.get("skill_creator");
        if (skillCreator && skillCreator.parameters.skills_root !== skillsDir) {
          skillMap.set("skill_creator", {
            ...skillCreator,
            parameters: {
              ...skillCreator.parameters,
              skills_root: skillsDir
            }
          });
        }

        const merged = Array.from(skillMap.values());
        localStorage.setItem("nano-agent-skills", JSON.stringify(merged));
        return merged;
      });
    } catch (error) {
      console.error("Failed to check local skills:", error);
    }
  }

  async function handleSaveTavilyApiKey() {
    setIsSavingTavilyApiKey(true);
    try {
      await saveTavilyApiKey(tavilyApiKey);
      setTavilyApiKey(tavilyApiKey.trim());
      if (tavilyApiKey.trim() && envStatus.tavily_cli === false) {
        setNotice("Tavily API Key 已保存，但未检测到 Tavily CLI，请先安装 tavily-cli。");
      } else {
        setNotice(tavilyApiKey.trim() ? "Tavily API Key 已保存。" : "Tavily API Key 已清空。");
      }
    } catch (error) {
      console.error("Failed to save Tavily API key:", error);
      setNotice(`保存 Tavily API Key 失败：${String(error)}`);
    } finally {
      setIsSavingTavilyApiKey(false);
    }
  }

  async function runEnvCheck() {
    setIsCheckingEnv(true);
    try {
      const status = await checkEnv(nodePath, pythonPath);
      setEnvStatus(status);
      return status;
    } catch (e) {
      console.error("Failed to check environment:", e);
      return { node: false, python: false, tavily_cli: false };
    } finally {
      setIsCheckingEnv(false);
    }
  }

  async function handleInstallTavilyCli() {
    setIsInstallingEnv(true);
    setEnvInstallProgress("正在安装 Tavily CLI...");
    try {
      const ok = await installEnv("tavily");
      if (!ok) {
        throw new Error("Tavily CLI 安装失败");
      }

      setEnvInstallProgress("安装完成，正在验证 Tavily CLI...");
      const finalStatus = await checkEnv(nodePath, pythonPath);
      setEnvStatus(finalStatus);
      if (finalStatus.tavily_cli) {
        setNotice("Tavily CLI 安装成功。");
      } else {
        setNotice("Tavily CLI 已尝试安装，但当前 PATH 仍未检测到 tvly。请重启 NanoAgent 或检查 Python Scripts/uv tool 目录是否在 PATH。");
      }
    } catch (error) {
      console.error("Tavily CLI installation failed:", error);
      setNotice(`Tavily CLI 安装失败：${String(error)}`);
    } finally {
      setIsInstallingEnv(false);
      setEnvInstallProgress("");
    }
  }

  async function handleAutoInstallMissing() {
    setIsInstallingEnv(true);
    setEnvInstallProgress("正在准备安装环境...");
    try {
      const status = await checkEnv(nodePath, pythonPath);
      if (!status.node) {
        setEnvInstallProgress("正在静默安装 Node.js，这可能需要 1-3 分钟，请稍候...");
        const ok = await installEnv("node");
        if (!ok) {
          throw new Error("Node.js 安装失败");
        }
      }
      if (!status.python) {
        setEnvInstallProgress("正在静默安装 Python 3，这可能需要 1-3 分钟，请稍候...");
        const ok = await installEnv("python");
        if (!ok) {
          throw new Error("Python 3 安装失败");
        }
      }
      
      setEnvInstallProgress("安装完成！正在验证环境...");
      const finalStatus = await checkEnv(nodePath, pythonPath);
      setEnvStatus(finalStatus);
      
      if (finalStatus.node && finalStatus.python) {
        setNotice("环境自动配置成功！");
        localStorage.setItem("nano-agent-env-checked", "true");
        setShowEnvPrompt(false);
      } else {
        let errMsg = "部分环境未成功配置：";
        if (!finalStatus.node) errMsg += "Node.js ";
        if (!finalStatus.python) errMsg += "Python ";
        setNotice(errMsg + "。您也可以选择配置已有路径。");
      }
    } catch (e) {
      console.error("Environment installation failed:", e);
      setNotice(`环境自动安装失败: ${String(e)}。请尝试手动配置已有路径。`);
    } finally {
      setIsInstallingEnv(false);
      setEnvInstallProgress("");
    }
  }

  async function handleSaveCustomPaths() {
    localStorage.setItem("nano-agent-node-path", nodePath);
    localStorage.setItem("nano-agent-python-path", pythonPath);
    
    setIsCheckingEnv(true);
    try {
      const status = await checkEnv(nodePath, pythonPath);
      setEnvStatus(status);
      if (status.node && status.python) {
        localStorage.setItem("nano-agent-env-checked", "true");
        setShowEnvPrompt(false);
        setNotice("环境路径验证通过并保存成功！");
      } else {
        let msg = "已保存，但检测到：";
        if (!status.node) msg += "Node.js 路径无效或未找到；";
        if (!status.python) msg += "Python 路径无效或未找到；";
        setNotice(msg + "请重新确认路径。");
      }
    } catch (e) {
      setNotice(`路径检测失败: ${String(e)}`);
    } finally {
      setIsCheckingEnv(false);
    }
  }



  function handleDeleteSkill(id: string) {
    if (isBuiltInSkill(id)) {
      setNotice("系统内置技能只能禁用，不能删除。");
      return;
    }

    if (confirm("确定要删除该技能吗？")) {
      const nextSkills = skills.filter((s) => s.id !== id);
      setSkills(nextSkills);
      localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
      if (selectedSkillId === id) {
        setSelectedSkillId(nextSkills.length > 0 ? nextSkills[0].id : "");
      }
      setNotice("技能已成功删除！");
    }
  }

  function handleSaveNewSkill() {
    if (!newSkillDraft.id || !newSkillDraft.name) {
      alert("请填写技能ID和技能名称！");
      return;
    }
    
    if (skills.some((s) => s.id === newSkillDraft.id)) {
      alert("该技能ID已存在，请使用其他ID！");
      return;
    }

    const newSkill: Skill = {
      id: newSkillDraft.id,
      name: newSkillDraft.name,
      provider: "Custom",
      description: newSkillDraft.description || "自定义导入的技能工具。",
      enabled: true,
      parameters: {},
      docUrl: newSkillDraft.docUrl
    };

    const nextSkills = [...skills, newSkill];
    setSkills(nextSkills);
    localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
    
    setIsAddingSkill(false);
    setSelectedSkillId(newSkill.id);
    
    setNewSkillDraft({
      id: "",
      name: "",
      provider: "Custom",
      description: "",
      docUrl: ""
    });

    setNotice("自定义技能添加成功！");
  }

  async function refreshConversations(selectId?: string) {
    const [nextConversations, nextArchivedConversations] = await Promise.all([
      listConversations(),
      listArchivedConversations()
    ]);
    setConversations(nextConversations);
    setArchivedConversations(nextArchivedConversations);
    if (selectId) {
      setActiveConversationId(selectId);
    } else if (!nextConversations.some((conversation) => conversation.id === activeConversationId)) {
      setActiveConversationId(nextConversations[0]?.id || "");
    }
  }

  async function refreshItems(nextQuery = query, kind = activeKind) {
    const requestId = ++listRequestRef.current;

    try {
      if (kind === "memory") {
        const nextMemories = await loadVisibleMemories(nextQuery);
        if (requestId !== listRequestRef.current) {
          return;
        }
        setMemoryItems(nextMemories);
        setSelectedMemoryId((current) =>
          nextMemories.some((memory) => memory.id === current)
            ? current
            : nextMemories[0]?.id || ""
        );
        return;
      }

      const nextItems = nextQuery.trim()
        ? await searchItems(nextQuery)
        : await listItems(kind === "all" ? undefined : kind);
      if (requestId !== listRequestRef.current) {
        return;
      }
      setItems(nextItems);
      setSelectedId((current) =>
        nextItems.some((item) => item.id === current)
          ? current
          : nextItems[0]?.id || ""
      );
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function loadVisibleMemories(nextQuery: string) {
    if (nextQuery.trim()) {
      return searchMemories(nextQuery);
    }

    const allMemories = await listMemories();
    if (allMemories.length > 0) {
      return allMemories;
    }

    return listEnabledMemories();
  }

  function handleKindChange(kind: WorkspaceView) {
    setActiveKind(kind);
    setQuery("");
    if (kind === "memory") {
      setSelectedMemoryId("");
    } else {
      setSelectedId("");
    }
  }

  function handleSearch(value: string) {
    setQuery(value);
  }

  function beginWorkspaceSplitResize() {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    beginResize((event) => {
      const nextRatio = ((event.clientY - rect.top) / rect.height) * 100;
      setWorkspaceListRatio(Math.min(70, Math.max(24, nextRatio)));
    }, "row-resize");
  }

  function beginResize(onMove: (event: MouseEvent) => void, cursor = "col-resize") {
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = cursor;
    document.body.classList.add("is-resizing");

    const handleMove = (event: MouseEvent) => {
      event.preventDefault();
      onMove(event);
    };
    const handleUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  async function handleNewItem(kind: ItemKind) {
    const item = await createItem({
      kind,
      title: `新建${kindLabels[kind]}`,
      body: "",
      status: "active",
      tags: []
    });
    setActiveKind(kind);
    setQuery("");
    await refreshItems("", kind);
    setSelectedId(item.id);
  }

  async function handleSaveItem() {
    if (!selectedItem) {
      return;
    }

    await updateItem({
      id: selectedItem.id,
      title,
      body,
      status,
      tags: parseTags(tagsText)
    });

    await refreshItems(query, activeKind);
    setNotice("已保存");
  }

  async function handleSaveMemory() {
    if (!selectedMemory) {
      return;
    }

    await updateMemory({
      id: selectedMemory.id,
      title: memoryTitle,
      content: memoryContent,
      tags: parseTags(memoryTagsText),
      enabled: memoryEnabled
    });

    await refreshItems(query, "memory");
    setNotice("记忆已保存");
  }

  async function handleDeleteItem() {
    if (!selectedItem) {
      return;
    }

    await deleteItem(selectedItem.id);
    setSelectedId("");
    await refreshItems(query, activeKind);
  }

  async function handleDeleteMemory() {
    if (!selectedMemory) {
      return;
    }

    await deleteMemory(selectedMemory.id);
    setSelectedMemoryId("");
    await refreshItems(query, "memory");
  }

  async function handleSaveModel() {
    const saved = await saveModelConfig(modelDraft);
    const nextModels = await listModelConfigs();
    setModels(nextModels);
    setActiveModelId(saved.id);
    setModelDraft(normalizeModelDraft(saved));
    setNotice("模型配置已保存");
  }

  async function handleEditModel(id: string) {
    if (!id) {
      setModelDraft(emptyModelDraft);
      return;
    }
    const model = models.find((item) => item.id === id);
    if (model) {
      setModelDraft(normalizeModelDraft(model));
    }
  }

  function handleOpenModelConfig() {
    const model = models.find((item) => item.id === activeModelId) || models.find((item) => item.id !== "embedding-config");
    setModelDraft(model ? normalizeModelDraft(model) : emptyModelDraft);
    setShowModelConfig(true);
  }

  function handleNewModelConfig() {
    setModelDraft(emptyModelDraft);
    setShowModelConfig(true);
  }

  async function handleDeleteModel() {
    if (!modelDraft.id) {
      setModelDraft(emptyModelDraft);
      return;
    }

    await deleteModelConfig(modelDraft.id);
    const nextModels = await listModelConfigs();
    setModels(nextModels);
    if (modelDraft.id === activeModelId) {
      setActiveModelId(nextModels.find((m) => m.id !== "embedding-config")?.id || "");
    }
    setModelDraft(emptyModelDraft);
  }

  function handleProviderChange(provider: string) {
    const defaults = providerDefaults[provider];
    setModelDraft((current) => ({
      ...current,
      provider,
      base_url:
        current.base_url === providerDefaults["openai-compatible"].base_url ||
        current.base_url === providerDefaults.anthropic.base_url
          ? defaults.base_url
          : current.base_url,
      model:
        current.model === providerDefaults["openai-compatible"].model ||
        current.model === providerDefaults.anthropic.model
          ? defaults.model
          : current.model,
    }));
  }

  function handleEmbeddingProviderChange(embeddingProvider: string) {
    const defaults = embeddingProviderDefaults[embeddingProvider];
    setEmbeddingDraft((current) => ({
      ...current,
      embedding_provider: embeddingProvider,
      embedding_base_url:
        current.embedding_base_url === embeddingProviderDefaults["openai-compatible"].embedding_base_url
          ? defaults.embedding_base_url
          : current.embedding_base_url,
      embedding_model:
        current.embedding_model === embeddingProviderDefaults["openai-compatible"].embedding_model
          ? defaults.embedding_model
          : current.embedding_model
    }));
  }

  async function handleSaveEmbeddingModel() {
    const updatedDraft = {
      ...embeddingDraft,
      id: "embedding-config",
      name: "嵌入模型",
      provider: embeddingDraft.embedding_provider,
      base_url: embeddingDraft.embedding_base_url,
      model: embeddingDraft.embedding_model,
      api_key: embeddingDraft.embedding_api_key,
    };
    const saved = await saveModelConfig(updatedDraft);
    const nextModels = await listModelConfigs();
    setModels(nextModels);
    setEmbeddingDraft(normalizeModelDraft(saved));
    setNotice("嵌入模型配置已保存");
  }

  function handleOpenEmbeddingConfig() {
    const existing = models.find((m) => m.id === "embedding-config");
    setEmbeddingDraft(existing ? normalizeModelDraft(existing) : emptyEmbeddingDraft);
  }

  async function handleTestLlm() {
    const modelId = modelDraft.id || "new-config";
    setLlmTestStatus({ status: "testing" });
    setModelTestStatuses((prev) => ({
      ...prev,
      [modelId]: { status: "testing" }
    }));
    try {
      await testLlmConnectivity(modelDraft);
      setLlmTestStatus({ status: "success" });
      setModelTestStatuses((prev) => ({
        ...prev,
        [modelId]: { status: "success" }
      }));
    } catch (err: any) {
      setLlmTestStatus({ status: "error", message: String(err) });
      setModelTestStatuses((prev) => ({
        ...prev,
        [modelId]: { status: "error", message: String(err) }
      }));
    }
  }

  async function handleTestEmbedding() {
    setEmbeddingTestStatus({ status: "testing" });
    try {
      const updatedDraft = {
        ...embeddingDraft,
        id: "embedding-config",
        name: "嵌入模型",
        provider: embeddingDraft.embedding_provider,
        base_url: embeddingDraft.embedding_base_url,
        model: embeddingDraft.embedding_model,
        api_key: embeddingDraft.embedding_api_key,
      };
      await testEmbeddingConnectivity(updatedDraft);
      setEmbeddingTestStatus({ status: "success" });
    } catch (err: any) {
      setEmbeddingTestStatus({ status: "error", message: String(err) });
    }
  }

  async function handleActiveModelChange(modelId: string) {
    setActiveModelId(modelId);
    if (activeConversationId) {
      try {
        await updateConversationModel(activeConversationId, modelId || null);
        setConversations((current) =>
          current.map((c) => (c.id === activeConversationId ? { ...c, model_config_id: modelId || null } : c))
        );
      } catch (error) {
        setNotice(String(error));
      }
    }
  }

  async function createConversationForCurrentScope(project: ProjectEntry | null) {
    const conversation = await createConversation({
      model_config_id: activeModelId || null,
      project_path: project?.path || null
    });

    if (project) {
      await refreshProjectConversationMap(projects);
    } else {
      await refreshConversations(conversation.id);
    }
    return conversation;
  }

  function resolveConversationProject(
    conversationId: string,
    projectHint: ProjectEntry | null = null
  ) {
    return findConversationProject(findConversationById(conversationId)) || projectHint;
  }

  function getConversationProjectHint() {
    return activeConversationId ? activeConversationProject : activeProject;
  }

  async function handleNewConversation() {
    const conversation = await createConversationForCurrentScope(null);
    setActiveConversationId(conversation.id);
    setMessages([]);
  }

  async function handleNewProjectConversation(project: ProjectEntry) {
    selectProject(project);
    const conversation = await createConversationForCurrentScope(project);
    setActiveConversationId(conversation.id);
    setMessages([]);
  }

  async function handleDeleteConversation() {
    if (!activeConversationId) {
      return;
    }

    const isProjectConversation = Boolean(activeConversation?.project_path);
    await deleteConversation(activeConversationId);
    if (isProjectConversation) {
      await refreshProjectConversationMap(projects);
      setActiveConversationId("");
    } else {
      const rest = conversations.filter((item) => item.id !== activeConversationId);
      setConversations(rest);
      setActiveConversationId(rest[0]?.id || "");
    }
  }

  async function handleArchiveConversation() {
    if (!activeConversationId) {
      return;
    }

    const isProjectConversation = Boolean(activeConversation?.project_path);
    await archiveConversation(activeConversationId, true);
    if (isProjectConversation) {
      await refreshProjectConversationMap(projects);
      setActiveConversationId("");
    } else {
      const rest = conversations.filter((item) => item.id !== activeConversationId);
      setConversations(rest);
      setActiveConversationId(rest[0]?.id || "");
    }
    setMessages([]);
    if (!isProjectConversation) {
      await refreshConversations(conversations.filter((item) => item.id !== activeConversationId)[0]?.id);
    }
  }

  async function handleRestoreConversation(conversation: Conversation) {
    await archiveConversation(conversation.id, false);
    await refreshConversations(conversation.id);
    setShowModelConfig(false);
    await loadMessages(conversation.id);
  }

  async function handleRenameConversation(id: string, currentTitle: string) {
    const nextTitle = prompt("请输入新的会话名称：", currentTitle);
    if (nextTitle === null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed) {
      alert("会话名称不能为空");
      return;
    }
    try {
      await renameConversation(id, trimmed);
      await Promise.all([
        refreshConversations(),
        refreshProjectConversationMap(projects)
      ]);
    } catch (e) {
      console.error(e);
      alert("重命名失败");
    }
  }

  async function handleContextArchiveConversation(conversation: Conversation) {
    try {
      await archiveConversation(conversation.id, true);
      const isProjectConversation = Boolean(conversation.project_path);
      
      if (activeConversationId === conversation.id) {
        if (isProjectConversation) {
          await refreshProjectConversationMap(projects);
          setActiveConversationId("");
          setMessages([]);
        } else {
          const rest = conversations.filter((item) => item.id !== conversation.id);
          setConversations(rest);
          const nextActiveId = rest[0]?.id || "";
          setActiveConversationId(nextActiveId);
          setMessages([]);
          await refreshConversations(nextActiveId);
        }
      } else {
        await Promise.all([
          refreshConversations(),
          refreshProjectConversationMap(projects)
        ]);
      }
    } catch (e) {
      console.error(e);
      alert("归档失败");
    }
  }

  async function handleContextDeleteConversation(conversation: Conversation) {
    if (!confirm(`确定要删除会话「${conversation.title}」吗？`)) {
      return;
    }
    try {
      await deleteConversation(conversation.id);
      const isProjectConversation = Boolean(conversation.project_path);
      
      if (activeConversationId === conversation.id) {
        if (isProjectConversation) {
          await refreshProjectConversationMap(projects);
          setActiveConversationId("");
          setMessages([]);
        } else {
          const rest = conversations.filter((item) => item.id !== conversation.id);
          setConversations(rest);
          const nextActiveId = rest[0]?.id || "";
          setActiveConversationId(nextActiveId);
          setMessages([]);
          await refreshConversations(nextActiveId);
        }
      } else {
        await Promise.all([
          refreshConversations(),
          refreshProjectConversationMap(projects)
        ]);
      }
    } catch (e) {
      console.error(e);
      alert("删除失败");
    }
  }

  function handleContextMenu(e: React.MouseEvent, conversation: Conversation) {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true,
      conversation,
      project: null
    });
  }

  function handleProjectContextMenu(e: React.MouseEvent, project: ProjectEntry) {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true,
      conversation: null,
      project
    });
  }

  function handleCloseConversation() {
    setActiveConversationId("");
    setMessages([]);
  }

  useEffect(() => {
    const handleCloseMenu = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener("click", handleCloseMenu);
    return () => {
      window.removeEventListener("click", handleCloseMenu);
    };
  }, [contextMenu.visible]);

  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleGlobalContextMenu);
    };
  }, []);

  async function handleDeleteArchivedConversation(conversation: Conversation) {
    if (!confirm(`Delete conversation "${conversation.title}"?`)) {
      return;
    }

    await deleteConversation(conversation.id);
    setArchivedConversations((current) => current.filter((item) => item.id !== conversation.id));
    if (activeConversationId === conversation.id) {
      setActiveConversationId("");
      setMessages([]);
    }
    if (previewArchivedId === conversation.id) {
      setPreviewArchivedId("");
      setPreviewMessages([]);
    }
  }

  async function ensureConversation(project: ProjectEntry | null) {
    if (activeConversationId) {
      return activeConversationId;
    }

    const conversation = await createConversationForCurrentScope(project);
    setActiveConversationId(conversation.id);
    return conversation.id;
  }

  const [executingToolMessageId, setExecutingToolMessageId] = useState<string | null>(null);
  const [messageToolCalls, setMessageToolCalls] = useState<Record<string, AgentToolCall>>({});
  const [conversationRunIds, setConversationRunIds] = useState<Record<string, string>>({});

  async function triggerLlmContinue(
    conversationId: string,
    currentMessages: PersistedMessage[],
    projectHint: ProjectEntry | null = null,
    runId?: string | null
  ) {
    const projectForRequest = resolveConversationProject(conversationId, projectHint);
    const modelConfigId = resolveConversationModelId(conversationId);
    const enabledMemories = await listEnabledMemories();
    let projectFiles: ProjectFileEntry[] = [];
    if (projectForRequest?.path) {
      try {
        projectFiles = await listProjectFiles(projectForRequest.path);
      } catch (error) {
        console.error("Failed to list project files:", error);
      }
    }
    const retrievalQuery =
      [...currentMessages].reverse().find((message) => message.role === "user")?.content || "";
    const ragMatches = await loadRagMatches(conversationId, retrievalQuery, modelConfigId);

    const modelMessages: ChatMessage[] = [
      buildSystemMessage(
        enabledMemories,
        projectForRequest,
        projectFiles,
        skills,
        mcpServers,
        ragMatches,
        tempDir
      ),
      ...currentMessages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ];

    const requestId = crypto.randomUUID();
    let streamedContent = "";
    let streamedReasoning = "";
    let streamFailed = false;
    const temporaryAssistantMessage: PersistedMessage = {
      id: requestId,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString()
    };
    setMessages([...currentMessages, temporaryAssistantMessage]);

    const unlisten = await listen<ChatStreamEvent>("chat-stream", (event) => {
      if (event.payload.request_id !== requestId) return;
      if (activeConversationIdRef.current !== conversationId) return;

      if (event.payload.type === "delta") {
        streamedContent += event.payload.content;
        setMessages((current) =>
          current.map((message) =>
            message.id === requestId
              ? { ...message, content: streamedContent }
              : message
          )
        );
      }

      if (event.payload.type === "reasoning_delta") {
        streamedReasoning += event.payload.content;
        setMessageReasoning((current) => ({
          ...current,
          [requestId]: streamedReasoning
        }));
      }

      if (event.payload.type === "error") {
        streamFailed = true;
        setNotice(event.payload.message);
      }
    });

    try {
      setBusy(true);
      if (runId) {
        void safeRecordAgentStep({
          run_id: runId,
          kind: "model_continue",
          status: "running",
          input_summary: `messages=${modelMessages.length}`,
          metadata_json: JSON.stringify({ conversation_id: conversationId })
        });
      }
      await chatStream(requestId, modelConfigId, modelMessages, 0.4, conversationId);
    } catch (err) {
      streamFailed = true;
      console.error("Continue streaming failed:", err);
      setNotice(`Conversation reply failed: ${String(err)}`);
      if (runId) {
        void safeRecordAgentStep({
          run_id: runId,
          kind: "model_continue",
          status: "failed",
          input_summary: `messages=${modelMessages.length}`,
          output_summary: String(err)
        });
        void safeFinishAgentRun(runId, "failed", String(err));
      }
    } finally {
      unlisten();
      setBusy(false);
      let assistantMessage: PersistedMessage | null = null;
      if (!streamFailed && streamedContent.trim()) {
        assistantMessage = await appendMessage({
          conversation_id: conversationId,
          role: "assistant",
          content: streamedContent
        });
      }
      if (runId && assistantMessage) {
        const resolution = await safeResolveAgentModelOutput(
          runId,
          assistantMessage.id,
          streamedContent,
          "model_continue",
          `messages=${modelMessages.length}`
        );
        if (resolution?.tool_call) {
          setMessageToolCalls((current) => ({
            ...current,
            [assistantMessage.id]: resolution.tool_call as AgentToolCall
          }));
        } else if (resolution?.status === "completed") {
          setConversationRunIds((current) => {
            const { [conversationId]: _, ...rest } = current;
            return rest;
          });
        }
      }
      const finalMessages = await listMessages(conversationId);
      setMessages(finalMessages);
      if (assistantMessage && streamedReasoning.trim()) {
        setMessageReasoning((current) => {
          const { [requestId]: _, ...rest } = current;
          return {
            ...rest,
            [assistantMessage.id]: streamedReasoning
          };
        });
      } else {
        setMessageReasoning((current) => {
          const { [requestId]: _, ...rest } = current;
          return rest;
        });
      }
      if (projectForRequest) {
        await refreshProjectConversationMap(projects);
      } else {
        await refreshConversations(conversationId);
      }
    }
  }

  async function handleExecuteTool(messageId: string, toolCall: ParsedToolCall) {
    if (executingToolMessageId) return;
    setExecutingToolMessageId(messageId);
    setBusy(true);
    let activeRunId: string | null = null;
    let activeToolCall: AgentToolCall | null = messageToolCalls[messageId] || null;

    try {
      const projectHint = getConversationProjectHint();
      const conversationId = await ensureConversation(projectHint);
      const projectForRequest = resolveConversationProject(conversationId, projectHint);
      const projectPath = projectForRequest?.path || tempDir;
      activeRunId = activeToolCall?.run_id || conversationRunIds[conversationId] || null;
      if (!activeRunId) {
        const run = await safeCreateAgentRun({
          conversation_id: conversationId,
          project_path: projectForRequest?.path || null,
          model_config_id: resolveConversationModelId(conversationId) || null,
          trigger_message_id: messageId
        });
        activeRunId = run?.id || null;
      }
      if (activeRunId && !activeToolCall) {
        activeToolCall = await safeCreateAgentToolCall({
          run_id: activeRunId,
          message_id: messageId,
          name: toolCall.name,
          args_json: JSON.stringify(toolCall.args)
        });
        if (activeToolCall) {
          const storedToolCall = activeToolCall;
          setMessageToolCalls((current) => ({
            ...current,
            [messageId]: storedToolCall
          }));
        }
      }
      if (activeRunId) {
        setConversationRunIds((current) => ({
          ...current,
          [conversationId]: activeRunId as string
        }));
      }
      if (!activeToolCall) {
        throw new Error("工具调用记录创建失败");
      }
      const approvedToolCall = await safeApproveAgentToolCall(activeToolCall.id);
      if (!approvedToolCall) {
        throw new Error("工具审批失败");
      }
      activeToolCall = approvedToolCall;
      setMessageToolCalls((current) => ({
        ...current,
        [messageId]: approvedToolCall
      }));
      const isBashEnabled = skills.find((s) => s.id === "bash_tool")?.enabled === true;
      const execution = await safeExecuteAgentToolCall({
        tool_call_id: activeToolCall.id,
        project_path: projectPath,
        allow_command: isBashEnabled
      });
      if (!execution) {
        throw new Error("工具执行失败");
      }
      activeToolCall = execution.tool_call;
      setMessageToolCalls((current) => ({
        ...current,
        [messageId]: execution.tool_call
      }));
      const resultText = execution.result_text;

      const userMessage = await appendMessage({
        conversation_id: conversationId,
        role: "user",
        content: `[工具执行结果: ${toolCall.name}] 执行结果如下：\n\n${resultText}`
      });

      const updatedMessages = await listMessages(conversationId);
      setMessages(updatedMessages);

      void triggerLlmContinue(conversationId, updatedMessages, projectForRequest, activeRunId);
    } catch (error) {
      console.error("Tool execution failed:", error);
      setNotice(`工具执行失败: ${String(error)}`);
      if (activeRunId) {
        void safeRecordAgentStep({
          run_id: activeRunId,
          kind: "tool",
          status: "failed",
          input_summary: toolCall.name,
          output_summary: String(error),
          metadata_json: JSON.stringify({ message_id: messageId })
        });
      }
      if (activeToolCall) {
        const updatedToolCall = await safeUpdateAgentToolCall(
          activeToolCall.id,
          "failed",
          null,
          String(error)
        );
        if (updatedToolCall) {
          setMessageToolCalls((current) => ({
            ...current,
            [messageId]: updatedToolCall
          }));
        }
      }
      
      try {
        const projectHint = getConversationProjectHint();
        const conversationId = await ensureConversation(projectHint);
        const projectForRequest = resolveConversationProject(conversationId, projectHint);
        await appendMessage({
          conversation_id: conversationId,
          role: "user",
          content: `[工具执行结果: ${toolCall.name}] 执行失败: ${String(error)}`
        });
        const updatedMessages = await listMessages(conversationId);
        setMessages(updatedMessages);
        void triggerLlmContinue(conversationId, updatedMessages, projectForRequest, activeRunId);
      } catch (e) {
        console.error("Failed to append tool error message:", e);
      }
    } finally {
      setExecutingToolMessageId(null);
      setBusy(false);
    }
  }

  async function handleRejectTool(messageId: string, toolCall: ParsedToolCall) {
    setBusy(true);
    try {
      const projectHint = getConversationProjectHint();
      const conversationId = await ensureConversation(projectHint);
      const projectForRequest = resolveConversationProject(conversationId, projectHint);
      let activeRunId = messageToolCalls[messageId]?.run_id || conversationRunIds[conversationId] || null;
      let activeToolCall: AgentToolCall | null = messageToolCalls[messageId] || null;
      if (!activeRunId) {
        const run = await safeCreateAgentRun({
          conversation_id: conversationId,
          project_path: projectForRequest?.path || null,
          model_config_id: resolveConversationModelId(conversationId) || null,
          trigger_message_id: messageId
        });
        activeRunId = run?.id || null;
      }
      if (activeRunId && !activeToolCall) {
        activeToolCall = await safeCreateAgentToolCall({
          run_id: activeRunId,
          message_id: messageId,
          name: toolCall.name,
          args_json: JSON.stringify(toolCall.args)
        });
      }
      if (activeToolCall) {
        const updatedToolCall = await safeRejectAgentToolCall(activeToolCall.id, "user_rejected");
        if (updatedToolCall) {
          setMessageToolCalls((current) => ({
            ...current,
            [messageId]: updatedToolCall
          }));
        }
      }
      if (activeRunId) {
        setConversationRunIds((current) => {
          const { [conversationId]: _, ...rest } = current;
          return rest;
        });
      }
      await appendMessage({
        conversation_id: conversationId,
        role: "user",
        content: `[工具执行结果: ${toolCall.name}] 用户拒绝了执行该工具请求。`
      });
      const updatedMessages = await listMessages(conversationId);
      setMessages(updatedMessages);
      void triggerLlmContinue(
        conversationId,
        updatedMessages,
        projectForRequest,
        activeRunId
      );
    } catch (error) {
      console.error("Reject tool failed:", error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMessage() {
    const content = chatInput.trim();
    const memoryDraft = extractMemoryDraft(content);
    const effectiveModelId = resolveConversationModelId(activeConversationId);
    const activeModelId = effectiveModelId;

    if (!content || (!activeModelId && !memoryDraft)) {
      setNotice(activeModelId ? "" : "请先保存并选择一个模型");
      return;
    }

    setChatInput("");
    setBusy(true);
    let agentRun: AgentRun | null = null;

    try {
      const projectHint = getConversationProjectHint();
      const conversationId = await ensureConversation(projectHint);
      const projectForRequest = resolveConversationProject(conversationId, projectHint);
      const persistedMessages = await listMessages(conversationId);
      const userMessage = await appendMessage({
        conversation_id: conversationId,
        role: "user",
        content
      });
      agentRun = await safeCreateAgentRun({
        conversation_id: conversationId,
        project_path: projectForRequest?.path || null,
        model_config_id: activeModelId || null,
        trigger_message_id: userMessage.id
      });
      if (agentRun) {
        const runId = agentRun.id;
        setConversationRunIds((current) => ({
          ...current,
          [conversationId]: runId
        }));
        void safeRecordAgentStep({
          run_id: runId,
          kind: "message",
          status: "completed",
          input_summary: `user_chars=${content.length}`,
          output_summary: `message_id=${userMessage.id}`
        });
      }
      const nextMessages = [...persistedMessages, userMessage];
      setMessages(nextMessages);

      if (memoryDraft) {
        const savedMemory = await createMemory(memoryDraft);
        await refreshItems(query, "memory");
        if (activeKind === "memory") {
          setSelectedMemoryId(savedMemory.id);
        }

        const assistantMessage = await appendMessage({
          conversation_id: conversationId,
          role: "assistant",
          content: `系统已按记忆规则写入：${savedMemory.title}`
        });

        setMessages([...nextMessages, assistantMessage]);
        if (agentRun) {
          void safeRecordAgentStep({
            run_id: agentRun.id,
            kind: "memory",
            status: "completed",
            input_summary: savedMemory.title,
            output_summary: `memory_id=${savedMemory.id}`
          });
          void safeFinishAgentRun(agentRun.id, "completed");
        }
        if (projectForRequest) {
          await refreshProjectConversationMap(projects);
        } else {
          await refreshConversations(conversationId);
        }
        return;
      }

      const enabledMemories = await listEnabledMemories();
      let projectFiles: ProjectFileEntry[] = [];
      if (projectForRequest?.path) {
        try {
          projectFiles = await listProjectFiles(projectForRequest.path);
        } catch (error) {
          console.error("Failed to list project files:", error);
          setNotice(`无法读取当前项目文件列表：${String(error)}`);
        }
      }

      let currentMessages = [...nextMessages];
      const KEEP_RECENT_COUNT = 6;
      const COMPRESSION_THRESHOLD = 0.8 * MAX_CONTEXT_TOKENS;

      const totalTokens = currentMessages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);

      if (totalTokens >= COMPRESSION_THRESHOLD && currentMessages.length > KEEP_RECENT_COUNT) {
        try {
          const messagesToCompress = currentMessages.slice(0, currentMessages.length - KEEP_RECENT_COUNT);
          const recentMessages = currentMessages.slice(currentMessages.length - KEEP_RECENT_COUNT);

          if (messagesToCompress.length >= 2) {
            const summaryPrompt = "请简明扼要地对以下对话历史进行上下文摘要（限 150 字内），保留关键事实、用户偏好和核心讨论点，以便作为后续对话的背景。请直接输出摘要，不要有任何多余的解释：\n\n" +
              messagesToCompress.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join("\n");

            const summaryResponse = await chat(activeModelId, [{ role: "user", content: summaryPrompt }], 0.4, conversationId);
            const summaryText = summaryResponse.content.trim();

            if (summaryText) {
              const idsToDelete = messagesToCompress.map(m => m.id);
              await deleteMessages(idsToDelete);

              const summaryMsg = await appendMessage({
                conversation_id: conversationId,
                role: "system",
                content: `【系统上下文摘要（已自动压缩更早的对话历史）】：\n${summaryText}`
              });

              currentMessages = [summaryMsg, ...recentMessages];
              setMessages(currentMessages);
              setNotice("上下文达到 80% 限制，已自动进行历史压缩。");
            }
          }
        } catch (err) {
          console.error("Context compression failed:", err);
          setNotice("上下文压缩失败，将继续发送完整上下文。");
        }
      }

      const ragMatches = await loadRagMatches(conversationId, content, activeModelId);
      const modelMessages: ChatMessage[] = [
        buildSystemMessage(
          enabledMemories,
          projectForRequest,
          projectFiles,
          skills,
          mcpServers,
          ragMatches,
          tempDir
        ),
        ...currentMessages.map((message) => ({
          role: message.role,
          content: message.content
        }))
      ];

      const requestId = crypto.randomUUID();
      let streamedContent = "";
      let streamedReasoning = "";
      const temporaryAssistantMessage: PersistedMessage = {
        id: requestId,
        conversation_id: conversationId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString()
      };
      setMessages([...currentMessages, temporaryAssistantMessage]);

      const unlisten = await listen<ChatStreamEvent>("chat-stream", (event) => {
        if (event.payload.request_id !== requestId) {
          return;
        }
        if (activeConversationIdRef.current !== conversationId) {
          return;
        }

        if (event.payload.type === "delta") {
          streamedContent += event.payload.content;
          setMessages((current) =>
            current.map((message) =>
              message.id === requestId
                ? { ...message, content: streamedContent }
                : message
            )
          );
        }

        if (event.payload.type === "reasoning_delta") {
          streamedReasoning += event.payload.content;
          setMessageReasoning((current) => ({
            ...current,
            [requestId]: streamedReasoning
          }));
        }

        if (event.payload.type === "error") {
          setNotice(event.payload.message);
        }
      });

      if (agentRun) {
        void safeRecordAgentStep({
          run_id: agentRun.id,
          kind: "model",
          status: "running",
          input_summary: `messages=${modelMessages.length}`,
          metadata_json: JSON.stringify({
            model_config_id: activeModelId
          })
        });
      }
      await chatStream(requestId, activeModelId, modelMessages, 0.4, conversationId);
      unlisten();

      if (!streamedContent.trim()) {
        if (agentRun) {
          void safeRecordAgentStep({
            run_id: agentRun.id,
            kind: "model",
            status: "failed",
            input_summary: `messages=${modelMessages.length}`,
            output_summary: "empty_response"
          });
          void safeFinishAgentRun(agentRun.id, "failed", "empty_response");
        }
        setMessages(currentMessages);
        setMessageReasoning((current) => {
          const { [requestId]: _, ...rest } = current;
          return rest;
        });
        return;
      }

      const assistantMessage = await appendMessage({
        conversation_id: conversationId,
        role: "assistant",
        content: streamedContent
      });
      if (agentRun) {
        const resolution = await safeResolveAgentModelOutput(
          agentRun.id,
          assistantMessage.id,
          streamedContent,
          "model",
          `messages=${modelMessages.length}`
        );
        if (resolution?.tool_call) {
          setMessageToolCalls((current) => ({
            ...current,
            [assistantMessage.id]: resolution.tool_call as AgentToolCall
          }));
        } else if (resolution?.status === "completed") {
          setConversationRunIds((current) => {
            const { [conversationId]: _, ...rest } = current;
            return rest;
          });
        }
      }

      if (activeConversationIdRef.current === conversationId) {
        setMessages([...currentMessages, assistantMessage]);
      }
      if (streamedReasoning.trim() && activeConversationIdRef.current === conversationId) {
        setMessageReasoning((current) => {
          const { [requestId]: _, ...rest } = current;
          return {
            ...rest,
            [assistantMessage.id]: streamedReasoning
          };
        });
      }
      if (projectForRequest) {
        await refreshProjectConversationMap(projects);
      } else {
        await refreshConversations(conversationId);
      }
    } catch (error) {
      if (agentRun) {
        void safeRecordAgentStep({
          run_id: agentRun.id,
          kind: "error",
          status: "failed",
          input_summary: "handle_send_message",
          output_summary: String(error)
        });
        void safeFinishAgentRun(agentRun.id, "failed", String(error));
      }
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  }

  function renderWorkspaceGrid() {
    return (
      <section className="settings-workspace-grid" ref={workspaceRef}>
        <section className="list-pane" style={{ flexBasis: "320px" }}>
          <header className="list-header">
            <strong>{workspaceLabels[activeKind]}</strong>
            <span>{activeKind === "memory" ? memoryItems.length : items.length} 条</span>
          </header>
          <div className="search-bar">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => handleSearch(event.target.value)}
              placeholder="搜索"
            />
          </div>

          <div className="item-list">
            {activeKind === "memory" ? (
              <>
                {memoryItems.map((memory) => (
                  <button
                    key={memory.id}
                    className={memory.id === selectedMemoryId ? "item-row selected" : "item-row"}
                    onClick={() => setSelectedMemoryId(memory.id)}
                  >
                    <div className="item-row-header">
                      <span className="badge-memory">记忆</span>
                      <span className="status-indicator">{memory.enabled ? "已启用" : "已禁用"}</span>
                    </div>
                    <strong>{memory.title}</strong>
                    <small>{memory.content || "暂无内容"}</small>
                  </button>
                ))}
                {memoryItems.length === 0 && (
                  <div className="empty">{query.trim() ? "没有匹配的记忆" : "暂无记忆"}</div>
                )}
              </>
            ) : (
              <>
                {items.map((item) => (
                  <button
                    key={item.id}
                    className={item.id === selectedId ? "item-row selected" : "item-row"}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="item-row-header">
                      <span className={`badge-${item.kind}`}>{kindLabels[item.kind as ItemKind] || item.kind}</span>
                      <span className="status-indicator">{statusLabels[item.status] || item.status}</span>
                    </div>
                    <strong>{item.title}</strong>
                    <small>{item.body || "暂无内容"}</small>
                  </button>
                ))}
                {items.length === 0 && <div className="empty">暂无内容</div>}
              </>
            )}
          </div>
          {activeKind !== "memory" && (
            <div style={{ padding: "12px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "center" }}>
              <button
                className="icon-text-btn secondary"
                onClick={() => void handleNewItem(activeKind === "all" ? "note" : activeKind as ItemKind)}
                title={`新建${kindLabels[activeKind as ItemKind] || "笔记"}`}
                aria-label={`新建${kindLabels[activeKind as ItemKind] || "笔记"}`}
                type="button"
              >
                <Plus />
                <span>新建{kindLabels[activeKind as ItemKind] || "笔记"}</span>
              </button>
            </div>
          )}
        </section>

        <section className="editor-pane">
          {activeKind === "memory" ? (
            <>
              <div className="editor-header">
                <label className="memory-toggle">
                  <input
                    type="checkbox"
                    checked={memoryEnabled}
                    onChange={(event) => setMemoryEnabled(event.target.checked)}
                    disabled={!selectedMemory}
                  />
                  在对话中启用
                </label>
                <div className="editor-actions">
                  <button className="icon-text-btn success-btn" onClick={handleSaveMemory} disabled={!selectedMemory} type="button">
                    <Save />
                    <span>保存</span>
                  </button>
                  <button className="icon-text-btn danger-btn" onClick={handleDeleteMemory} disabled={!selectedMemory} type="button">
                    <Trash2 />
                    <span>删除</span>
                  </button>
                </div>
              </div>

              <input
                className="title-input"
                value={memoryTitle}
                onChange={(event) => setMemoryTitle(event.target.value)}
                placeholder="记忆标题"
                disabled={!selectedMemory}
              />
              <textarea
                className="body-input"
                value={memoryContent}
                onChange={(event) => setMemoryContent(event.target.value)}
                placeholder="稳定记录用户偏好、事实背景、工作流规则或项目上下文..."
                disabled={!selectedMemory}
              />
              <input
                className="tag-input"
                value={memoryTagsText}
                onChange={(event) => setMemoryTagsText(event.target.value)}
                placeholder="标签，以英文逗号分隔"
                disabled={!selectedMemory}
              />
            </>
          ) : (
            <>
              <div className="editor-header">
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="active">活跃</option>
                  <option value="todo">待办</option>
                  <option value="done">已完成</option>
                  <option value="archived">已归档</option>
                </select>
                <div className="editor-actions">
                  <button className="icon-text-btn success-btn" onClick={handleSaveItem} disabled={!selectedItem} type="button">
                    <Save />
                    <span>保存</span>
                  </button>
                  <button className="icon-text-btn danger-btn" onClick={handleDeleteItem} disabled={!selectedItem} type="button">
                    <Trash2 />
                    <span>删除</span>
                  </button>
                </div>
              </div>

              <input
                className="title-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="标题"
                disabled={!selectedItem}
              />
              <textarea
                className="body-input"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="在此编写笔记内容..."
                disabled={!selectedItem}
              />
              <input
                className="tag-input"
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="标签，以英文逗号分隔"
                disabled={!selectedItem}
              />
            </>
          )}
        </section>
      </section>
    );
  }

  function renderObservabilityPanel() {
    const toggleTimelineRow = (id: string) => {
      setExpandedObservabilityRows((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      );
    };

    return (
      <div className="settings-tab-content observability-tab-content">
        <div className="observability-header">
          <div>
            <h3>链路追踪</h3>
            <p className="description">查看最近的本地调用链路、耗时和错误状态。</p>
          </div>
          <div className="observability-actions">
            <button className="secondary compact-btn" onClick={() => void refreshObservability()} disabled={isLoadingObservability} type="button">
              <RotateCcw size={14} />
              <span>{isLoadingObservability ? "刷新中" : "刷新"}</span>
            </button>
            <button className="danger compact-btn" onClick={() => void handleClearObservability()} disabled={observabilitySpans.length === 0} type="button">
              <Trash2 size={14} />
              <span>清空</span>
            </button>
          </div>
        </div>

        <div className="observability-grid">
          <aside className="observability-trace-list">
            {traceGroups.map((trace) => (
              <button
                key={trace.traceId}
                className={selectedTrace?.traceId === trace.traceId ? "trace-config-row active" : "trace-config-row"}
                onClick={() => setSelectedTraceId(trace.traceId)}
                type="button"
              >
                <div className="trace-config-row-header">
                  <strong>{trace.lastOperation || "trace"}</strong>
                  <span className={`trace-indicator-badge ${trace.errors > 0 ? "error" : "success"}`}>
                    {trace.errors > 0 ? "有错误" : "正常"}
                  </span>
                </div>
                <span>{trace.traceId} · {trace.spans.length} spans · {trace.duration} ms</span>
              </button>
            ))}
            {traceGroups.length === 0 && (
              <div className="empty">暂无链路记录</div>
            )}
          </aside>

          <section className="observability-span-list">
            <section className="agent-runtime-panel">
              <div
                className="observability-trace-summary clickable"
                onClick={() => setAgentRuntimeCollapsed(!agentRuntimeCollapsed)}
              >
                <div>
                  <strong>Agent Runtime</strong>
                  <span>{activeConversation?.title || "当前会话"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>
                    {activeRunTimeline
                      ? `${agentRunTimelines.length} runs · ${activeRunTimeline.run.status}`
                      : activeConversationId
                        ? "暂无运行记录"
                        : "未选择会话"}
                  </span>
                  {activeRunTimeline && (agentRuntimeCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />)}
                </div>
              </div>
              {activeRunTimeline && !agentRuntimeCollapsed ? (
                <div className="agent-run-timeline">
                  <div className={`agent-run-header ${activeRunTimeline.run.status}`}>
                    <div>
                      <strong>{formatAgentRunTitle(activeRunTimeline.run)}</strong>
                      <span>{activeRunTimeline.run.id}</span>
                    </div>
                    <small>{new Date(activeRunTimeline.run.created_at).toLocaleString()}</small>
                  </div>
                  {activeRunTimelineEvents.map((event) => (
                    <div key={event.id} className={`agent-timeline-row ${event.status}`}>
                      <button
                        className="timeline-row-toggle"
                        onClick={() => toggleTimelineRow(`runtime-${event.id}`)}
                        type="button"
                      >
                        <span className="observability-status-dot" />
                        <span className="timeline-row-copy">
                          <strong>{event.title}</strong>
                          <small>{event.subtitle}</small>
                        </span>
                        <span className="agent-timeline-meta">
                          <span>{formatRuntimeStatus(event.status)}</span>
                          <span>{formatShortTime(event.time)}</span>
                        </span>
                        {expandedObservabilityRows.includes(`runtime-${event.id}`) ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </button>
                      {expandedObservabilityRows.includes(`runtime-${event.id}`) && event.detail && (
                        <div className="timeline-row-detail">
                          <ObservabilityDetailPanel detail={event.detail} />
                        </div>
                      )}
                    </div>
                  ))}
                  {activeRunTimelineEvents.length === 0 && (
                    <div className="empty">该 run 暂无步骤</div>
                  )}
                </div>
              ) : activeRunTimeline ? null : (
                <div className="empty">
                  {activeConversationId ? "当前会话还没有 Agent Runtime 记录" : "选择一个会话后查看 Agent Runtime"}
                </div>
              )}
            </section>

            {selectedTrace ? (
              <>
                <div
                  className="observability-trace-summary clickable"
                  onClick={() => setTraceTimelineCollapsed(!traceTimelineCollapsed)}
                >
                  <div>
                    <strong>{selectedTrace.lastOperation || "chat_stream"}</strong>
                    <span>{selectedTrace.traceId}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>{selectedTrace.spans.length} 条消息 · {formatDuration(selectedTrace.duration)}</span>
                    {traceTimelineCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
                {!traceTimelineCollapsed && (
                  <div className="observability-timeline">
                    {activeTraceTimelineItems.map((span, index) => {
                      const rowId = `span-${span.id}`;
                      const isExpanded = expandedObservabilityRows.includes(rowId);
                      const detail = buildObservabilitySpanDetail(span);

                      return (
                        <div key={span.id} className={`observability-span-row ${span.status}`}>
                          <div className="observability-timeline-marker">
                            <span className="observability-status-dot" />
                            {index < activeTraceTimelineItems.length - 1 && <span className="observability-timeline-line" />}
                          </div>
                          <div className="observability-span-content">
                            <button className="timeline-row-toggle" onClick={() => toggleTimelineRow(rowId)} type="button">
                              <span className="timeline-row-copy">
                                <strong>{span.operation}</strong>
                                <small>{span.category}{span.entity_type ? ` / ${span.entity_type}` : ""}</small>
                              </span>
                              <span className="observability-span-meta">
                                <span>{formatDuration(span.duration_ms ?? 0)}</span>
                                <span>{formatShortTime(span.started_at)}</span>
                              </span>
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            {isExpanded && detail && (
                              <div className="timeline-row-detail">
                                <ObservabilityDetailPanel detail={detail} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {activeTraceTimelineItems.length === 0 && (
                      <div className="empty">该链路暂无消息</div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="archive-preview-placeholder">
                <Activity size={48} className="placeholder-icon" />
                <p>暂无可查看的链路</p>
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <main
      className="app-shell"
      onDragOver={(event) => {
        event.preventDefault();
        setIsRagDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsRagDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsRagDragging(false);
        if (event.dataTransfer && event.dataTransfer.files) {
          void handleRagFiles(event.dataTransfer.files);
        }
      }}
    >
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={22} />
          <div>
            <strong>NanoAgent</strong>
            <span>本地效率助手客户端</span>
          </div>
        </div>

        <div className="sidebar-section projects">
          <div className="sidebar-section-header">
            <div
              className="sidebar-section-toggle"
              onClick={() => setProjectsSectionExpanded(!projectsSectionExpanded)}
            >
              {projectsSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Folder size={16} />
              <span>项目区</span>
            </div>
            <div className="sidebar-section-actions">
              <button className="new-chat-btn" onClick={() => setShowNewProjectDialog(true)} title="新建项目" type="button">
                <Plus size={16} />
              </button>
              <button className="new-chat-btn" onClick={() => void handleOpenProject()} title="打开已有项目" type="button">
                <Folder size={16} />
              </button>
            </div>
          </div>
          {projectsSectionExpanded && (
            <div className="sidebar-project-list">
              {projects.map((project) => {
                const isActiveProject = project.id === activeProjectId;
                const isExpanded = expandedProjectIds.includes(project.id);
                const projectChats = projectConversations[project.id] || [];
                const hasNoChats = projectChats.length === 0;
                const tooltipText = hasNoChats ? "暂无项目会话" : project.path;

                return (
                  <div key={project.id} className="sidebar-project-group">
                    <div
                      className={isActiveProject ? "sidebar-project-item active" : "sidebar-project-item"}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectProject(project)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          selectProject(project);
                        }
                      }}
                      onContextMenu={(e) => handleProjectContextMenu(e, project)}
                      title={tooltipText}
                    >
                      <button
                        className="project-expand-btn"
                        type="button"
                        aria-label={isExpanded ? "收起项目详情" : "展开项目详情"}
                        title={isExpanded ? "收起项目详情" : "展开项目详情"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleProjectExpanded(project.id);
                        }}
                        style={{ visibility: hasNoChats ? "hidden" : "visible" }}
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <span className="sidebar-project-dot" />
                      <span className="project-title" title={tooltipText}>{project.name}</span>
                      <button
                        className="project-add-chat-btn"
                        type="button"
                        aria-label="新建项目会话"
                        title="新建项目会话"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleNewProjectConversation(project);
                        }}
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    {isExpanded && !hasNoChats && (
                      <div className="project-detail">
                        <div className="project-chat-list">
                          {projectChats.map((conversation) => (
                            <button
                              key={conversation.id}
                              className={conversation.id === activeConversationId ? "sidebar-chat-item active" : "sidebar-chat-item"}
                              onClick={() => {
                                selectProject(project);
                                setActiveConversationId(conversation.id);
                              }}
                              onContextMenu={(e) => handleContextMenu(e, conversation)}
                              type="button"
                            >
                              <MessageSquare size={14} className="chat-icon" />
                              <span className="chat-title">{conversation.title}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {projects.length === 0 && (
                <div className="empty project-empty">打开或新建一个项目</div>
              )}
            </div>
          )}
        </div>

        <div className="sidebar-section chats">
          <div className="sidebar-section-header">
            <div
              className="sidebar-section-toggle"
              onClick={() => setChatsSectionExpanded(!chatsSectionExpanded)}
            >
              {chatsSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <MessageSquare size={16} />
              <span>对话区</span>
            </div>
            <button className="new-chat-btn" onClick={() => void handleNewConversation()} title="新建对话" type="button">
              <Plus size={16} />
            </button>
          </div>
          {chatsSectionExpanded && (
            <div className="sidebar-chat-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={conversation.id === activeConversationId ? "sidebar-chat-item active" : "sidebar-chat-item"}
                  onClick={() => setActiveConversationId(conversation.id)}
                  onContextMenu={(e) => handleContextMenu(e, conversation)}
                  type="button"
                >
                  <MessageSquare size={14} className="chat-icon" />
                  <span className="chat-title">{conversation.title}</span>
                </button>
              ))}
              {conversations.length === 0 && <div className="empty">暂无对话</div>}
            </div>
          )}
        </div>

        <button className="settings-entry" onClick={handleOpenModelConfig}>
          <Settings size={18} />
          <span>系统设置</span>
        </button>
      </aside>

      {showNewProjectDialog && (
        <div className="modal-backdrop" onClick={() => setShowNewProjectDialog(false)}>
          <section className="project-dialog" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <Folder size={18} />
                <strong>新建项目</strong>
              </div>
              <button className="modal-close-btn" onClick={() => setShowNewProjectDialog(false)} aria-label="关闭" title="关闭">&times;</button>
            </header>
            <label>
              <span>父目录</span>
              <div className="project-path-picker">
                <input value={newProjectParent} readOnly placeholder="选择项目所在目录" />
                <button type="button" onClick={() => void handleSelectNewProjectParent()}>
                  选择
                </button>
              </div>
            </label>
            <label>
              <span>项目名称</span>
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="my-project"
                autoFocus
              />
            </label>
            <footer>
              <button className="ghost" type="button" onClick={() => setShowNewProjectDialog(false)}>
                取消
              </button>
              <button className="primary" type="button" onClick={() => void handleCreateProject()}>
                创建并打开
              </button>
            </footer>
          </section>
        </div>
      )}

      {pendingProjectRemoval && (
        <div className="modal-backdrop" onClick={() => setPendingProjectRemoval(null)}>
          <section className="project-dialog danger-approval" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <Trash2 size={18} />
                <strong>审批危险操作</strong>
              </div>
              <button className="modal-close-btn" onClick={() => setPendingProjectRemoval(null)} aria-label="关闭" title="关闭">&times;</button>
            </header>
            <p>
              将从项目区移除 <strong>{pendingProjectRemoval.name}</strong>。此操作不会删除磁盘文件。
            </p>
            <label>
              <span>输入项目名称以确认</span>
              <input
                value={projectApprovalText}
                onChange={(event) => setProjectApprovalText(event.target.value)}
                placeholder={pendingProjectRemoval.name}
                autoFocus
              />
            </label>
            <footer>
              <button className="ghost" type="button" onClick={() => setPendingProjectRemoval(null)}>
                取消
              </button>
              <button
                className="danger"
                type="button"
                onClick={handleConfirmRemoveProject}
                disabled={projectApprovalText.trim() !== pendingProjectRemoval.name}
              >
                批准移除
              </button>
            </footer>
          </section>
        </div>
      )}

      {showModelConfig && (
        <div className="modal-backdrop" onClick={() => setShowModelConfig(false)}>
          <section className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <Settings size={18} />
                <strong>系统设置</strong>
              </div>
              <button className="modal-close-btn" onClick={() => setShowModelConfig(false)} aria-label="关闭" title="关闭">&times;</button>
            </header>

            <div className="settings-modal-layout">
              <aside className="settings-sidebar">
                <button
                  className={activeSettingsTab === "theme" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("theme")}
                >
                  <Sun size={16} />
                  <span>主题选择</span>
                </button>
                <button
                  className={activeSettingsTab === "memory" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => {
                    setActiveSettingsTab("memory");
                    handleKindChange("memory");
                  }}
                >
                  <Brain size={16} />
                  <span>记忆系统</span>
                </button>
                <button
                  className={activeSettingsTab === "model" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("model")}
                >
                  <Bot size={16} />
                  <span>LLM管理</span>
                </button>
                <button
                  className={activeSettingsTab === "embedding" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => {
                    setActiveSettingsTab("embedding");
                    handleOpenEmbeddingConfig();
                  }}
                >
                  <Cpu size={16} />
                  <span>嵌入模型</span>
                </button>
                <button
                  className={activeSettingsTab === "archive" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("archive")}
                >
                  <Archive size={16} />
                  <span>归档列表</span>
                </button>
                <button
                  className={activeSettingsTab === "observability" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("observability")}
                >
                  <Activity size={16} />
                  <span>链路追踪</span>
                </button>
                <button
                  className={activeSettingsTab === "skills" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("skills")}
                >
                  <Sparkles size={16} />
                  <span>Skills管理</span>
                </button>
                <button
                  className={activeSettingsTab === "mcp" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("mcp")}
                >
                  <Monitor size={16} />
                  <span>MCP配置</span>
                </button>
                <button
                  className={activeSettingsTab === "environment" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("environment")}
                >
                  <Settings size={16} />
                  <span>环境依赖</span>
                </button>
              </aside>

              <div className="settings-content">
                {activeSettingsTab === "memory" && (
                  <div className="settings-tab-content">
                    <h3>记忆系统</h3>
                    <p className="description">配置AI的长期记忆偏好与项目上下文，提高回答精准度。</p>
                    {renderWorkspaceGrid()}
                  </div>
                )}

                {activeSettingsTab === "theme" && (
                  <div className="settings-tab-content theme-tab-content">
                    <h3>主题选择</h3>
                    <p className="description">自定义NanoAgent的外观显示，适配各种工作环境。</p>
                    <div className="theme-switcher" role="group" aria-label="主题切换">
                      {(["system", "light", "dark"] as ThemeMode[]).map((mode) => {
                        const Icon =
                          mode === "system"
                            ? Monitor
                            : mode === "light"
                            ? Sun
                            : Moon;
                        return (
                          <button
                            key={mode}
                            className={themeMode === mode ? "active" : ""}
                            onClick={() => setThemeMode(mode)}
                            type="button"
                          >
                            <Icon size={15} />
                            {themeLabels[mode]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeSettingsTab === "archive" && (
                  <div className="settings-tab-content archive-tab-content">
                    <h3>归档列表</h3>
                    <p className="description">在此查看和恢复您曾经归档的对话历史。</p>
                    <div className="archive-split-layout">
                      <div className="archived-list-column">
                        <div className="archived-list">
                          {archivedConversations.map((conversation) => (
                            <button
                              key={conversation.id}
                              className={previewArchivedId === conversation.id ? "archive-config-row active" : "archive-config-row"}
                              onClick={() => void loadArchivedPreview(conversation.id)}
                              type="button"
                            >
                              <div className="archive-config-row-header">
                                <strong>{conversation.title}</strong>
                                <span className="archive-indicator-badge">
                                  已归档
                                </span>
                              </div>
                              <span>{conversation.archived_at || conversation.updated_at}</span>
                            </button>
                          ))}
                          {archivedConversations.length === 0 && <div className="empty">暂无归档对话</div>}
                        </div>
                      </div>
                      <div className="archived-preview-column">
                        {previewArchivedId ? (
                          <>
                            <div className="archive-preview-header">
                              <div className="archive-preview-title-container">
                                <h4>{archivedConversations.find((c) => c.id === previewArchivedId)?.title || "对话预览"}</h4>
                                <span className="archive-preview-date">
                                  {archivedConversations.find((c) => c.id === previewArchivedId)?.archived_at || ""}
                                </span>
                              </div>
                              <div className="archive-preview-actions">
                                <button
                                  className="primary compact-btn"
                                  onClick={() => {
                                    const conversation = archivedConversations.find((c) => c.id === previewArchivedId);
                                    if (conversation) {
                                      void handleRestoreConversation(conversation);
                                    }
                                  }}
                                  type="button"
                                >
                                  <RotateCcw size={14} />
                                  <span>恢复</span>
                                </button>
                                <button
                                  className="danger compact-btn"
                                  onClick={() => {
                                    const conversation = archivedConversations.find((c) => c.id === previewArchivedId);
                                    if (conversation) {
                                      void handleDeleteArchivedConversation(conversation);
                                    }
                                  }}
                                  type="button"
                                >
                                  <Trash2 size={14} />
                                  <span>删除</span>
                                </button>
                              </div>
                            </div>
                            <div className="archive-preview-messages-container">
                              <div className="chat-log">
                                {previewMessages.map((message) => {
                                  const webSearchMeta = message.metadata?.web_search;
                                  return (
                                    <div
                                      key={message.id}
                                      className={`chat-message ${message.role}${parseToolResult(message.content) ? " tool-result-message" : ""}`}
                                    >
                                      {message.role === "assistant" && webSearchMeta && (
                                        <div className={`web-search-status ${webSearchMeta.used_fallback ? "fallback" : "primary"}`}>
                                          <span>{formatWebSearchBadge(webSearchMeta, webSearchMeta.result_count)}</span>
                                          {webSearchMeta.used_fallback && webSearchMeta.fallback_reason && (
                                            <small title={webSearchMeta.fallback_reason}>
                                              {webSearchMeta.fallback_reason}
                                            </small>
                                          )}
                                        </div>
                                      )}
                                      {renderMessageContent(message.content)}
                                    </div>
                                  );
                                })}
                                {previewMessages.length === 0 && <div className="empty">该对话无消息记录</div>}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="archive-preview-placeholder">
                            <Archive size={48} className="placeholder-icon" />
                            <p>选择一个归档的对话以预览其内容</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeSettingsTab === "model" && (() => {
                  const llmModels = models.filter((model) => model.id !== "embedding-config");
                  return (
                    <div className="settings-tab-content model-tab-content">
                      <div className="model-header-row">
                        <h3>LLM管理</h3>
                        <button className="icon-only-btn compact" onClick={handleNewModelConfig} title="新建配置" aria-label="新建配置" type="button"><Plus /></button>
                      </div>
                      <p className="description" style={{ marginTop: "-4px" }}>配置用于聊天对话的大语言模型，供 AI 助手和会话调用。</p>
                      <div className="model-config-grid">
                        <aside className="model-config-list">
                          {llmModels.map((model) => {
                            const statusInfo = modelTestStatuses[model.id] || { status: "idle" };
                            let dotColor = "#9ca3af";
                            let dotTitle = "未测试";

                            if (statusInfo.status === "testing") {
                              dotColor = "#3b82f6";
                              dotTitle = "测试中...";
                            } else if (statusInfo.status === "success") {
                              dotColor = "var(--accent-green, #10b981)";
                              dotTitle = "连通性正常";
                            } else if (statusInfo.status === "error") {
                              dotColor = "var(--accent-red, #ef4444)";
                              dotTitle = `连通性异常: ${statusInfo.message || ""}`;
                            }

                            return (
                              <button
                                key={model.id}
                                className={model.id === modelDraft.id ? "model-config-row active" : "model-config-row"}
                                onClick={() => setModelDraft(normalizeModelDraft(model))}
                                style={{ display: "flex", alignItems: "center", gap: "10px" }}
                              >
                                <span
                                  style={{
                                    width: "8px",
                                    height: "8px",
                                    borderRadius: "50%",
                                    backgroundColor: dotColor,
                                    flexShrink: 0,
                                  }}
                                  title={dotTitle}
                                />
                                <div style={{ display: "grid", gap: "4px", flex: 1, minWidth: 0 }}>
                                  <strong>{model.name}</strong>
                                  <span>{model.provider} / {model.model}</span>
                                </div>
                              </button>
                            );
                          })}
                          {llmModels.length === 0 && <div className="empty">暂无大模型配置</div>}
                        </aside>

                        <div className="model-config-form">
                          <div className="model-form-card">
                            <label>
                              <span>配置名称</span>
                              <input
                                value={modelDraft.name}
                                onChange={(event) => setModelDraft({ ...modelDraft, name: event.target.value })}
                                placeholder="例如：OpenAI 主账号"
                              />
                            </label>
                            <label>
                              <span>协议类型</span>
                              <select
                                value={modelDraft.provider}
                                onChange={(event) => handleProviderChange(event.target.value)}
                              >
                                <option value="openai-compatible">OpenAI 兼容协议</option>
                                <option value="anthropic">Anthropic 兼容协议</option>
                              </select>
                            </label>
                            <label>
                              <span>接口地址</span>
                              <input
                                value={modelDraft.base_url}
                                onChange={(event) => setModelDraft({ ...modelDraft, base_url: event.target.value })}
                                placeholder="https://api.openai.com/v1"
                              />
                            </label>
                            <label>
                              <span>模型标识</span>
                              <input
                                value={modelDraft.model}
                                onChange={(event) => setModelDraft({ ...modelDraft, model: event.target.value })}
                                placeholder="gpt-4o-mini"
                              />
                            </label>
                            <label>
                              <span>API Key</span>
                              <input
                                value={modelDraft.api_key}
                                type="password"
                                onChange={(event) => setModelDraft({ ...modelDraft, api_key: event.target.value })}
                                placeholder="用于对话模型调用"
                              />
                            </label>
                          </div>
                          <div className="modal-actions icon-actions" style={{ display: "flex", alignItems: "center", width: "100%" }}>
                            {llmTestStatus.status === "success" && (
                              <span style={{ color: "var(--accent-green)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-green)" }} />
                                连通性正常
                              </span>
                            )}
                            {llmTestStatus.status === "error" && (
                              <span style={{ color: "var(--accent-red)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }} title={llmTestStatus.message}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-red)" }} />
                                连通性异常 (悬浮查看详情)
                              </span>
                            )}
                            {(llmTestStatus.status === "idle" || llmTestStatus.status === "testing") && (
                              <div style={{ marginRight: "auto" }} />
                            )}
                            <button
                              className="icon-text-btn"
                              onClick={handleTestLlm}
                              disabled={llmTestStatus.status === "testing"}
                              title="测试连接"
                              type="button"
                            >
                              {llmTestStatus.status === "testing" ? (
                                <Loader2 style={{ animation: "spin 1s linear infinite" }} />
                              ) : (
                                <Activity />
                              )}
                              <span>{llmTestStatus.status === "testing" ? "测试中..." : "测试连接"}</span>
                            </button>
                            <button className="icon-text-btn success-btn" onClick={handleSaveModel} title="保存并使用" type="button">
                              <Save />
                              <span>保存并使用</span>
                            </button>
                            <button className="icon-text-btn danger-btn" title="删除模型" onClick={handleDeleteModel} disabled={!modelDraft.id || modelDraft.id === "embedding-config"} type="button">
                              <Trash2 />
                              <span>删除</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {activeSettingsTab === "embedding" && (
                  <div className="settings-tab-content model-tab-content">
                    <div className="model-header-row">
                      <h3>嵌入模型</h3>
                    </div>
                    <p className="description" style={{ marginTop: "-4px" }}>配置全局唯一嵌入模型 API，用于轻量 RAG 的文档向量化与匹配。</p>
                    
                    <div style={{
                      border: "1px solid var(--border-color)",
                      borderRadius: "12px",
                      background: "var(--bg-card)",
                      overflow: "hidden",
                      maxHeight: "none",
                      flex: 1
                    }}>
                      <div className="model-config-form" style={{ maxWidth: "600px" }}>
                        <div className="model-form-card">
                          <label>
                            <span>协议类型</span>
                            <select
                              value={embeddingDraft.embedding_provider}
                              onChange={(event) => handleEmbeddingProviderChange(event.target.value)}
                              disabled
                            >
                              <option value="openai-compatible">OpenAI 兼容协议</option>
                            </select>
                          </label>
                          <label>
                            <span>接口地址</span>
                            <input
                              value={embeddingDraft.embedding_base_url}
                              onChange={(event) => setEmbeddingDraft({ ...embeddingDraft, embedding_base_url: event.target.value })}
                              placeholder="https://api.openai.com/v1"
                            />
                          </label>
                          <label>
                            <span>模型标识</span>
                            <input
                              value={embeddingDraft.embedding_model}
                              onChange={(event) => setEmbeddingDraft({ ...embeddingDraft, embedding_model: event.target.value })}
                              placeholder="text-embedding-3-small"
                            />
                          </label>
                          <label>
                            <span>API Key</span>
                            <input
                              value={embeddingDraft.embedding_api_key}
                              type="password"
                              onChange={(event) => setEmbeddingDraft({ ...embeddingDraft, embedding_api_key: event.target.value })}
                              placeholder="用于 RAG 向量化，可与大模型不同"
                            />
                          </label>
                        </div>
                        <div className="modal-actions icon-actions" style={{ display: "flex", alignItems: "center", width: "100%" }}>
                          {embeddingTestStatus.status === "success" && (
                            <span style={{ color: "var(--accent-green)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }}>
                              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-green)" }} />
                              连通性正常
                            </span>
                          )}
                          {embeddingTestStatus.status === "error" && (
                            <span style={{ color: "var(--accent-red)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }} title={embeddingTestStatus.message}>
                              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-red)" }} />
                              连通性异常 (悬浮查看详情)
                            </span>
                          )}
                          {(embeddingTestStatus.status === "idle" || embeddingTestStatus.status === "testing") && (
                            <div style={{ marginRight: "auto" }} />
                          )}
                          <button
                            className="icon-text-btn"
                            onClick={handleTestEmbedding}
                            disabled={embeddingTestStatus.status === "testing"}
                            title="测试连接"
                            type="button"
                          >
                            {embeddingTestStatus.status === "testing" ? (
                              <Loader2 style={{ animation: "spin 1s linear infinite" }} />
                            ) : (
                              <Activity />
                            )}
                            <span>{embeddingTestStatus.status === "testing" ? "测试中..." : "测试连接"}</span>
                          </button>
                          <button className="icon-text-btn success-btn" onClick={handleSaveEmbeddingModel} title="保存并使用" type="button">
                            <Save />
                            <span>保存并使用</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeSettingsTab === "skills" && (
                  <div className="settings-tab-content skills-tab-content" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", gap: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <h3>Skills 管理</h3>
                        <p className="description" style={{ margin: 0 }}>配置并扩展 AI 助手的工具与自动化能力（例如内置 Anthropic 官方的 Text Editor、Bash Tool 等）。</p>
                      </div>
                    </div>

                    <div className="skills-config-grid" style={{ flex: 1, overflow: "hidden" }}>
                      <aside className="skills-config-list" style={{ display: "flex", flexDirection: "column", gap: "8px", overflow: "hidden" }}>
                        <div style={{ marginBottom: "4px" }}>
                          <button 
                            className="secondary" 
                            style={{ width: "100%", padding: "6px 8px", fontSize: "0.8rem", height: "auto" }} 
                            onClick={() => {
                              setIsAddingSkill(true);
                              setSelectedSkillId("");
                            }}
                            type="button"
                          >
                            添加自定义技能
                          </button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                          {skills.map((skill) => (
                            <button
                              key={skill.id}
                              className={!isAddingSkill && skill.id === selectedSkillId ? "skills-config-row active" : "skills-config-row"}
                              onClick={() => {
                                setIsAddingSkill(false);
                                setSelectedSkillId(skill.id);
                              }}
                              type="button"
                            >
                              <div className="skills-config-row-header">
                                <strong>{skill.name}</strong>
                                <span className={`skills-indicator-badge ${skill.enabled ? "enabled" : "disabled"}`}>
                                  {skill.enabled ? "已启用" : "未启用"}
                                </span>
                              </div>
                              <span>{skill.provider}</span>
                            </button>
                          ))}
                        </div>
                      </aside>

                      <div className="skills-config-form" style={{ display: "flex", flexDirection: "column", overflowY: "auto" }}>
                        {isAddingSkill ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px", height: "100%" }}>
                            <h4 style={{ margin: 0 }}>添加自定义技能</h4>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>唯一标识符 (ID):</label>
                              <input
                                value={newSkillDraft.id}
                                onChange={(e) => setNewSkillDraft(prev => ({ ...prev, id: e.target.value.trim().toLowerCase() }))}
                                placeholder="例如: custom_file_helper"
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>技能名称 (Name):</label>
                              <input
                                value={newSkillDraft.name}
                                onChange={(e) => setNewSkillDraft(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="例如: 自定义文件助手"
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>文档/项目链接 (Doc URL):</label>
                              <input
                                value={newSkillDraft.docUrl}
                                onChange={(e) => setNewSkillDraft(prev => ({ ...prev, docUrl: e.target.value }))}
                                placeholder="https://..."
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>技能描述 (Description):</label>
                              <textarea
                                value={newSkillDraft.description}
                                onChange={(e) => setNewSkillDraft(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="描述该技能的作用以及模型如何调用它..."
                                rows={2}
                                style={{ width: "100%", boxSizing: "border-box", borderRadius: "4px", border: "1px solid var(--border-color)", padding: "8px", backgroundColor: "var(--bg-main)", color: "var(--text-main)", resize: "vertical", fontSize: "0.85rem" }}
                              />
                            </div>
                            <div style={{ marginTop: "auto", display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                              <button className="secondary" onClick={() => {
                                setIsAddingSkill(false);
                                if (skills.length > 0) {
                                  setSelectedSkillId(skills[0].id);
                                }
                              }} type="button">
                                取消
                              </button>
                              <button className="primary" onClick={handleSaveNewSkill} type="button">
                                <Save size={15} /> 确认添加
                              </button>
                            </div>
                          </div>
                        ) : (() => {
                          const skill = skills.find((s) => s.id === selectedSkillId);
                          if (!skill) return <div className="empty">选择一个 Skill 以查看详情</div>;
                          const isSystemSkill = isBuiltInSkill(skill.id);

                          return (
                            <>
                              <div className="skills-form-header">
                                <div className="skills-form-title-row">
                                  <h4>{skill.name}</h4>
                                  <span className="skills-provider-tag">{skill.provider}</span>
                                  {isSystemSkill && <span className="skills-provider-tag">系统内置</span>}
                                </div>
                                <p style={{ fontSize: "0.85rem" }}>{skill.description}</p>
                                {skill.docUrl && (
                                  <a
                                    href={skill.docUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="skills-doc-link"
                                    style={{ fontSize: "0.8rem" }}
                                  >
                                    查看官方文档说明 ↗
                                  </a>
                                )}
                              </div>

                              <div className="skills-form-section" style={{ marginTop: "12px" }}>
                                <h5>启用状态</h5>
                                <div className="skills-switch-row">
                                  <span style={{ fontSize: "0.85rem" }}>{skill.enabled ? "该技能当前已激活，模型将在合适的时候自动调用" : "该技能当前已禁用"}</span>
                                </div>
                              </div>



                              <div className="skills-form-actions">
                                <button
                                  className={skill.enabled ? "danger" : "primary"}
                                  onClick={() => handleToggleSkill(skill.id, !skill.enabled)}
                                  type="button"
                                >
                                  {skill.enabled ? "禁用技能" : "启用技能"}
                                </button>
                                {!isSystemSkill && (
                                  <button
                                    className="danger"
                                    onClick={() => handleDeleteSkill(skill.id)}
                                    type="button"
                                  >
                                    删除技能
                                  </button>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                                {activeSettingsTab === "observability" && renderObservabilityPanel()}

{activeSettingsTab === "mcp" && (
                  <div className="settings-tab-content model-tab-content">
                    <div className="model-header-row">
                      <h3>MCP 配置</h3>
                      <button className="icon-only-btn compact" onClick={handleNewMcpServer} title="添加 MCP 服务器" aria-label="添加 MCP 服务器" type="button"><Plus /></button>
                    </div>
                    <p className="description" style={{ marginTop: "-4px" }}>连接符合 Model Context Protocol 规范的工具服务器，支持 stdio、SSE 和 Streamable HTTP。</p>

                    <div className="model-config-grid mcp-config-grid">
                      <aside className="model-config-list">
                        {mcpServers.map((server) => {
                          const connected = server.status.connected;
                          const busy = mcpBusyId === server.config.id;
                          return (
                            <button
                              key={server.config.id}
                              className={server.config.id === selectedMcpServerId ? "mcp-config-row active" : "mcp-config-row"}
                              onClick={() => setSelectedMcpServerId(server.config.id)}
                              type="button"
                            >
                              <div className="mcp-config-row-header">
                                <strong>{server.config.name}</strong>
                                <button
                                  className={connected ? "mcp-connection-badge connected" : "mcp-connection-badge"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (connected) {
                                      void handleDisconnectMcpServer(server.config.id);
                                    } else {
                                      void handleConnectMcpServer(server.config.id);
                                    }
                                  }}
                                  disabled={busy}
                                  title={connected ? "断开 MCP 服务器" : "连接 MCP 服务器"}
                                  type="button"
                                >
                                  {busy ? <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} /> : <span className="mcp-pill-indicator" />}
                                  <span>{connected ? "已连接" : "未连接"}</span>
                                </button>
                              </div>
                              <span title={server.config.command || server.config.url}>{formatMcpTransportLabel(server.config.transport)} · {server.config.command || server.config.url} · {server.tools.length} tools</span>
                            </button>
                          );
                        })}
                        {mcpServers.length === 0 && <div className="empty">暂无 MCP 服务器配置</div>}
                      </aside>

                      <div className="model-config-form">
                        <div className="model-form-card mcp-form-card">
                          <label>
                            <span>服务名称</span>
                            <input
                              value={mcpDraft.name}
                              onChange={(event) => setMcpDraft({ ...mcpDraft, name: event.target.value })}
                              placeholder="amap-maps"
                            />
                          </label>
                          <label>
                            <span>协议</span>
                            <select
                              value={mcpDraft.transport}
                              onChange={(event) => setMcpDraft({ ...mcpDraft, transport: event.target.value })}
                            >
                              <option value="stdio">stdio 本地进程</option>
                              <option value="sse">SSE</option>
                              <option value="streamable_http">Streamable HTTP</option>
                            </select>
                          </label>
                          {mcpDraft.transport === "stdio" ? (
                            <>
                              <label>
                                <span>命令</span>
                                <textarea
                                  value={stdioCommandLine}
                                  onChange={(event) => setStdioCommandLine(event.target.value)}
                                  rows={3}
                                  placeholder={"npx -y @modelcontextprotocol/server-filesystem C:\\Users\\13439\\Desktop"}
                                  spellCheck={false}
                                />
                              </label>
                              <label>
                                <span>环境变量 JSON</span>
                                <textarea
                                  value={mcpDraft.env_json}
                                  onChange={(event) => setMcpDraft({ ...mcpDraft, env_json: event.target.value })}
                                  rows={3}
                                  placeholder={"{\"API_KEY\": \"...\"}"}
                                />
                              </label>
                              <label>
                                <span>工作目录</span>
                                <input
                                  value={mcpDraft.working_dir}
                                  onChange={(event) => setMcpDraft({ ...mcpDraft, working_dir: event.target.value })}
                                  placeholder="可选"
                                />
                              </label>
                            </>
                          ) : (
                            <>
                              <label>
                                <span>地址</span>
                                <input
                                  value={mcpDraft.url}
                                  onChange={(event) => setMcpDraft({ ...mcpDraft, url: event.target.value })}
                                  placeholder={mcpDraft.transport === "sse" ? "https://example.com/sse" : "https://example.com/mcp"}
                                />
                              </label>
                              <label>
                                <span>请求头 JSON</span>
                                <textarea
                                  value={mcpDraft.headers_json}
                                  onChange={(event) => setMcpDraft({ ...mcpDraft, headers_json: event.target.value })}
                                  rows={3}
                                  placeholder={"{\"Authorization\": \"Bearer ...\"}"}
                                />
                              </label>
                            </>
                          )}
                        </div>

                        <div className="modal-actions icon-actions mcp-actions">
                          <div className="mcp-action-status">
                            {selectedMcpServer?.status.error && (
                              <span className="mcp-status-text error" title={selectedMcpServer.status.error}>连接错误</span>
                            )}
                            {selectedMcpServer && (
                              <div className="mcp-tools-tooltip-wrap">
                                <button className="icon-only-btn compact" type="button" aria-label="查看工具详情" title="查看工具详情">
                                  <Info />
                                </button>
                                <div className="mcp-tools-tooltip" role="tooltip">
                                  <div className="mcp-tools-tooltip-header">
                                    <strong>工具详情{selectedMcpServer.status.connected ? ` · ${selectedMcpServer.tools.length}` : ""}</strong>
                                    {selectedMcpServer.status.connected && (
                                      <button
                                        className="icon-only-btn compact"
                                        onClick={() => void handleRefreshMcpTools(selectedMcpServer.config.id)}
                                        disabled={mcpBusyId === selectedMcpServer.config.id}
                                        type="button"
                                        title="刷新工具列表"
                                        aria-label="刷新工具列表"
                                      >
                                        {mcpBusyId === selectedMcpServer.config.id ? <Loader2 style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw />}
                                      </button>
                                    )}
                                  </div>
                                  {!selectedMcpServer.status.connected && <div className="mcp-tools-tooltip-empty">连接后可查看工具</div>}
                                  {selectedMcpServer.status.connected && selectedMcpServer.tools.length === 0 && <div className="mcp-tools-tooltip-empty">该服务器暂未暴露工具</div>}
                                  {selectedMcpServer.status.connected && selectedMcpServer.tools.length > 0 && (
                                    <div className="mcp-tools-tooltip-list">
                                      {selectedMcpServer.tools.map((tool) => (
                                        <div key={`${tool.server_id}:${tool.name}`} className="mcp-tools-tooltip-item">
                                          <strong>{tool.name}</strong>
                                          {tool.description && <span>{tool.description}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          <button className="icon-text-btn success-btn" onClick={handleSaveMcpServer} title="保存配置" type="button">
                            <Save />
                            <span>保存</span>
                          </button>
                          <button className="icon-text-btn danger-btn" title="删除 MCP 服务器" onClick={handleDeleteMcpServer} disabled={mcpBusyId === mcpDraft.id} type="button">
                            <Trash2 />
                            <span>删除</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeSettingsTab === "environment" && (
                  <div className="settings-tab-content" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div>
                      <h3>环境依赖</h3>
                      <p className="description">配置本地运行环境、工具路径和外部技能所需的访问凭据。</p>
                    </div>

                    <div className="env-status-banner">
                      <div className="env-status-main">
                        <div className="env-status-left">
                          <strong>运行环境</strong>
                          <div className="env-status-items">
                            <div className="env-status-item-compact">
                              <span>Node.js</span>
                              <span className={envStatus.node ? "env-status-ok" : "env-status-missing"}>
                                {envStatus.node ? "✓ 已就绪" : "✗ 未检测到"}
                              </span>
                            </div>
                            <div className="env-status-item-compact">
                              <span>Python</span>
                              <span className={envStatus.python ? "env-status-ok" : "env-status-missing"}>
                                {envStatus.python ? "✓ 已就绪" : "✗ 未检测到"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="env-status-actions">
                          <div className="env-actions-menu-wrap">
                            <button
                              className="secondary env-action-btn"
                              type="button"
                              onClick={() => setShowEnvActionsMenu((current) => !current)}
                              aria-expanded={showEnvActionsMenu}
                            >
                              更多
                              <ChevronDown size={16} />
                            </button>
                            {showEnvActionsMenu && (
                              <div className="env-actions-menu">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowEnvActionsMenu(false);
                                    void runEnvCheck();
                                  }}
                                  disabled={isCheckingEnv || isInstallingEnv}
                                >
                                  {isCheckingEnv ? "正在检测..." : "重新检测环境"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowEnvActionsMenu(false);
                                    void handleAutoInstallMissing();
                                  }}
                                  disabled={isCheckingEnv || isInstallingEnv}
                                >
                                  {isInstallingEnv ? "正在安装..." : "自动配置/安装 (winget)"}
                                </button>
                                {envStatus.node && envStatus.python && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowEnvActionsMenu(false);
                                      setShowCustomPaths((current) => !current);
                                    }}
                                  >
                                    {showCustomPaths ? "隐藏自定义配置" : "配置自定义路径"}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {(!envStatus.node || !envStatus.python || showCustomPaths) && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Node.js 自定义路径:</label>
                              <input
                                value={nodePath}
                                onChange={(e) => setNodePath(e.target.value)}
                                placeholder="系统默认 PATH / 点击保存"
                                onBlur={handleSaveCustomPaths}
                                style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Python 自定义路径:</label>
                              <input
                                value={pythonPath}
                                onChange={(e) => setPythonPath(e.target.value)}
                                placeholder="系统默认 PATH / 点击保存"
                                onBlur={handleSaveCustomPaths}
                                style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                              />
                            </div>
                          </div>
                          {isInstallingEnv && (
                            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span className="spinner">⏳</span> {envInstallProgress}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="env-status-banner">
                      <div className="env-status-main">
                        <div className="env-status-left">
                          <strong>Tavily</strong>
                          <div className="env-status-items">
                            <div className="env-status-item-compact">
                              <span>Tavily CLI</span>
                              <span className={envStatus.tavily_cli ? "env-status-ok" : "env-status-missing"}>
                                {envStatus.tavily_cli ? "✓ 已就绪" : "✗ 未检测到"}
                              </span>
                            </div>
                            <div className="env-status-item-compact">
                              <span>API Key</span>
                              <span className={tavilyApiKey.trim() ? "env-status-ok" : "env-status-missing"}>
                                {tavilyApiKey.trim() ? "✓ 已配置" : "✗ 未配置"}
                              </span>
                            </div>
                          </div>
                        </div>
                        {!envStatus.tavily_cli && (
                          <div className="env-status-actions">
                            <button
                              className="secondary env-action-btn"
                              type="button"
                              onClick={handleInstallTavilyCli}
                              disabled={isInstallingEnv || isCheckingEnv}
                            >
                              {isInstallingEnv ? "安装中..." : "安装 CLI"}
                            </button>
                          </div>
                        )}
                      </div>
                      {isInstallingEnv && envInstallProgress.includes("Tavily") && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className="spinner">⏳</span> {envInstallProgress}
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "12px", alignItems: "end" }}>
                        <div className="skills-param-field" style={{ margin: 0 }}>
                          <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Tavily API Key:</label>
                          <input
                            type="password"
                            value={tavilyApiKey}
                            onChange={(e) => setTavilyApiKey(e.target.value)}
                            placeholder="tvly-..."
                            style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                          />
                        </div>
                        <button
                          className="secondary"
                          onClick={handleSaveTavilyApiKey}
                          disabled={isSavingTavilyApiKey}
                          type="button"
                          style={{ height: "32px" }}
                        >
                          {isSavingTavilyApiKey ? "保存中..." : "保存 Key"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      <aside className="chat-pane">
        <header className="chat-header">
          <div>
            <Bot size={19} />
            <strong>AI 助手</strong>
          </div>
          {activeConversationId && (
            <button
              className="icon"
              aria-label="关闭当前会话"
              title="关闭当前会话"
              onClick={handleCloseConversation}
              type="button"
            >
              <X size={15} />
            </button>
          )}
        </header>

        <div className="chat-log">
          {messages.map((message) => {
            const toolCall = message.role === "assistant" ? parseToolCall(message.content) : null;
            const webSearchMeta = message.metadata?.web_search;
            const isExecuted = toolCall ? messages.slice(messages.indexOf(message) + 1).some((m) =>
              m.role === "user" && m.content.startsWith(`[工具执行结果: ${toolCall.name}]`)
            ) : false;

            return (
              <div
                key={message.id}
                className={`chat-message ${message.role}${parseToolResult(message.content) ? " tool-result-message" : ""}`}
              >
                {message.role === "assistant" && messageReasoning[message.id]?.trim() && (
                  <details className="reasoning-panel">
                    <summary className="reasoning-title">思考过程</summary>
                    <MarkdownMessage content={messageReasoning[message.id]} />
                  </details>
                )}
                {message.role === "assistant" && webSearchMeta && (
                  <div className={`web-search-status ${webSearchMeta.used_fallback ? "fallback" : "primary"}`}>
                    <span>{formatWebSearchBadge(webSearchMeta, webSearchMeta.result_count)}</span>
                    {webSearchMeta.used_fallback && webSearchMeta.fallback_reason && (
                      <small title={webSearchMeta.fallback_reason}>
                        {webSearchMeta.fallback_reason}
                      </small>
                    )}
                  </div>
                )}
                {renderMessageContent(message.content)}
                
                {toolCall && (
                  <div className="tool-call-card" style={{
                    marginTop: "12px",
                    padding: "12px",
                    border: "1px solid var(--border-color, #e0e0e0)",
                    borderRadius: "8px",
                    background: "rgba(0, 0, 0, 0.02)",
                    fontSize: "0.85rem",
                    textAlign: "left"
                  }}>
                    <div style={{ fontWeight: "bold", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                      🔧 工具调用请求: <code style={{ background: "rgba(0,0,0,0.06)", padding: "2px 4px", borderRadius: "4px" }}>{toolCall.name}</code>
                    </div>
                    
                    {Object.entries(toolCall.args).map(([k, v]) => (
                      <div key={k} style={{ margin: "4px 0" }}>
                        <span style={{ color: "var(--text-secondary)", fontWeight: "600" }}>{k}:</span>
                        <pre style={{ margin: "4px 0", background: "rgba(0,0,0,0.04)", padding: "6px", borderRadius: "4px", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{v}</pre>
                      </div>
                    ))}
                    
                    <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
                      {isExecuted ? (
                        <span style={{ color: "#2e7d32", fontWeight: "bold", display: "flex", alignItems: "center", gap: "4px" }}>
                          ✓ 已执行完成
                        </span>
                      ) : executingToolMessageId === message.id ? (
                        <span style={{ color: "var(--text-secondary)" }}>⏳ 正在执行中...</span>
                      ) : (
                        <>
                          <button
                            className="primary"
                            style={{ padding: "4px 12px", fontSize: "0.8rem", height: "auto" }}
                            onClick={() => handleExecuteTool(message.id, toolCall)}
                          >
                            运行工具
                          </button>
                          <button
                            className="secondary"
                            style={{ padding: "4px 12px", fontSize: "0.8rem", height: "auto" }}
                            onClick={() => handleRejectTool(message.id, toolCall)}
                          >
                            拒绝
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {messages.length === 0 && <div className="empty">在下方输入开始对话，记录将保存在本地</div>}
        </div>

        <div className="chat-input">
          {promptSuggestions.length > 0 && (
            <div className="prompt-suggestions-dropdown">
              {promptSuggestions.map((prompt, index) => (
                <button
                  key={prompt.id}
                  className={index === selectedPromptIndex ? "prompt-suggestion-item selected" : "prompt-suggestion-item"}
                  onClick={() => insertPrompt(prompt)}
                  type="button"
                >
                  <strong>#{prompt.title}</strong>
                  <span>{prompt.body}</span>
                </button>
              ))}
            </div>
          )}
          {(ragFiles.length > 0 || indexingRagFileName) && (
            <div className="rag-file-strip">
              {indexingRagFileName && (
                <span className="rag-file-chip indexing">
                  <FileText size={14} />
                  {indexingRagFileName} · 索引中
                </span>
              )}
              {ragFiles.map((file) => (
                <span key={file.id} className="rag-file-chip" title={`${file.name} · ${file.chunk_count} chunks`}>
                  <FileText size={14} />
                  <span>{file.name}</span>
                  <small>{file.chunk_count}</small>
                  <button
                    aria-label={`移除 ${file.name}`}
                    onClick={() => void handleDeleteRagFile(file.id)}
                    title="移除文件索引"
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={chatInput}
            onChange={(event) => void handleInputChange(event.target.value, event.target.selectionStart)}
            onKeyDown={handleInputKeyDown}
            placeholder="问点什么，或者梳理当前的思绪..."
          />
          <div className="chat-input-footer">
            <div className="chat-input-left">
              <select value={activeModelId} onChange={(event) => void handleActiveModelChange(event.target.value)}>
                <option value="">选择模型</option>
                {models.filter((model) => model.id !== "embedding-config").map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
            <div className="chat-input-actions">

              <button className="chat-input-action ghost" aria-label="新对话" title="新对话" onClick={() => void handleNewConversation()} type="button">
                <Plus size={20} />
                <span>新建</span>
              </button>
              <button className="chat-input-action send" aria-label="发送" title="发送" onClick={handleSendMessage} disabled={busy || !chatInput.trim()} type="button">
                <SendHorizontal size={20} />
                <span>发送</span>
              </button>
            </div>
          </div>
        </div>

        {notice && <div className="notice" onClick={() => setNotice("")}>{notice}</div>}

        {showEnvPrompt && (
          <div className="env-setup-backdrop" style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            backdropFilter: "blur(4px)"
          }}>
            <div className="env-setup-modal" style={{
              backgroundColor: "var(--bg-card)",
              borderRadius: "12px",
              border: "1px solid var(--border-color)",
              padding: "24px",
              width: "500px",
              maxWidth: "90%",
              boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              color: "var(--text-main)"
            }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "8px" }}>
                🛠️ 初始化环境配置
              </h3>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.5" }}>
                运行智能技能（Skills）依赖 <strong>Node.js</strong> 和 <strong>Python</strong> 环境。检测到您的系统当前缺少所需环境。
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px", backgroundColor: "var(--bg-main)", borderRadius: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Node.js 环境:</span>
                  <span style={{ color: envStatus.node ? "var(--accent-green)" : "var(--accent-red)", fontWeight: "bold" }}>
                    {envStatus.node ? "✓ 已就绪" : "✗ 未检测到"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Python 环境:</span>
                  <span style={{ color: envStatus.python ? "var(--accent-green)" : "var(--accent-red)", fontWeight: "bold" }}>
                    {envStatus.python ? "✓ 已就绪" : "✗ 未检测到"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <h4 style={{ margin: "4px 0", fontSize: "0.95rem" }}>配置已有路径（若已安装）：</h4>
                <div className="skills-param-field" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Node.js 可执行文件路径:</label>
                  <input
                    value={nodePath}
                    onChange={(e) => setNodePath(e.target.value)}
                    placeholder="例如: C:\Program Files\nodejs\node.exe 或直接输入 node"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                <div className="skills-param-field" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Python 可执行文件路径:</label>
                  <input
                    value={pythonPath}
                    onChange={(e) => setPythonPath(e.target.value)}
                    placeholder="例如: C:\Users\...\python.exe 或直接输入 python"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {isInstallingEnv && (
                <div style={{ padding: "10px", backgroundColor: "var(--bg-main)", borderRadius: "6px", fontSize: "0.85rem", borderLeft: "4px solid var(--accent-blue)" }}>
                  <span className="spinner" style={{ marginRight: "8px" }}>⌛</span>
                  {envInstallProgress}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "8px", justifyContent: "flex-end" }}>
                <button 
                  className="secondary" 
                  onClick={() => {
                    localStorage.setItem("nano-agent-env-checked", "true");
                    setShowEnvPrompt(false);
                  }}
                  disabled={isInstallingEnv || isCheckingEnv}
                  type="button"
                >
                  稍后提醒
                </button>
                <button 
                  className="secondary" 
                  onClick={handleSaveCustomPaths}
                  disabled={isInstallingEnv || isCheckingEnv}
                  type="button"
                >
                  保存已有路径
                </button>
                <button 
                  className="primary" 
                  onClick={handleAutoInstallMissing}
                  disabled={isInstallingEnv || isCheckingEnv}
                  type="button"
                >
                  {isInstallingEnv ? "正在配置..." : "自动配置 (winget)"}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {contextMenu.visible && (
        <div
          className="custom-context-menu"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.conversation && (
            <>
              <button
                className="custom-context-menu-item"
                onClick={() => {
                  if (contextMenu.conversation) {
                    void handleRenameConversation(
                      contextMenu.conversation.id,
                      contextMenu.conversation.title
                    );
                  }
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                type="button"
              >
                <Edit size={14} />
                <span>重命名</span>
              </button>
              <button
                className="custom-context-menu-item"
                onClick={() => {
                  if (contextMenu.conversation) {
                    void handleContextArchiveConversation(contextMenu.conversation);
                  }
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                type="button"
              >
                <Archive size={14} />
                <span>归档会话</span>
              </button>
              <button
                className="custom-context-menu-item danger-action"
                onClick={() => {
                  if (contextMenu.conversation) {
                    void handleContextDeleteConversation(contextMenu.conversation);
                  }
                  setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                type="button"
              >
                <Trash2 size={14} />
                <span>删除会话</span>
              </button>
            </>
          )}

          {contextMenu.project && (
            <button
              className="custom-context-menu-item danger-action"
              onClick={() => {
                if (contextMenu.project) {
                  handleRemoveProjectApproval(contextMenu.project);
                }
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              type="button"
            >
              <Trash2 size={14} />
              <span>移除项目入口</span>
            </button>
          )}
        </div>
      )}
      {isRagDragging && (
        <div className="rag-drop-overlay">
          <div className="rag-drop-overlay-box">
            <Upload size={36} />
            <strong>释放文件以索引到当前对话</strong>
            <span>支持文本、Markdown、JSON、代码等文件</span>
          </div>
        </div>
      )}
    </main>
  );
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function extractMemoryDraft(content: string) {
  const normalized = content.trim();
  const memoryIntent =
    /(记住|记一下|记到记忆|保存到记忆|加入记忆|更新(?:一下)?(?:我的)?记忆|修改(?:一下)?(?:我的)?记忆|以后记得)/.test(normalized);

  if (!memoryIntent) {
    return null;
  }

  const memoryContent = normalized
    .replace(/^(请|帮我|麻烦你|你)?\s*/, "")
    .replace(/^(记住|记一下|记到记忆|保存到记忆|加入记忆|以后记得)[：:\s]*/i, "")
    .replace(/^更新(?:一下)?(?:我的)?记忆[：:\s]*/i, "")
    .replace(/^修改(?:一下)?(?:我的)?记忆[：:\s]*/i, "")
    .trim();

  if (!memoryContent) {
    return null;
  }

  const title = memoryContent
    .replace(/[。.!！?？\n\r].*$/s, "")
    .slice(0, 24)
    .trim() || "聊天记忆";

  return {
    title,
    content: memoryContent,
    tags: ["chat"],
    enabled: true
  };
}

function buildSystemMessage(
  memories: Memory[],
  activeProject: ProjectEntry | null = null,
  projectFiles: ProjectFileEntry[] = [],
  skills: Skill[] = [],
  mcpServers: McpServerView[] = [],
  ragMatches: RagChunkMatch[] = [],
  tempDir?: string
): ChatMessage {
  const runtimeContext = buildRuntimeContext();

  const memoryContext = memories
    .map((memory) => `- ${memory.title}: ${memory.content}`)
    .join("\n");

  const ragContext = ragMatches.length > 0
    ? ragMatches
        .map((match, index) => {
          const score = Number.isFinite(match.score) ? match.score.toFixed(3) : "0.000";
          return `[${index + 1}] ${match.file_name} · chunk ${match.chunk_index + 1} · score ${score}\n${match.text}`;
        })
        .join("\n\n")
    : "";

  const projectContext = activeProject
    ? [
        "当前项目上下文：",
        `- 项目显示名称：${activeProject.name}（仅用于应用界面展示，不代表目录名，也不要用于拼接路径）`,
        `- 真实工作目录：${activeProject.path}`,
        "- 所有文件、命令、读写操作必须以真实工作目录为准；不要根据项目显示名称推断或追加子目录。",
        projectFiles.length > 0
          ? `- 当前项目文件列表（最多 300 项，已跳过 node_modules、.git、target、dist 等大目录）：\n${formatProjectFileTree(projectFiles)}`
          : "- 当前项目文件列表为空，或暂时无法读取。"
      ].join("\n")
    : "";

  const enabledSkills = skills.filter((s) => s.enabled);
  const mcpTools = mcpServers.flatMap((server) =>
    server.status.connected
      ? server.tools.map((tool) => ({
          callName: `mcp__${tool.server_id}__${tool.name}`,
          serverName: server.config.name,
          tool
        }))
      : []
  );
  const mcpContext = mcpTools.length > 0
    ? [
        "当前已连接的 MCP 工具：",
        ...mcpTools.map(({ callName, serverName, tool }) =>
          `- ${callName}\n  服务器：${serverName}\n  描述：${tool.description || "无"}\n  参数 schema：${tool.input_schema_json}`
        )
      ].join("\n")
    : "";
  const skillsContext = enabledSkills.length > 0
    ? [
        "当前已启用的本地/系统技能（Skills）：",
        ...enabledSkills.map((s) => {
          const parameters = { ...s.parameters };
          if (activeProject?.path) {
            if ("workspace_root" in parameters) {
              parameters.workspace_root = activeProject.path;
            }
            if ("output_dir" in parameters) {
              parameters.output_dir = activeProject.path;
            }
            if ("skills_root" in parameters) {
              parameters.skills_root = activeProject.path + "\\.agents\\skills";
            }
          } else if (tempDir) {
            if ("workspace_root" in parameters) {
              parameters.workspace_root = tempDir;
            }
            if ("output_dir" in parameters) {
              parameters.output_dir = tempDir;
            }
          }

          const params = parameters && Object.keys(parameters).length > 0
            ? "\n  自动运行参数：\n" + Object.entries(parameters)
                .map(([k, v]) => `    * ${k}: ${v}`)
                .join("\n")
            : "";
          return `- 名称：${s.name} (ID: ${s.id})\n  提供者：${s.provider}\n  描述：${s.description}${params}`;
        })
      ].join("\n")
    : "";

  const toolsSystemInstruction = `
如果你需要使用已启用的技能来执行操作（如读取文件、写入文件或执行命令），你必须在回答中输出以下格式的 XML 标签来发出工具调用请求：

1. 写入文件（如果文件不存在会自动创建并写入，用于创建或修改文件）：
<tool_call name="write_file">
  <path>文件名或路径（如 a.txt）</path>
  <content>写入的完整文件内容</content>
</tool_call>

2. 读取文件（读取本地文件内容）：
<tool_call name="read_file">
  <path>文件名或路径</path>
</tool_call>

3. 执行命令（对应 Bash Tool，仅在已启用 Bash Tool 时可用）：
<tool_call name="execute_command">
  <command>具体的终端命令行</command>
</tool_call>

4. 调用 MCP 工具（仅限上方列出的已连接 MCP 工具）：
<tool_call name="mcp__server_id__tool_name">
  <arguments>{"key":"value"}</arguments>
</tool_call>

注意：请一次仅发出一个 <tool_call>，等待用户确认执行并向你回传结果后，你再根据执行结果继续后续思考或操作。`;

  const sections = [
    runtimeContext,
    projectContext,
    mcpContext,
    skillsContext || mcpContext ? `当前已启用的技能列表与工具调用规范：\n${skillsContext || "无已启用本地技能"}\n\n${toolsSystemInstruction}` : "",
    memoryContext ? `用户维护的长期记忆，在相关时使用，不要无意义提及：\n${memoryContext}` : "",
    ragContext ? `当前对话上传文件检索结果，仅在回答当前问题相关时使用：\n${ragContext}` : ""
  ].filter(Boolean);

  return {
    role: "system",
    content: `${systemMessage.content}\n\n${sections.join("\n\n")}`
  };
}

function formatProjectFileTree(files: ProjectFileEntry[]) {
  return files
    .map((file) => {
      const depth = Math.max(0, file.path.split("/").length - 1);
      const indent = "  ".repeat(depth);
      const name = file.path.split("/").pop() || file.path;
      const suffix = file.is_dir ? "/" : file.size != null ? ` (${formatBytes(file.size)})` : "";
      return `${indent}- ${name}${suffix}`;
    })
    .join("\n");
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatStdioCommandLine(draft: McpServerDraft) {
  const args = parseJsonStringArray(draft.args_json);
  return [draft.command, ...args].filter(Boolean).map(quoteCommandPart).join(" ");
}

function parseStdioCommandLine(value: string) {
  const parts = splitCommandLine(value.trim());
  if (parts.length === 0 || !parts[0]) {
    throw new Error("stdio 命令不能为空。");
  }
  return {
    command: parts[0],
    args: parts.slice(1)
  };
}

function parseJsonStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function quoteCommandPart(value: string) {
  if (!value) return "";
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function splitCommandLine(value: string) {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      if (quote === '"' && char === "\\" && (next === '"' || next === "\\")) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new Error("stdio 命令中的引号未闭合。");
  }
  if (current) parts.push(current);
  return parts;
}

function formatMcpTransportLabel(transport: string) {
  if (transport === "streamable_http") return "Streamable HTTP";
  if (transport === "sse") return "SSE";
  return "stdio";
}

function isSupportedRagFile(name: string) {
  return /\.(txt|md|markdown|json|csv|tsv|log|js|jsx|ts|tsx|rs|py|java|go|yaml|yml|toml|html|css|xml)$/i.test(name);
}

function buildRuntimeContext() {
  const now = new Date();
  const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short"
  });

  return [
    "运行上下文：",
    `- 当前本地日期时间：${dateTimeFormatter.format(now)}`,
    `- 当前 ISO 时间：${now.toISOString()}`,
    "- 用户询问当前日期、时间、今天、明天、昨天或相对日期时，必须以本运行上下文为准。"
  ].join("\n");
}

const MAX_CONTEXT_TOKENS = 4000;

function estimateTokens(content: string): number {
  const chineseChars = content.match(/[\u4e00-\u9fa5]/g) || [];
  const englishWords = content.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
  return chineseChars.length + Math.ceil(englishWords.length * 1.3);
}

function buildAgentTimelineEvents(timeline: AgentRunTimeline): AgentTimelineEvent[] {
  const stepEvents = timeline.steps.map((step) => ({
    id: `step-${step.id}`,
    time: step.created_at,
    status: step.status,
    title: formatAgentStepTitle(step),
    subtitle: `step / ${step.kind}`,
    detail: [step.input_summary, step.output_summary, step.metadata_json]
      .filter(Boolean)
      .join("\n")
  }));

  const toolEvents = timeline.tool_calls.map((toolCall) => ({
    id: `tool-${toolCall.id}`,
    time: toolCall.created_at,
    status: toolCall.status,
    title: `工具请求：${toolCall.name}`,
    subtitle: `tool_call / message ${toolCall.message_id.slice(0, 8)}`,
    detail: [
      toolCall.args_json ? `args: ${toolCall.args_json}` : "",
      toolCall.result_summary,
      toolCall.error ? `error: ${toolCall.error}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  }));

  return [...stepEvents, ...toolEvents].sort(
    (left, right) => Date.parse(left.time) - Date.parse(right.time)
  );
}

function formatAgentRunTitle(run: AgentRun) {
  const trigger = run.trigger_message_id ? `message ${run.trigger_message_id.slice(0, 8)}` : "manual";
  return `${formatRuntimeStatus(run.status)} · ${trigger}`;
}

function formatAgentStepTitle(step: AgentStep) {
  const labels: Record<string, string> = {
    message: "用户消息",
    model: "模型调用",
    model_continue: "模型继续",
    tool: "工具执行",
    approval: "审批",
    memory: "记忆写入",
    error: "错误"
  };
  return labels[step.kind] || step.kind;
}

function formatRuntimeStatus(status: string) {
  const labels: Record<string, string> = {
    running: "运行中",
    awaiting_tool: "等待工具",
    pending_approval: "等待审批",
    approved: "已批准",
    rejected: "已拒绝",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  };
  return labels[status] || status;
}

function formatShortTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDuration(durationMs: number) {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)} s`;
  }
  return `${durationMs} ms`;
}

function buildObservabilitySpanDetail(span: ObservabilitySpan) {
  return [
    span.input_summary ? `输入：${span.input_summary}` : "",
    span.output_summary ? `输出：${span.output_summary}` : "",
    span.error ? `错误：${span.error}` : "",
    span.metadata_json ? `元数据：${span.metadata_json}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function safeCreateAgentRun(draft: AgentRunDraft): Promise<AgentRun | null> {
  try {
    return await createAgentRun(draft);
  } catch (error) {
    console.error("Failed to create agent run:", error);
    return null;
  }
}

async function safeFinishAgentRun(
  id: string,
  status: string,
  error?: string | null
): Promise<AgentRun | null> {
  try {
    return await finishAgentRun(id, status, error);
  } catch (err) {
    console.error("Failed to finish agent run:", err);
    return null;
  }
}

async function safeRecordAgentStep(draft: AgentStepDraft) {
  try {
    return await recordAgentStep(draft);
  } catch (error) {
    console.error("Failed to record agent step:", error);
    return null;
  }
}

async function safeResolveAgentModelOutput(
  runId: string,
  messageId: string,
  content: string,
  stepKind: string,
  inputSummary: string
) {
  try {
    return await resolveAgentModelOutput(runId, messageId, content, stepKind, inputSummary);
  } catch (error) {
    console.error("Failed to resolve agent model output:", error);
    return null;
  }
}

async function safeExecuteAgentToolCall(request: AgentToolExecutionRequest) {
  try {
    return await executeAgentToolCall(request);
  } catch (error) {
    console.error("Failed to execute agent tool call:", error);
    throw new Error(formatErrorMessage(error));
  }
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function safeApproveAgentToolCall(id: string): Promise<AgentToolCall | null> {
  try {
    return await approveAgentToolCall(id);
  } catch (error) {
    console.error("Failed to approve agent tool call:", error);
    return null;
  }
}

async function safeRejectAgentToolCall(
  id: string,
  reason?: string | null
): Promise<AgentToolCall | null> {
  try {
    return await rejectAgentToolCall(id, reason);
  } catch (error) {
    console.error("Failed to reject agent tool call:", error);
    return null;
  }
}

async function safeCreateAgentToolCall(
  draft: AgentToolCallDraft
): Promise<AgentToolCall | null> {
  try {
    return await createAgentToolCall(draft);
  } catch (error) {
    console.error("Failed to create agent tool call:", error);
    return null;
  }
}

async function safeUpdateAgentToolCall(
  id: string,
  status: string,
  resultSummary?: string | null,
  error?: string | null
): Promise<AgentToolCall | null> {
  try {
    return await updateAgentToolCall(id, status, resultSummary, error);
  } catch (err) {
    console.error("Failed to update agent tool call:", err);
    return null;
  }
}

interface DetailSection {
  label: string;
  type: string;
  content: string;
  icon?: string;
}

function parseDetailSections(detail: string): DetailSection[] {
  const prefixes = [
    { key: "输入：", label: "输入 (Input)", type: "input", icon: "📥" },
    { key: "输出：", label: "输出 (Output)", type: "output", icon: "📤" },
    { key: "错误：", label: "错误 (Error)", type: "error", icon: "❌" },
    { key: "元数据：", label: "元数据 (Metadata)", type: "metadata", icon: "⚙️" },
    { key: "args: ", label: "参数 (Arguments)", type: "args", icon: "🔧" },
    { key: "error: ", label: "错误 (Error)", type: "error", icon: "❌" }
  ];

  const matches: { index: number; key: string; label: string; type: string; icon: string }[] = [];
  
  prefixes.forEach((pref) => {
    let pos = detail.indexOf(pref.key);
    while (pos !== -1) {
      matches.push({ index: pos, ...pref });
      pos = detail.indexOf(pref.key, pos + 1);
    }
  });

  matches.sort((a, b) => a.index - b.index);

  if (matches.length === 0) {
    return [{ label: "详情 (Detail)", type: "general", content: detail.trim() }];
  }

  const sections: DetailSection[] = [];
  
  const firstMatchIndex = matches[0].index;
  if (firstMatchIndex > 0) {
    const leadContent = detail.substring(0, firstMatchIndex).trim();
    if (leadContent) {
      sections.push({ label: "详情 (Detail)", type: "general", content: leadContent });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const startIndex = currentMatch.index + currentMatch.key.length;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : detail.length;
    
    const content = detail.substring(startIndex, endIndex).trim();
    sections.push({
      label: currentMatch.label,
      type: currentMatch.type,
      content,
      icon: currentMatch.icon
    });
  }

  return sections;
}

function ObservabilityDetailPanel({ detail }: { detail: string }) {
  const sections = parseDetailSections(detail);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="trace-detail-panel">
      {sections.map((section, idx) => {
        let isJson = false;
        let formattedContent = section.content;

        if (section.type === "metadata" || section.type === "args" || section.content.startsWith("{") || section.content.startsWith("[")) {
          try {
            const parsed = JSON.parse(section.content);
            formattedContent = JSON.stringify(parsed, null, 2);
            isJson = true;
          } catch (e) {
            // Keep original if parsing fails
          }
        }

        const isError = section.type === "error";

        return (
          <div key={idx} className={`trace-detail-section ${section.type} ${isError ? "error" : ""}`}>
            <div className="trace-detail-section-header">
              <span className="trace-detail-section-title">
                {section.icon && <span className="trace-detail-section-icon">{section.icon}</span>}
                {section.label}
              </span>
              <button
                className="trace-detail-copy-btn"
                onClick={() => handleCopy(formattedContent, idx)}
                type="button"
                title="复制内容"
              >
                {copiedIndex === idx ? "已复制 ✓" : "复制"}
              </button>
            </div>
            <div className="trace-detail-section-body">
              <pre className={isJson ? "json" : ""}>{formattedContent}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default App;
