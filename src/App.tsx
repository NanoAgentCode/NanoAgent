import { useEffect, useMemo, useRef, useState } from "react";
import { setTheme } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  Activity,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Edit,
  FileText,
  Folder,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Save,
  Search,
  SendHorizontal,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  X
} from "lucide-react";
import {
  appendMessage,
  archiveConversation,
  renameConversation,
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
  internetSearch,
  listEnabledMemories,
  listArchivedConversations,
  listConversations,
  listItems,
  listMemories,
  listMessages,
  listModelConfigs,
  listProjectFiles,
  saveModelConfig,
  searchItems,
  searchMemories,
  listLocalSkills,
  executeBashCommand,
  writeLocalFile,
  readLocalFile,
  updateItem,
  updateMemory,
  checkEnv,
  installEnv,
  listObservabilitySpans,
  clearObservabilitySpans
} from "./api";
import MarkdownMessage from "./MarkdownMessage";
import type {
  ChatMessage,
  ChatStreamEvent,
  Conversation,
  Item,
  ItemKind,
  Memory,
  ModelConfig,
  ModelConfigDraft,
  ObservabilitySpan,
  ProjectEntry,
  ProjectFileEntry,
  PersistedMessage,
  WebSearchResult
} from "./types";

const kindLabels: Record<ItemKind, string> = {
  note: "笔记",
  task: "备忘录",
  prompt: "提示词"
};

const statusLabels: Record<string, string> = {
  active: "活跃",
  todo: "待办",
  done: "已完成",
  archived: "已归档",
  reminded: "已提醒"
};

type WorkspaceView = ItemKind | "all" | "memory";
type ThemeMode = "system" | "light" | "dark";
type SettingsTab =
  | "task"
  | "prompt"
  | "memory"
  | "theme"
  | "archive"
  | "model"
  | "skills"
  | "mcp"
  | "observability";

const workspaceLabels: Record<WorkspaceView, string> = {
  all: "全部",
  note: "笔记",
  task: "备忘录",
  prompt: "提示词",
  memory: "记忆库"
};

const repeatLabels: Record<string, string> = {
  none: "不重复",
  daily: "每天",
  weekly: "每周",
  monthly: "每月"
};

interface ReminderDraft {
  title: string;
  body: string;
  reminder_at: string;
  repeat_rule: string;
}

const systemMessage: ChatMessage = {
  role: "system",
  content: "你是一个专注的本地效率助手。请保持回答简明且实用。记忆写入由应用本地功能处理；除非应用明确提供结果，否则不要声称已经保存或更新记忆。"
};

const emptyModelDraft: ModelConfigDraft = {
  name: "OpenAI",
  provider: "openai-compatible",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  api_key: ""
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

const themeLabels: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "白天",
  dark: "夜晚"
};

const projectStorageKey = "nano-agent-projects";
const activeProjectStorageKey = "nano-agent-active-project-id";
const tavilyApiKeyStorageKey = "nano-agent-tavily-api-key";

function loadSavedProjects() {
  const saved = localStorage.getItem(projectStorageKey);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved) as ProjectEntry[];
    return parsed.filter((project) => project.id && project.name && project.path);
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
    id: "web_search",
    name: "Web Search",
    provider: "NanoAgent",
    description: "优先使用应用内 Tavily API Key 调用本机 Tavily Agent Skill / CLI；不可用时自动回退到内置 DuckDuckGo 检索。",
    enabled: false,
    parameters: {
      engine: "Tavily + DuckDuckGo fallback"
    },
    docUrl: "https://github.com/google-deepmind/antigravity"
  }
];

function normalizeSkills(skills: Skill[]) {
  return skills.map((skill) =>
    skill.id === "web_search"
      ? {
          ...skill,
          description: "优先使用应用内 Tavily API Key 调用本机 Tavily Agent Skill / CLI；不可用时自动回退到内置 DuckDuckGo 检索。",
          parameters: {
            ...skill.parameters,
            engine: "Tavily + DuckDuckGo fallback"
          }
        }
      : skill
  );
}

function App() {
  const listRequestRef = useRef(0);
  const messageLoadRequestRef = useRef(0);
  const activeConversationIdRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeKind, setActiveKind] = useState<WorkspaceView>("task");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [status, setStatus] = useState("active");
  const [reminderAt, setReminderAt] = useState("");
  const [repeatRule, setRepeatRule] = useState("none");
  const [memoryItems, setMemoryItems] = useState<Memory[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryTagsText, setMemoryTagsText] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelDraft, setModelDraft] = useState<ModelConfigDraft>(emptyModelDraft);
  const [activeModelId, setActiveModelId] = useState("");
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
  const [promptSuggestions, setPromptSuggestions] = useState<Item[]>([]);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [promptTriggerIndex, setPromptTriggerIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("task");
  const [observabilitySpans, setObservabilitySpans] = useState<ObservabilitySpan[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState("");
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
  const [isSyncing, setIsSyncing] = useState(false);
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
  const [tavilyApiKey, setTavilyApiKey] = useState(() => localStorage.getItem(tavilyApiKeyStorageKey) || "");
  const [envStatus, setEnvStatus] = useState<Record<string, boolean>>({ node: true, python: true });
  const [showCustomPaths, setShowCustomPaths] = useState(false);
  const [showEnvActionsMenu, setShowEnvActionsMenu] = useState(false);
  const [showEnvPrompt, setShowEnvPrompt] = useState(false);
  const [isCheckingEnv, setIsCheckingEnv] = useState(false);
  const [isInstallingEnv, setIsInstallingEnv] = useState(false);
  const [envInstallProgress, setEnvInstallProgress] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => {
    const saved = localStorage.getItem("nano-agent-skills");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Skill[];
        const webSearch = parsed.find((s) => s.id === "web_search");
        if (webSearch) return webSearch.enabled;
      } catch (e) {
        // ignore
      }
    }
    return false;
  });
  const [pendingReminder, setPendingReminder] = useState<ReminderDraft | null>(null);
  const [activeReminder, setActiveReminder] = useState<Item | null>(null);
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
  const selectedItemIsTask = selectedItem?.kind === "task";
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
    void loadAll();
    void checkLocalSkills();
    
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
      const resolvedTheme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = themeMode;
      localStorage.setItem("nano-agent-theme", themeMode);
      void setTheme(themeMode === "system" ? null : themeMode);
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
      setReminderAt("");
      setRepeatRule("none");
      return;
    }

    setTitle(selectedItem.title);
    setBody(selectedItem.body);
    setTagsText(selectedItem.tags.join(", "));
    setStatus(selectedItem.status);
    setReminderAt(toLocalDateTimeInput(selectedItem.reminder_at));
    setRepeatRule(selectedItem.repeat_rule || "none");
  }, [selectedItem]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void checkDueReminders();
    }, 30_000);
    void checkDueReminders();
    return () => window.clearInterval(timer);
  }, [items]);

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
    activeConversationIdRef.current = activeConversationId;
    setMessageReasoning({});
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    void loadMessages(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    if (showModelConfig && activeSettingsTab === "observability") {
      void refreshObservability();
    }
  }, [showModelConfig, activeSettingsTab]);

  async function refreshObservability() {
    setIsLoadingObservability(true);
    try {
      const spans = await listObservabilitySpans(200);
      setObservabilitySpans(spans);
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
      setSelectedTraceId("");
    } catch (error) {
      setNotice(String(error));
    }
  }

  async function loadAll() {
    try {
      const [nextItems, nextModels, nextConversations, nextArchivedConversations, nextMemories] = await Promise.all([
        listItems(),
        listModelConfigs(),
        listConversations(),
        listArchivedConversations(),
        loadVisibleMemories("")
      ]);
      setItems(nextItems);
      setModels(nextModels);
      setConversations(nextConversations);
      setArchivedConversations(nextArchivedConversations);
      setMemoryItems(nextMemories);
      setSelectedId((current) => current || nextItems[0]?.id || "");
      setActiveModelId((current) => current || nextModels[0]?.id || "");
      setActiveConversationId((current) => current || nextConversations[0]?.id || "");
      setSelectedMemoryId((current) => current || nextMemories[0]?.id || "");
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
    if (id === "web_search") {
      setWebSearchEnabled(enabled);
    }
  }

  function handleToggleWebSearch() {
    setWebSearchEnabled((prev) => {
      const next = !prev;
      const nextSkills = skills.map((s) =>
        s.id === "web_search" ? { ...s, enabled: next } : s
      );
      setSkills(nextSkills);
      localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
      return next;
    });
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

  function upsertProject(path: string) {
    const normalizedPath = path.trim();
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
    setTimeout(() => setNotice(""), 3000);
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
      setTimeout(() => setNotice(""), 5000);
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
      setTimeout(() => setNotice(""), 5000);
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!newProjectParent || !name) {
      setNotice("请选择父目录并填写项目名称");
      setTimeout(() => setNotice(""), 3000);
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
      setTimeout(() => setNotice(""), 5000);
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
    setTimeout(() => setNotice(""), 3000);
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

  async function runEnvCheck() {
    setIsCheckingEnv(true);
    try {
      const status = await checkEnv(nodePath, pythonPath);
      setEnvStatus(status);
      return status;
    } catch (e) {
      console.error("Failed to check environment:", e);
      return { node: false, python: false };
    } finally {
      setIsCheckingEnv(false);
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
      setTimeout(() => setNotice(""), 5000);
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
      setTimeout(() => setNotice(""), 5000);
    }
  }

  function handleSaveTavilyApiKey() {
    const trimmed = tavilyApiKey.trim();
    if (trimmed) {
      localStorage.setItem(tavilyApiKeyStorageKey, trimmed);
      setTavilyApiKey(trimmed);
      setNotice("Tavily API Key 已保存。");
    } else {
      localStorage.removeItem(tavilyApiKeyStorageKey);
      setNotice("Tavily API Key 已清空，将使用系统环境变量或 DuckDuckGo 兜底。");
    }
    setTimeout(() => setNotice(""), 3000);
  }

  function handleDeleteSkill(id: string) {
    if (confirm("确定要删除该技能吗？")) {
      const nextSkills = skills.filter((s) => s.id !== id);
      setSkills(nextSkills);
      localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
      if (selectedSkillId === id) {
        setSelectedSkillId(nextSkills.length > 0 ? nextSkills[0].id : "");
      }
      setNotice("技能已成功删除！");
      setTimeout(() => setNotice(""), 3000);
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
    setTimeout(() => setNotice(""), 3000);
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
      status: kind === "task" ? "todo" : "active",
      tags: [],
      reminder_at: null,
      repeat_rule: null
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

    const isTask = selectedItem.kind === "task";
    await updateItem({
      id: selectedItem.id,
      title,
      body,
      status,
      tags: parseTags(tagsText),
      reminder_at: isTask ? fromLocalDateTimeInput(reminderAt) : null,
      repeat_rule: isTask && repeatRule !== "none" ? repeatRule : null
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

  async function createReminderFromDraft(draft: ReminderDraft) {
    const item = await createItem({
      kind: "task",
      title: draft.title,
      body: draft.body,
      status: "todo",
      tags: ["reminder"],
      reminder_at: fromLocalDateTimeInput(draft.reminder_at),
      repeat_rule: draft.repeat_rule === "none" ? null : draft.repeat_rule
    });
    setPendingReminder(null);
    setActiveKind("task");
    setQuery("");
    await refreshItems("", "task");
    setSelectedId(item.id);
    setNotice("备忘录已添加");
  }

  async function checkDueReminders() {
    if (activeReminder) {
      return;
    }

    const reminders = await listItems("task");
    const now = Date.now();
    const due = reminders.find((item) => {
      if (!item.reminder_at || item.status === "done") {
        return false;
      }
      const reminderTime = Date.parse(item.reminder_at);
      const lastRemindedTime = item.last_reminded_at ? Date.parse(item.last_reminded_at) : 0;
      return reminderTime <= now && reminderTime > lastRemindedTime;
    });

    if (due) {
      setActiveReminder(due);
    }
  }

  async function dismissReminder(item: Item) {
    const nextReminderAt = getNextReminderAt(item.reminder_at, item.repeat_rule);
    await updateItem({
      id: item.id,
      status: nextReminderAt ? item.status : "reminded",
      reminder_at: nextReminderAt,
      repeat_rule: item.repeat_rule || null,
      last_reminded_at: new Date().toISOString()
    });
    setActiveReminder(null);
    await refreshItems(query, activeKind);
  }

  async function handleSaveModel() {
    const saved = await saveModelConfig(modelDraft);
    const nextModels = await listModelConfigs();
    setModels(nextModels);
    setActiveModelId(saved.id);
    setModelDraft({ ...saved });
    setNotice("模型配置已保存");
  }

  async function handleEditModel(id: string) {
    if (!id) {
      setModelDraft(emptyModelDraft);
      return;
    }
    const model = models.find((item) => item.id === id);
    if (model) {
      setModelDraft({ ...model });
    }
  }

  function handleOpenModelConfig() {
    const model = models.find((item) => item.id === activeModelId);
    setModelDraft(model ? { ...model } : emptyModelDraft);
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
      setActiveModelId(nextModels[0]?.id || "");
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
          : current.model
    }));
  }

  async function createConversationForCurrentScope(project: ProjectEntry | null = activeProject) {
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

  async function handleNewConversation() {
    {
      const scopedConversation = await createConversationForCurrentScope();
      setActiveConversationId(scopedConversation.id);
      setMessages([]);
      return;
    }

    const conversation = await createConversation({
      title: "新对话",
      model_config_id: activeModelId || null
    });
    await refreshConversations(conversation.id);
    setMessages([]);
  }

  async function handleNewProjectConversation(project: ProjectEntry) {
    {
      selectProject(project);
      const scopedConversation = await createConversationForCurrentScope(project);
      setActiveConversationId(scopedConversation.id);
      setMessages([]);
      return;
    }

    selectProject(project);
    const conversation = await createConversation({
      title: "新对话",
      model_config_id: activeModelId || null,
      project_path: project.path
    });
    await refreshProjectConversationMap(projects);
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

  async function ensureConversation() {
    if (activeConversationId) {
      return activeConversationId;
    }

    {
      const scopedConversation = await createConversationForCurrentScope();
      setActiveConversationId(scopedConversation.id);
      return scopedConversation.id;
    }

    const conversation = await createConversation({
      title: "新对话",
      model_config_id: activeModelId || null
    });
    await refreshConversations(conversation.id);
    return conversation.id;
  }

  const [executingToolMessageId, setExecutingToolMessageId] = useState<string | null>(null);

  async function triggerLlmContinue(conversationId: string, currentMessages: PersistedMessage[]) {
    const conversationForRequest = findConversationById(conversationId);
    const projectForRequest = findConversationProject(conversationForRequest);
    const enabledMemories = await listEnabledMemories();
    const webResults: any[] = [];
    let projectFiles: ProjectFileEntry[] = [];
    if (projectForRequest?.path) {
      try {
        projectFiles = await listProjectFiles(projectForRequest.path);
      } catch (error) {
        console.error("Failed to list project files:", error);
      }
    }

    const modelMessages: ChatMessage[] = [
      buildSystemMessage(enabledMemories, webResults, projectForRequest, projectFiles, skills, tempDir),
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
      await chatStream(requestId, activeModelId, modelMessages, 0.4, conversationId);
    } catch (err) {
      streamFailed = true;
      console.error("Continue streaming failed:", err);
      setNotice(`Conversation reply failed: ${String(err)}`);
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

    try {
      const conversationId = await ensureConversation();
      const conversationForRequest = findConversationById(conversationId);
      const projectForRequest = findConversationProject(conversationForRequest);
      const projectPath = projectForRequest?.path || tempDir;

      let resultText = "";

      if (toolCall.name === "write_file") {
        const path = toolCall.args.path;
        const content = toolCall.args.content || "";
        if (!path) throw new Error("缺少 path 参数");
        await writeLocalFile(projectPath, path, content);
        resultText = `File ${path} written successfully; content length: ${content.length} characters.`;
      } else if (toolCall.name === "read_file") {
        const path = toolCall.args.path;
        if (!path) throw new Error("缺少 path 参数");
        const content = await readLocalFile(projectPath, path);
        resultText = `读取文件 ${path} 成功，内容如下：\n\n\`\`\`\n${content}\n\`\`\``;
      } else if (toolCall.name === "execute_command") {
        const command = toolCall.args.command;
        if (!command) throw new Error("缺少 command 参数");
        const isBashEnabled = skills.find((s) => s.id === "bash_tool")?.enabled;
        if (!isBashEnabled) {
          throw new Error("Bash Tool 技能已被禁用，请在设置中启用后再试。");
        }
        const output = await executeBashCommand(projectPath, command);
        resultText = `命令执行成功，输出结果如下：\n\n\`\`\`\n${output}\n\`\`\``;
      } else {
        throw new Error(`未知的工具类型: ${toolCall.name}`);
      }

      const userMessage = await appendMessage({
        conversation_id: conversationId,
        role: "user",
        content: `[工具执行结果: ${toolCall.name}] 执行结果如下：\n\n${resultText}`
      });

      const updatedMessages = await listMessages(conversationId);
      setMessages(updatedMessages);

      void triggerLlmContinue(conversationId, updatedMessages);
    } catch (error) {
      console.error("Tool execution failed:", error);
      setNotice(`工具执行失败: ${String(error)}`);
      
      try {
        const conversationId = await ensureConversation();
        await appendMessage({
          conversation_id: conversationId,
          role: "user",
          content: `[工具执行结果: ${toolCall.name}] 执行失败: ${String(error)}`
        });
        const updatedMessages = await listMessages(conversationId);
        setMessages(updatedMessages);
        void triggerLlmContinue(conversationId, updatedMessages);
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
      const conversationId = await ensureConversation();
      await appendMessage({
        conversation_id: conversationId,
        role: "user",
        content: `[工具执行结果: ${toolCall.name}] 用户拒绝了执行该工具请求。`
      });
      const updatedMessages = await listMessages(conversationId);
      setMessages(updatedMessages);
      void triggerLlmContinue(conversationId, updatedMessages);
    } catch (error) {
      console.error("Reject tool failed:", error);
    } finally {
      setBusy(false);
    }
  }

  async function handleSendMessage() {
    const content = chatInput.trim();
    const memoryDraft = extractMemoryDraft(content);
    const reminderDraft = extractReminderDraft(content);

    if (!content || (!activeModelId && !memoryDraft && !reminderDraft)) {
      setNotice(activeModelId ? "" : "请先保存并选择一个模型");
      return;
    }

    setChatInput("");
    setBusy(true);

    try {
      const conversationId = await ensureConversation();
      const conversationForRequest = findConversationById(conversationId);
      const projectForRequest = findConversationProject(conversationForRequest);
      const persistedMessages = await listMessages(conversationId);
      const userMessage = await appendMessage({
        conversation_id: conversationId,
        role: "user",
        content
      });
      const nextMessages = [...persistedMessages, userMessage];
      setMessages(nextMessages);

      if (reminderDraft) {
        setPendingReminder(reminderDraft);
        setBusy(false);
        return;
      }

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
        if (projectForRequest) {
          await refreshProjectConversationMap(projects);
        } else {
          await refreshConversations(conversationId);
        }
        return;
      }

      const enabledMemories = await listEnabledMemories();
      const webResults = webSearchEnabled ? await internetSearch(content, tavilyApiKey) : [];
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

      const modelMessages: ChatMessage[] = [
        buildSystemMessage(enabledMemories, webResults, projectForRequest, projectFiles, skills, tempDir),
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

      await chatStream(requestId, activeModelId, modelMessages, 0.4, conversationId);
      unlisten();

      if (!streamedContent.trim()) {
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
                className="icon-only-btn" 
                onClick={() => void handleNewItem(activeKind === "all" ? "note" : activeKind as ItemKind)}
                title={`新建${kindLabels[activeKind as ItemKind] || "备忘录"}`}
                aria-label={`新建${kindLabels[activeKind as ItemKind] || "备忘录"}`}
                type="button"
              >
                <Plus />
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
                  <button className="icon-only-btn success-btn" onClick={handleSaveMemory} disabled={!selectedMemory} aria-label="保存" title="保存" type="button"><Save /></button>
                  <button className="icon-only-btn danger-btn" aria-label="删除记忆" title="删除记忆" onClick={handleDeleteMemory} disabled={!selectedMemory} type="button">
                    <Trash2 />
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
                  <button className="icon-only-btn success-btn" onClick={handleSaveItem} disabled={!selectedItem} aria-label="保存" title="保存" type="button"><Save /></button>
                  <button className="icon-only-btn danger-btn" aria-label="删除项目" title="删除项目" onClick={handleDeleteItem} disabled={!selectedItem} type="button">
                    <Trash2 />
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
                placeholder="在此编写笔记、备忘录详情或提示词模板..."
                disabled={!selectedItem}
              />
              {selectedItemIsTask && (
                <div className="reminder-controls">
                  <label>
                    <span>提醒时间</span>
                    <input
                      type="datetime-local"
                      value={reminderAt}
                      onChange={(event) => setReminderAt(event.target.value)}
                      disabled={!selectedItem}
                    />
                  </label>
                  <label>
                    <span>周期提醒</span>
                    <select value={repeatRule} onChange={(event) => setRepeatRule(event.target.value)} disabled={!selectedItem}>
                      <option value="none">不重复</option>
                      <option value="daily">每天</option>
                      <option value="weekly">每周</option>
                      <option value="monthly">每月</option>
                    </select>
                  </label>
                </div>
              )}
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
                className={selectedTrace?.traceId === trace.traceId ? "observability-trace-row active" : "observability-trace-row"}
                onClick={() => setSelectedTraceId(trace.traceId)}
                type="button"
              >
                <div>
                  <strong>{trace.lastOperation || "trace"}</strong>
                  <span>{trace.traceId}</span>
                </div>
                <small>
                  {trace.spans.length} spans · {trace.duration} ms
                  {trace.errors > 0 ? ` · ${trace.errors} errors` : ""}
                </small>
              </button>
            ))}
            {traceGroups.length === 0 && (
              <div className="empty">暂无链路记录</div>
            )}
          </aside>

          <section className="observability-span-list">
            {selectedTrace ? (
              <>
                <div className="observability-trace-summary">
                  <strong>{selectedTrace.traceId}</strong>
                  <span>{selectedTrace.spans.length} spans · {selectedTrace.duration} ms</span>
                </div>
                <div className="observability-timeline">
                  {selectedTrace.spans.map((span) => (
                    <div key={span.id} className={`observability-span-row ${span.status}`}>
                      <div className="observability-span-main">
                        <span className="observability-status-dot" />
                        <div>
                          <strong>{span.operation}</strong>
                          <small>{span.category}{span.entity_type ? ` / ${span.entity_type}` : ""}</small>
                        </div>
                      </div>
                      <div className="observability-span-meta">
                        <span>{span.duration_ms ?? 0} ms</span>
                        <span>{new Date(span.started_at).toLocaleString()}</span>
                      </div>
                      {(span.input_summary || span.output_summary || span.error) && (
                        <pre>
                          {[span.input_summary, span.output_summary, span.error ? `error: ${span.error}` : ""]
                            .filter(Boolean)
                            .join("\n")}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
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
    <main className="app-shell">
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
                  className={activeSettingsTab === "task" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => {
                    setActiveSettingsTab("task");
                    handleKindChange("task");
                  }}
                >
                  <CheckSquare size={16} />
                  <span>备忘录</span>
                </button>
                <button
                  className={activeSettingsTab === "prompt" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => {
                    setActiveSettingsTab("prompt");
                    handleKindChange("prompt");
                  }}
                >
                  <MessageSquare size={16} />
                  <span>提示词</span>
                </button>
                <button
                  className={activeSettingsTab === "memory" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => {
                    setActiveSettingsTab("memory");
                    handleKindChange("memory");
                  }}
                >
                  <Brain size={16} />
                  <span>记忆库</span>
                </button>
                <button
                  className={activeSettingsTab === "theme" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("theme")}
                >
                  <Sun size={16} />
                  <span>主题选择</span>
                </button>
                <button
                  className={activeSettingsTab === "archive" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("archive")}
                >
                  <Archive size={16} />
                  <span>归档列表</span>
                </button>
                <button
                  className={activeSettingsTab === "model" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("model")}
                >
                  <Bot size={16} />
                  <span>模型管理</span>
                </button>
                <button
                  className={activeSettingsTab === "skills" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("skills")}
                >
                  <Sparkles size={16} />
                  <span>Skills管理</span>
                </button>
                <button
                  className={activeSettingsTab === "observability" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("observability")}
                >
                  <Activity size={16} />
                  <span>链路追踪</span>
                </button>
                <button
                  className={activeSettingsTab === "mcp" ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setActiveSettingsTab("mcp")}
                >
                  <Monitor size={16} />
                  <span>MCP配置</span>
                </button>
              </aside>

              <div className="settings-content">
                {activeSettingsTab === "task" && (
                  <div className="settings-tab-content">
                    <h3>备忘录</h3>
                    <p className="description">管理待办任务，设置定时提醒，让您的日程有条不紊。</p>
                    {renderWorkspaceGrid()}
                  </div>
                )}

                {activeSettingsTab === "prompt" && (
                  <div className="settings-tab-content">
                    <h3>提示词</h3>
                    <p className="description">管理常用的AI提示词模板，快速插入到对话框中。</p>
                    {renderWorkspaceGrid()}
                  </div>
                )}

                {activeSettingsTab === "memory" && (
                  <div className="settings-tab-content">
                    <h3>记忆库</h3>
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
                        const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
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
                            <div key={conversation.id} className={`archived-row ${previewArchivedId === conversation.id ? "active" : ""}`}>
                              <button onClick={() => void loadArchivedPreview(conversation.id)}>
                                <strong>{conversation.title}</strong>
                                <span>{conversation.archived_at || conversation.updated_at}</span>
                              </button>
                              <button
                                className="icon-only-btn"
                                aria-label="恢复并回复"
                                title="恢复并回复"
                                onClick={() => void handleRestoreConversation(conversation)}
                                type="button"
                              >
                                <RotateCcw />
                              </button>
                              <button
                                className="icon-only-btn danger-btn"
                                aria-label="删除归档对话"
                                title="删除归档对话"
                                onClick={() => void handleDeleteArchivedConversation(conversation)}
                                type="button"
                              >
                                <Trash2 />
                              </button>
                            </div>
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
                              <button
                                className="primary compact-btn"
                                onClick={() => {
                                  const conversation = archivedConversations.find((c) => c.id === previewArchivedId);
                                  if (conversation) {
                                    void handleRestoreConversation(conversation);
                                  }
                                }}
                              >
                                <RotateCcw size={14} />
                                <span>恢复该对话</span>
                              </button>
                            </div>
                            <div className="archive-preview-messages-container">
                              <div className="chat-log">
                                {previewMessages.map((message) => (
                                  <div key={message.id} className={`chat-message ${message.role}`}>
                                    <MarkdownMessage content={message.content} />
                                  </div>
                                ))}
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

                {activeSettingsTab === "model" && (
                  <div className="settings-tab-content model-tab-content">
                    <div className="model-header-row">
                      <h3>模型管理</h3>
                      <button className="icon-only-btn compact" onClick={handleNewModelConfig} title="新建配置" aria-label="新建配置" type="button"><Plus /></button>
                    </div>
                    <p className="description" style={{ marginTop: "-4px" }}>配置OpenAI兼容接口或Claude原生模型，供AI助手对话使用。</p>
                    <div className="model-config-grid">
                      <aside className="model-config-list">
                        {models.map((model) => (
                          <button
                            key={model.id}
                            className={model.id === modelDraft.id ? "model-config-row active" : "model-config-row"}
                            onClick={() => setModelDraft({ ...model })}
                          >
                            <strong>{model.name}</strong>
                            <span>{model.provider} / {model.model}</span>
                          </button>
                        ))}
                        {models.length === 0 && <div className="empty">暂无模型配置</div>}
                      </aside>

                      <div className="model-config-form">
                        <input
                          value={modelDraft.name}
                          onChange={(event) => setModelDraft({ ...modelDraft, name: event.target.value })}
                          placeholder="名称"
                        />
                        <select
                          value={modelDraft.provider}
                          onChange={(event) => handleProviderChange(event.target.value)}
                        >
                          <option value="openai-compatible">OpenAI 兼容协议</option>
                          <option value="anthropic">Anthropic Claude</option>
                        </select>
                        <input
                          value={modelDraft.base_url}
                          onChange={(event) => setModelDraft({ ...modelDraft, base_url: event.target.value })}
                          placeholder="接口地址"
                        />
                        <input
                          value={modelDraft.model}
                          onChange={(event) => setModelDraft({ ...modelDraft, model: event.target.value })}
                          placeholder="模型标识"
                        />
                        <input
                          value={modelDraft.api_key}
                          type="password"
                          onChange={(event) => setModelDraft({ ...modelDraft, api_key: event.target.value })}
                          placeholder="密钥"
                        />
                        <div className="modal-actions icon-actions">
                          <button className="icon-only-btn success-btn" onClick={handleSaveModel} aria-label="保存并使用" title="保存并使用" type="button"><Save /></button>
                          <button className="icon-only-btn danger-btn" aria-label="删除模型" title="删除模型" onClick={handleDeleteModel} disabled={!modelDraft.id} type="button">
                            <Trash2 />
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

                    {/* Environment status and manual/auto configuration block */}
                    <div className="env-status-banner">
                      <div className="env-status-main">
                        <div className="env-status-left">
                          <strong>环境与依赖配置</strong>
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

                          return (
                            <>
                              <div className="skills-form-header">
                                <div className="skills-form-title-row">
                                  <h4>{skill.name}</h4>
                                  <span className="skills-provider-tag">{skill.provider}</span>
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

                              {skill.id === "web_search" && (
                                <div className="skills-form-section" style={{ marginTop: "12px" }}>
                                  <h5>Tavily API Key</h5>
                                  <div className="skills-param-field">
                                    <input
                                      value={tavilyApiKey}
                                      type="password"
                                      onChange={(event) => setTavilyApiKey(event.target.value)}
                                      onBlur={handleSaveTavilyApiKey}
                                      placeholder="粘贴 Tavily API Key；留空则使用系统环境变量或 DuckDuckGo 兜底"
                                    />
                                  </div>
                                </div>
                              )}

                              <div className="skills-form-actions">
                                <button
                                  className={skill.enabled ? "danger" : "primary"}
                                  onClick={() => handleToggleSkill(skill.id, !skill.enabled)}
                                  type="button"
                                >
                                  {skill.enabled ? "禁用技能" : "启用技能"}
                                </button>
                                {skill.id !== "text_editor" && skill.id !== "bash_tool" && (
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
                  <div className="settings-tab-content placeholder-tab-content">
                    <h3>MCP 配置 (Model Context Protocol)</h3>
                    <p className="description">连接符合 Model Context Protocol 规范的外部工具服务器，为大模型注入实时上下文。</p>
                    
                    <div className="mcp-servers-list">
                      <div className="mcp-server-card">
                        <div className="mcp-server-header">
                          <div className="mcp-server-title">
                            <strong>filesystem-server</strong>
                            <span className="mcp-status-dot active"></span>
                            <span className="mcp-status-text">已连接</span>
                          </div>
                          <button className="ghost mcp-btn-danger">断开</button>
                        </div>
                        <div className="mcp-server-details">
                          <code>command: npx -y @modelcontextprotocol/server-filesystem C:\Users\13439\Desktop</code>
                        </div>
                      </div>

                      <div className="mcp-server-card">
                        <div className="mcp-server-header">
                          <div className="mcp-server-title">
                            <strong>sqlite-server</strong>
                            <span className="mcp-status-dot active"></span>
                            <span className="mcp-status-text">已连接</span>
                          </div>
                          <button className="ghost mcp-btn-danger">断开</button>
                        </div>
                        <div className="mcp-server-details">
                          <code>command: npx -y @modelcontextprotocol/server-sqlite --db nano-agent.sqlite3</code>
                        </div>
                      </div>
                    </div>

                    <button className="mcp-add-btn">
                      <Plus size={14} /> 添加 MCP 服务器
                    </button>
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
            const isExecuted = toolCall ? messages.slice(messages.indexOf(message) + 1).some((m) =>
              m.role === "user" && m.content.startsWith(`[工具执行结果: ${toolCall.name}]`)
            ) : false;

            return (
              <div key={message.id} className={`chat-message ${message.role}`}>
                {message.role === "assistant" && messageReasoning[message.id]?.trim() && (
                  <details className="reasoning-panel">
                    <summary className="reasoning-title">思考过程</summary>
                    <MarkdownMessage content={messageReasoning[message.id]} />
                  </details>
                )}
                <MarkdownMessage content={message.content} />
                
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
          <textarea
            value={chatInput}
            onChange={(event) => void handleInputChange(event.target.value, event.target.selectionStart)}
            onKeyDown={handleInputKeyDown}
            placeholder="问点什么，或者梳理当前的思绪..."
          />
          <div className="chat-input-footer">
            <div className="chat-input-left">
              <button
                className={webSearchEnabled ? "web-toggle active" : "web-toggle"}
                onClick={handleToggleWebSearch}
                type="button"
                title="联网检索"
              >
                联网
              </button>
              <select value={activeModelId} onChange={(event) => setActiveModelId(event.target.value)}>
                <option value="">选择模型</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
            <div className="chat-input-actions">
              <button className="chat-input-action ghost" aria-label="新对话" title="新对话" onClick={() => void handleNewConversation()} type="button">
                <Plus size={20} />
              </button>
              <button className="chat-input-action send" aria-label="发送" title="发送" onClick={handleSendMessage} disabled={busy || !chatInput.trim()} type="button">
                <SendHorizontal size={20} />
              </button>
            </div>
          </div>
        </div>

        {notice && <div className="notice" onClick={() => setNotice("")}>{notice}</div>}

        {pendingReminder && (
          <div className="confirm-popover">
            <strong>添加备忘录？</strong>
            <span>{pendingReminder.title}</span>
            <small>
              {formatReminderTime(pendingReminder.reminder_at)}
              {pendingReminder.repeat_rule !== "none" ? ` · ${repeatLabels[pendingReminder.repeat_rule]}` : ""}
            </small>
            <div>
              <button onClick={() => void createReminderFromDraft(pendingReminder)}>确认</button>
              <button className="ghost" onClick={() => setPendingReminder(null)}>取消</button>
            </div>
          </div>
        )}

        {activeReminder && (
          <div className="confirm-popover reminder-alert">
            <strong>备忘录提醒</strong>
            <span>{activeReminder.title}</span>
            {activeReminder.body && <small>{activeReminder.body}</small>}
            <div>
              <button onClick={() => void dismissReminder(activeReminder)}>知道了</button>
              <button className="ghost" onClick={() => {
                setActiveKind("task");
                setSelectedId(activeReminder.id);
                setActiveReminder(null);
                setShowModelConfig(true);
                setActiveSettingsTab("task");
              }}>查看</button>
            </div>
          </div>
        )}
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

function extractReminderDraft(content: string): ReminderDraft | null {
  if (!/(提醒我|记得提醒|帮我提醒|备忘|备忘录)/.test(content)) {
    return null;
  }

  const now = new Date();
  const date = new Date(now);
  let matchedTime = false;

  const relativeMinutes = content.match(/(\d+)\s*分钟后/);
  const relativeHours = content.match(/(\d+)\s*(小时|个小时)后/);
  if (relativeMinutes) {
    date.setMinutes(date.getMinutes() + Number(relativeMinutes[1]));
    matchedTime = true;
  } else if (relativeHours) {
    date.setHours(date.getHours() + Number(relativeHours[1]));
    matchedTime = true;
  } else {
    if (/明天/.test(content)) {
      date.setDate(date.getDate() + 1);
      matchedTime = true;
    } else if (/后天/.test(content)) {
      date.setDate(date.getDate() + 2);
      matchedTime = true;
    } else if (/今天/.test(content)) {
      matchedTime = true;
    }

    const timeMatch = content.match(/(\d{1,2})[点:：](\d{1,2})?/);
    if (timeMatch) {
      date.setHours(Number(timeMatch[1]), Number(timeMatch[2] || 0), 0, 0);
      matchedTime = true;
      if (date.getTime() <= now.getTime() && !/今天|明天|后天/.test(content)) {
        date.setDate(date.getDate() + 1);
      }
    }
  }

  if (!matchedTime) {
    return null;
  }

  const repeat_rule = /每月/.test(content)
    ? "monthly"
    : /每周|每星期/.test(content)
      ? "weekly"
      : /每天|每日/.test(content)
        ? "daily"
        : "none";
  const title = content
    .replace(/请|帮我|麻烦你|提醒我|记得提醒|备忘录|备忘|今天|明天|后天|每月|每周|每星期|每天|每日/g, "")
    .replace(/\d+\s*分钟后|\d+\s*(小时|个小时)后|\d{1,2}[点:：]\d{0,2}/g, "")
    .replace(/[，,。.!！?？]/g, " ")
    .trim() || "备忘录提醒";

  return {
    title: title.slice(0, 40),
    body: content,
    reminder_at: toLocalDateTimeInput(date.toISOString()),
    repeat_rule
  };
}

function toLocalDateTimeInput(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatReminderTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getNextReminderAt(value?: string | null, repeatRule?: string | null) {
  if (!value || !repeatRule || repeatRule === "none") {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (repeatRule === "daily") {
    date.setDate(date.getDate() + 1);
  } else if (repeatRule === "weekly") {
    date.setDate(date.getDate() + 7);
  } else if (repeatRule === "monthly") {
    date.setMonth(date.getMonth() + 1);
  } else {
    return null;
  }

  return date.toISOString();
}

function buildSystemMessage(
  memories: Memory[],
  webResults: WebSearchResult[] = [],
  activeProject: ProjectEntry | null = null,
  projectFiles: ProjectFileEntry[] = [],
  skills: Skill[] = [],
  tempDir?: string
): ChatMessage {
  const runtimeContext = buildRuntimeContext();

  const memoryContext = memories
    .map((memory) => `- ${memory.title}: ${memory.content}`)
    .join("\n");

  const webContext = webResults
    .map((result, index) => {
      const snippet = result.snippet ? `\n   摘要: ${result.snippet}` : "";
      return `${index + 1}. ${result.title}\n   链接: ${result.url}${snippet}`;
    })
    .join("\n");

  const projectContext = activeProject
    ? [
        "当前项目上下文：",
        `- 项目名称：${activeProject.name}`,
        `- 项目路径：${activeProject.path}`,
        projectFiles.length > 0
          ? `- 当前项目文件列表（最多 300 项，已跳过 node_modules、.git、target、dist 等大目录）：\n${formatProjectFileTree(projectFiles)}`
          : "- 当前项目文件列表为空，或暂时无法读取。"
      ].join("\n")
    : "";

  const enabledSkills = skills.filter((s) => s.enabled);
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

注意：请一次仅发出一个 <tool_call>，等待用户确认执行并向你回传结果后，你再根据执行结果继续后续思考或操作。`;

  const sections = [
    runtimeContext,
    projectContext,
    skillsContext ? `当前已启用的技能列表与工具调用规范：\n${skillsContext}\n\n${toolsSystemInstruction}` : "",
    memoryContext ? `用户维护的长期记忆，在相关时使用，不要无意义提及：\n${memoryContext}` : "",
    webContext ? `互联网检索结果，仅在回答当前问题相关时使用；使用其中事实时尽量给出链接：\n${webContext}` : ""
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

export default App;
