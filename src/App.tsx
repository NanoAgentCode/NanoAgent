import { useEffect, useMemo, useRef, useState } from "react";
import { setTheme } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
  deleteConversation,
  deleteItem,
  deleteMessages,
  testLlmConnectivity,
  testEmbeddingConnectivity,
  deleteRagFile,
  indexRagFile,
  listEnabledMemories,
  listArchivedConversations,
  listConversations,
  listItems,
  listMessages,
  listProjectFiles,
  listRagFiles,
  searchRagContext,
  searchItems,
  getTavilyApiKey,
  saveTavilyApiKey,
  updateItem,
  checkEnv,
  installEnv,
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
import AgentRuntimePanel from "./components/AgentRuntimePanel";
import ObservabilityPanel from "./components/ObservabilityPanel";
import ToolResultMessage from "./components/ToolResultMessage";
import { useEnv } from "./hooks/useEnv";
import { useMcp } from "./hooks/useMcp";
import { useMemory } from "./hooks/useMemory";
import { useModel, normalizeModelDraft } from "./hooks/useModel";
import { useSkills } from "./hooks/useSkills";
import { useObservability } from "./hooks/useObservability";
import { useProjects } from "./hooks/useProjects";
import {
  safeCreateAgentRun,
  safeFinishAgentRun,
  safeRecordAgentStep,
  safeResolveAgentModelOutput,
  safeExecuteAgentToolCall,
  safeApproveAgentToolCall,
  safeRejectAgentToolCall,
  safeCreateAgentToolCall,
  safeUpdateAgentToolCall
} from "./lib/agentSafe";
import {
  formatMcpTransportLabel,
  formatProjectFileTree,
  formatDateTime,
  buildRuntimeContext,
  estimateTokens,
  isSupportedRagFile,
  MAX_CONTEXT_TOKENS
} from "./lib/formatters";
import {
  parseTags,
  extractMemoryDraft,
  parseToolCall,
  parseToolResult,
  type ParsedToolCall
} from "./lib/messageHelpers";
import {
  isBuiltInSkill,
  type Skill
} from "./lib/skills";
import type {
  ChatMessage,
  ChatStreamEvent,
  AgentRun,
  AgentRunTimeline,
  AgentRunDraft,
  AgentToolCall,
  Conversation,
  Item,
  ItemKind,
  MessageMetadata,
  Memory,
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


const themeLabels: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "白天主题",
  dark: "夜晚主题"
};



function renderMessageContent(content: string) {
  const toolResult = parseToolResult(content);
  if (toolResult) {
    return <ToolResultMessage result={toolResult} />;
  }
  return <MarkdownMessage content={content} />;
}

function App() {
  const listRequestRef = useRef(0);
  const messageLoadRequestRef = useRef(0);
  const activeConversationIdRef = useRef("");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const runtimePanelRef = useRef<HTMLElement | null>(null);
  const runtimeToggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeKind, setActiveKind] = useState<WorkspaceView>("note");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [status, setStatus] = useState("active");


  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);

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
  const env = useEnv(setNotice);
  const mcp = useMcp(setNotice);
  const memory = useMemory(setNotice);
  const model = useModel(setNotice, activeConversationId, setConversations);
  const skills = useSkills(setNotice);
  const obs = useObservability(setNotice, activeConversationId, showModelConfig, activeSettingsTab);
  const projects = useProjects(setNotice, conversations);
  const [workspaceListRatio, setWorkspaceListRatio] = useState(38);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("nano-agent-theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId),
    [items, selectedId]
  );
  const activeConversation = useMemo(() => {
    const allProjectConversations = Object.values(projects.projectConversations).flat();
    return [...conversations, ...allProjectConversations].find(
      (conversation) => conversation.id === activeConversationId
    );
  }, [activeConversationId, conversations, projects.projectConversations]);
  const activeConversationProject = useMemo(
    () =>
      activeConversation?.project_path
        ? projects.projects.find((project) => project.path === activeConversation.project_path) || null
        : null,
    [activeConversation, projects.projects]
  );
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!obs.showChatRuntime) return;
      const target = event.target as Node;
      if (
        runtimePanelRef.current &&
        !runtimePanelRef.current.contains(target) &&
        runtimeToggleBtnRef.current &&
        !runtimeToggleBtnRef.current.contains(target)
      ) {
        obs.setShowChatRuntime(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [obs.showChatRuntime]);



  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void loadAll();
    // Environment startup check is handled by useEnv.
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
    if (!model.models.some((m) => m.id === conversationModelId)) {
      return;
    }
    if (conversationModelId !== model.activeModelId) {
      model.setActiveModelId(conversationModelId);
    }
  }, [activeConversation?.id, activeConversation?.model_config_id, model.activeModelId, model.models]);



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
  }, [activeConversationId, model.activeModelId]);



  async function loadAll() {
    try {
      const [nextItems, nextConversations, nextArchivedConversations] = await Promise.all([
        listItems(),
        listConversations(),
        listArchivedConversations()
      ]);
      setItems(nextItems);
      setConversations(nextConversations);
      setArchivedConversations(nextArchivedConversations);
      setSelectedId((current) => current || nextItems[0]?.id || "");
      setActiveConversationId((current) => current || nextConversations[0]?.id || "");
      void memory.refreshMemories("");
      void model.refreshModels();
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

  function resolveConversationModelId(conversationId?: string | null) {
    const savedModelId =
      (conversationId ? projects.findConversationById(conversationId)?.model_config_id : activeConversation?.model_config_id) ||
      "";

    if (savedModelId && model.models.some((m) => m.id === savedModelId)) {
      return savedModelId;
    }

    return model.activeModelId;
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
        await memory.refreshMemories(nextQuery);
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



  function handleKindChange(kind: WorkspaceView) {
    setActiveKind(kind);
    setQuery("");
    if (kind === "memory") {
      memory.setSelectedMemoryId("");
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



  async function handleDeleteItem() {
    if (!selectedItem) {
      return;
    }

    await deleteItem(selectedItem.id);
    setSelectedId("");
    await refreshItems(query, activeKind);
  }





  async function createConversationForCurrentScope(project: ProjectEntry | null) {
    const conversation = await createConversation({
      model_config_id: model.activeModelId || null,
      project_path: project?.path || null
    });

    if (project) {
      await projects.refreshProjectConversationMap();
    } else {
      await refreshConversations(conversation.id);
    }
    return conversation;
  }

  function getConversationProjectHint() {
    return activeConversationId ? activeConversationProject : projects.activeProject;
  }

  async function handleNewConversation() {
    const conversation = await createConversationForCurrentScope(null);
    setActiveConversationId(conversation.id);
    setMessages([]);
  }

  async function handleNewProjectConversation(project: ProjectEntry) {
    projects.selectProject(project);
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
      await projects.refreshProjectConversationMap();
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
      await projects.refreshProjectConversationMap();
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
        projects.refreshProjectConversationMap()
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
          await projects.refreshProjectConversationMap();
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
          projects.refreshProjectConversationMap()
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
          await projects.refreshProjectConversationMap();
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
          projects.refreshProjectConversationMap()
        ]);
      }
    } catch (e) {
      console.error(e);
      alert("删除失败");
    }
  }

  function handleContextMenu(e: React.MouseEvent, conversation: Conversation) {
    e.preventDefault();
    projects.setContextMenu({
      x: e.clientX,
      y: e.clientY,
      visible: true,
      conversation,
      project: null
    });
  }

  function handleProjectContextMenu(e: React.MouseEvent, project: ProjectEntry) {
    e.preventDefault();
    projects.setContextMenu({
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
      if (projects.contextMenu.visible) {
        projects.setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener("click", handleCloseMenu);
    return () => {
      window.removeEventListener("click", handleCloseMenu);
    };
  }, [projects.contextMenu.visible]);

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
    const projectForRequest = projects.resolveConversationProject(conversationId, projectHint);
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
        skills.skills,
        mcp.mcpServers,
        ragMatches,
        skills.tempDir
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
        await projects.refreshProjectConversationMap();
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
      const projectForRequest = projects.resolveConversationProject(conversationId, projectHint);
      const projectPath = projectForRequest?.path || skills.tempDir;
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
      const isBashEnabled = skills.skills.find((s) => s.id === "bash_tool")?.enabled === true;
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
        const projectForRequest = projects.resolveConversationProject(conversationId, projectHint);
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
      const projectForRequest = projects.resolveConversationProject(conversationId, projectHint);
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
      const projectForRequest = projects.resolveConversationProject(conversationId, projectHint);
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
          memory.setSelectedMemoryId(savedMemory.id);
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
          await projects.refreshProjectConversationMap();
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
          skills.skills,
          mcp.mcpServers,
          ragMatches,
          skills.tempDir
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
        await projects.refreshProjectConversationMap();
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
            <span>{activeKind === "memory" ? memory.memoryItems.length : items.length} 条</span>
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
                {memory.memoryItems.map((item) => (
                  <button
                    key={item.id}
                    className={item.id === memory.selectedMemoryId ? "item-row selected" : "item-row"}
                    onClick={() => memory.setSelectedMemoryId(item.id)}
                  >
                    <div className="item-row-header">
                      <span className="badge-memory">记忆</span>
                      <span className="status-indicator">{item.enabled ? "已启用" : "已禁用"}</span>
                    </div>
                    <strong>{item.title}</strong>
                    <small>{item.content || "暂无内容"}</small>
                  </button>
                ))}
                {memory.memoryItems.length === 0 && (
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
                    checked={memory.memoryEnabled}
                    onChange={(event) => memory.setMemoryEnabled(event.target.checked)}
                    disabled={!memory.selectedMemory}
                  />
                  在对话中启用
                </label>
                <div className="editor-actions">
                  <button className="icon-text-btn success-btn" onClick={() => void memory.handleSaveMemory(query)} disabled={!memory.selectedMemory} type="button">
                    <Save />
                    <span>保存</span>
                  </button>
                  <button className="icon-text-btn danger-btn" onClick={() => void memory.handleDeleteMemory(query)} disabled={!memory.selectedMemory} type="button">
                    <Trash2 />
                    <span>删除</span>
                  </button>
                </div>
              </div>

              <input
                className="title-input"
                value={memory.memoryTitle}
                onChange={(event) => memory.setMemoryTitle(event.target.value)}
                placeholder="记忆标题"
                disabled={!memory.selectedMemory}
              />
              <textarea
                className="body-input"
                value={memory.memoryContent}
                onChange={(event) => memory.setMemoryContent(event.target.value)}
                placeholder="稳定记录用户偏好、事实背景、工作流规则或项目上下文..."
                disabled={!memory.selectedMemory}
              />
              <input
                className="tag-input"
                value={memory.memoryTagsText}
                onChange={(event) => memory.setMemoryTagsText(event.target.value)}
                placeholder="标签，以英文逗号分隔"
                disabled={!memory.selectedMemory}
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
              onClick={() => projects.setProjectsSectionExpanded(!projects.projectsSectionExpanded)}
            >
              {projects.projectsSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Folder size={16} />
              <span>项目区</span>
            </div>
            <div className="sidebar-section-actions">
              <button className="new-chat-btn" onClick={() => projects.setShowNewProjectDialog(true)} title="新建项目" type="button">
                <Plus size={16} />
              </button>
              <button className="new-chat-btn" onClick={() => void projects.handleOpenProject()} title="打开已有项目" type="button">
                <Folder size={16} />
              </button>
            </div>
          </div>
          {projects.projectsSectionExpanded && (
            <div className="sidebar-project-list">
              {projects.projects.map((project) => {
                const isActiveProject = project.id === projects.activeProjectId;
                const isExpanded = projects.expandedProjectIds.includes(project.id);
                const projectChats = projects.projectConversations[project.id] || [];
                const hasNoChats = projectChats.length === 0;
                const tooltipText = hasNoChats ? "暂无项目会话" : project.path;

                return (
                  <div key={project.id} className="sidebar-project-group">
                    <div
                      className={isActiveProject ? "sidebar-project-item active" : "sidebar-project-item"}
                      role="button"
                      tabIndex={0}
                      onClick={() => projects.selectProject(project)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          projects.selectProject(project);
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
                          projects.toggleProjectExpanded(project.id);
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
                                projects.selectProject(project);
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
              {projects.projects.length === 0 && (
                <div className="empty project-empty">打开或新建一个项目</div>
              )}
            </div>
          )}
        </div>

        <div className="sidebar-section chats">
          <div className="sidebar-section-header">
            <div
              className="sidebar-section-toggle"
              onClick={() => projects.setChatsSectionExpanded(!projects.chatsSectionExpanded)}
            >
              {projects.chatsSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <MessageSquare size={16} />
              <span>对话区</span>
            </div>
            <button className="new-chat-btn" onClick={() => void handleNewConversation()} title="新建对话" type="button">
              <Plus size={16} />
            </button>
          </div>
          {projects.chatsSectionExpanded && (
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

        <button className="settings-entry" onClick={() => model.handleOpenModelConfig(setShowModelConfig)}>
          <Settings size={18} />
          <span>系统设置</span>
        </button>
      </aside>

      {projects.showNewProjectDialog && (
        <div className="modal-backdrop" onClick={() => projects.setShowNewProjectDialog(false)}>
          <section className="project-dialog" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <Folder size={18} />
                <strong>新建项目</strong>
              </div>
              <button className="modal-close-btn" onClick={() => projects.setShowNewProjectDialog(false)} aria-label="关闭" title="关闭">&times;</button>
            </header>
            <label>
              <span>父目录</span>
              <div className="project-path-picker">
                <input value={projects.newProjectParent} readOnly placeholder="选择项目所在目录" />
                <button type="button" onClick={() => void projects.handleSelectNewProjectParent()}>
                  选择
                </button>
              </div>
            </label>
            <label>
              <span>项目名称</span>
              <input
                value={projects.newProjectName}
                onChange={(event) => projects.setNewProjectName(event.target.value)}
                placeholder="my-project"
                autoFocus
              />
            </label>
            <footer>
              <button className="ghost" type="button" onClick={() => projects.setShowNewProjectDialog(false)}>
                取消
              </button>
              <button className="primary" type="button" onClick={() => void projects.handleCreateProject()}>
                创建并打开
              </button>
            </footer>
          </section>
        </div>
      )}

      {projects.pendingProjectRemoval && (
        <div className="modal-backdrop" onClick={() => projects.setPendingProjectRemoval(null)}>
          <section className="project-dialog danger-approval" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <Trash2 size={18} />
                <strong>审批危险操作</strong>
              </div>
              <button className="modal-close-btn" onClick={() => projects.setPendingProjectRemoval(null)} aria-label="关闭" title="关闭">&times;</button>
            </header>
            <p>
              将从项目区移除 <strong>{projects.pendingProjectRemoval.name}</strong>。此操作不会删除磁盘文件。
            </p>
            <label>
              <span>输入项目名称以确认</span>
              <input
                value={projects.projectApprovalText}
                onChange={(event) => projects.setProjectApprovalText(event.target.value)}
                placeholder={projects.pendingProjectRemoval.name}
                autoFocus
              />
            </label>
            <footer>
              <button className="ghost" type="button" onClick={() => projects.setPendingProjectRemoval(null)}>
                取消
              </button>
              <button
                className="danger"
                type="button"
                onClick={projects.handleConfirmRemoveProject}
                disabled={projects.projectApprovalText.trim() !== projects.pendingProjectRemoval.name}
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
                    model.handleOpenEmbeddingConfig();
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
                              <span>{formatDateTime(conversation.archived_at || conversation.updated_at)}</span>
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
                                  {formatDateTime(archivedConversations.find((c) => c.id === previewArchivedId)?.archived_at)}
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
                  const llmModels = model.models.filter((m) => m.id !== "embedding-config");
                  return (
                    <div className="settings-tab-content model-tab-content">
                      <div className="model-header-row">
                        <h3>LLM管理</h3>
                        <button className="icon-only-btn compact" onClick={() => model.handleNewModelConfig(setShowModelConfig)} title="新建配置" aria-label="新建配置" type="button"><Plus /></button>
                      </div>
                      <p className="description" style={{ marginTop: "-4px" }}>配置用于聊天对话的大语言模型，供 AI 助手和会话调用。</p>
                      <div className="model-config-grid">
                        <aside className="model-config-list">
                          {llmModels.map((m) => {
                            const statusInfo = model.modelTestStatuses[m.id] || { status: "idle" };
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
                                key={m.id}
                                className={m.id === model.modelDraft.id ? "model-config-row active" : "model-config-row"}
                                onClick={() => model.setModelDraft(normalizeModelDraft(m))}
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
                                  <strong>{m.name}</strong>
                                  <span>{m.provider} / {m.model}</span>
                                </div>
                              </button>
                            );
                          })}
                          {llmModels.length === 0 && <div className="empty">暂无大模型配置</div>}
                        </aside>

                        <div className="model-config-form">
                          <div className="model-config-form">
                            <label>
                              <span>配置名称</span>
                              <input
                                value={model.modelDraft.name}
                                onChange={(event) => model.setModelDraft({ ...model.modelDraft, name: event.target.value })}
                                placeholder="例如：OpenAI 主账号"
                              />
                            </label>
                            <label>
                              <span>协议类型</span>
                              <select
                                value={model.modelDraft.provider}
                                onChange={(event) => model.handleProviderChange(event.target.value)}
                              >
                                <option value="openai-compatible">OpenAI 兼容协议</option>
                                <option value="anthropic">Anthropic 兼容协议</option>
                              </select>
                            </label>
                            <label>
                              <span>接口地址</span>
                              <input
                                value={model.modelDraft.base_url}
                                onChange={(event) => model.setModelDraft({ ...model.modelDraft, base_url: event.target.value })}
                                placeholder="https://api.openai.com/v1"
                              />
                            </label>
                            <label>
                              <span>模型标识</span>
                              <input
                                value={model.modelDraft.model}
                                onChange={(event) => model.setModelDraft({ ...model.modelDraft, model: event.target.value })}
                                placeholder="gpt-4o-mini"
                              />
                            </label>
                            <label>
                              <span>API Key</span>
                              <input
                                value={model.modelDraft.api_key}
                                type="password"
                                onChange={(event) => model.setModelDraft({ ...model.modelDraft, api_key: event.target.value })}
                                placeholder="用于对话模型调用"
                              />
                            </label>
                          </div>
                          <div className="modal-actions icon-actions" style={{ display: "flex", alignItems: "center", width: "100%" }}>
                            {model.llmTestStatus.status === "success" && (
                              <span style={{ color: "var(--accent-green)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-green)" }} />
                                连通性正常
                              </span>
                            )}
                            {model.llmTestStatus.status === "error" && (
                              <span style={{ color: "var(--accent-red)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }} title={model.llmTestStatus.message}>
                                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-red)" }} />
                                连通性异常 (悬浮查看详情)
                              </span>
                            )}
                            {(model.llmTestStatus.status === "idle" || model.llmTestStatus.status === "testing") && (
                              <div style={{ marginRight: "auto" }} />
                            )}
                            <button
                              className="icon-text-btn"
                              onClick={model.handleTestLlm}
                              disabled={model.llmTestStatus.status === "testing"}
                              title="测试连接"
                              type="button"
                            >
                              {model.llmTestStatus.status === "testing" ? (
                                <Loader2 style={{ animation: "spin 1s linear infinite" }} />
                              ) : (
                                <Activity />
                              )}
                              <span>{model.llmTestStatus.status === "testing" ? "测试中..." : "测试连接"}</span>
                            </button>
                            <button className="icon-text-btn success-btn" onClick={model.handleSaveModel} title="保存并使用" type="button">
                              <Save />
                              <span>保存并使用</span>
                            </button>
                            <button className="icon-text-btn danger-btn" title="删除模型" onClick={model.handleDeleteModel} disabled={!model.modelDraft.id || model.modelDraft.id === "embedding-config"} type="button">
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
                              value={model.embeddingDraft.embedding_provider}
                              onChange={(event) => model.handleEmbeddingProviderChange(event.target.value)}
                              disabled
                            >
                              <option value="openai-compatible">OpenAI 兼容协议</option>
                            </select>
                          </label>
                          <label>
                            <span>接口地址</span>
                            <input
                              value={model.embeddingDraft.embedding_base_url}
                              onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_base_url: event.target.value })}
                              placeholder="https://api.openai.com/v1"
                            />
                          </label>
                          <label>
                            <span>模型标识</span>
                            <input
                              value={model.embeddingDraft.embedding_model}
                              onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_model: event.target.value })}
                              placeholder="text-embedding-3-small"
                            />
                          </label>
                          <label>
                            <span>API Key</span>
                            <input
                              value={model.embeddingDraft.embedding_api_key}
                              type="password"
                              onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_api_key: event.target.value })}
                              placeholder="用于 RAG 向量化，可与大模型不同"
                            />
                          </label>
                        </div>
                        <div className="modal-actions icon-actions" style={{ display: "flex", alignItems: "center", width: "100%" }}>
                          {model.embeddingTestStatus.status === "success" && (
                            <span style={{ color: "var(--accent-green)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }}>
                              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-green)" }} />
                              连通性正常
                            </span>
                          )}
                          {model.embeddingTestStatus.status === "error" && (
                            <span style={{ color: "var(--accent-red)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "auto" }} title={model.embeddingTestStatus.message}>
                              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-red)" }} />
                              连通性异常 (悬浮查看详情)
                            </span>
                          )}
                          {(model.embeddingTestStatus.status === "idle" || model.embeddingTestStatus.status === "testing") && (
                            <div style={{ marginRight: "auto" }} />
                          )}
                          <button
                            className="icon-text-btn"
                            onClick={model.handleTestEmbedding}
                            disabled={model.embeddingTestStatus.status === "testing"}
                            title="测试连接"
                            type="button"
                          >
                            {model.embeddingTestStatus.status === "testing" ? (
                              <Loader2 style={{ animation: "spin 1s linear infinite" }} />
                            ) : (
                              <Activity />
                            )}
                            <span>{model.embeddingTestStatus.status === "testing" ? "测试中..." : "测试连接"}</span>
                          </button>
                          <button className="icon-text-btn success-btn" onClick={model.handleSaveEmbeddingModel} title="保存并使用" type="button">
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
                              skills.setIsAddingSkill(true);
                              skills.setSelectedSkillId("");
                            }}
                            type="button"
                          >
                            添加自定义技能
                          </button>
                        </div>
                        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                          {skills.skills.map((skill) => (
                            <button
                              key={skill.id}
                              className={!skills.isAddingSkill && skill.id === skills.selectedSkillId ? "skills-config-row active" : "skills-config-row"}
                              onClick={() => {
                                skills.setIsAddingSkill(false);
                                skills.setSelectedSkillId(skill.id);
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
                        {skills.isAddingSkill ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px", height: "100%" }}>
                            <h4 style={{ margin: 0 }}>添加自定义技能</h4>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>唯一标识符 (ID):</label>
                              <input
                                value={skills.newSkillDraft.id}
                                onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, id: e.target.value.trim().toLowerCase() }))}
                                placeholder="例如: custom_file_helper"
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>技能名称 (Name):</label>
                              <input
                                value={skills.newSkillDraft.name}
                                onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="例如: 自定义文件助手"
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>文档/项目链接 (Doc URL):</label>
                              <input
                                value={skills.newSkillDraft.docUrl}
                                onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, docUrl: e.target.value }))}
                                placeholder="https://..."
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem" }}>技能描述 (Description):</label>
                              <textarea
                                value={skills.newSkillDraft.description}
                                onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="描述该技能的作用以及模型如何调用它..."
                                rows={2}
                                style={{ width: "100%", boxSizing: "border-box", borderRadius: "4px", border: "1px solid var(--border-color)", padding: "8px", backgroundColor: "var(--bg-main)", color: "var(--text-main)", resize: "vertical", fontSize: "0.85rem" }}
                              />
                            </div>
                            <div style={{ marginTop: "auto", display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                              <button className="secondary" onClick={() => {
                                skills.setIsAddingSkill(false);
                                if (skills.skills.length > 0) {
                                  skills.setSelectedSkillId(skills.skills[0].id);
                                }
                              }} type="button">
                                取消
                              </button>
                              <button className="primary" onClick={skills.handleSaveNewSkill} type="button">
                                <Save size={15} /> 确认添加
                              </button>
                            </div>
                          </div>
                        ) : (() => {
                          const skill = skills.skills.find((s) => s.id === skills.selectedSkillId);
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
                                  onClick={() => skills.handleToggleSkill(skill.id, !skill.enabled)}
                                  type="button"
                                >
                                  {skill.enabled ? "禁用技能" : "启用技能"}
                                </button>
                                {!isSystemSkill && (
                                  <button
                                    className="danger"
                                    onClick={() => skills.handleDeleteSkill(skill.id)}
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

                                {activeSettingsTab === "observability" && (
                                  <ObservabilityPanel
                                    traces={obs.traceGroups}
                                    selectedTrace={obs.selectedTrace}
                                    timelineItems={obs.activeTraceTimelineItems}
                                    expandedRows={obs.expandedObservabilityRows}
                                    isTimelineCollapsed={obs.traceTimelineCollapsed}
                                    isLoading={obs.isLoadingObservability}
                                    spanCount={obs.observabilitySpans.length}
                                    onRefresh={() => void obs.refreshObservability()}
                                    onClear={() => void obs.handleClearObservability()}
                                    onSelectTrace={obs.setSelectedTraceId}
                                    onToggleTimeline={() => obs.setTraceTimelineCollapsed(!obs.traceTimelineCollapsed)}
                                    onToggleRow={obs.toggleTimelineRow}
                                  />
                                )}

{activeSettingsTab === "mcp" && (
                  <div className="settings-tab-content model-tab-content">
                    <div className="model-header-row">
                      <h3>MCP 配置</h3>
                      <button className="icon-only-btn compact" onClick={mcp.handleNewMcpServer} title="添加 MCP 服务器" aria-label="添加 MCP 服务器" type="button"><Plus /></button>
                    </div>
                    <p className="description" style={{ marginTop: "-4px" }}>连接符合 Model Context Protocol 规范的工具服务器，支持 stdio、SSE 和 Streamable HTTP。</p>

                    <div className="model-config-grid mcp-config-grid">
                      <aside className="model-config-list">
                        {mcp.mcpServers.map((server) => {
                          const connected = server.status.connected;
                          const busy = mcp.mcpBusyId === server.config.id;
                          return (
                            <button
                              key={server.config.id}
                              className={server.config.id === mcp.selectedMcpServerId ? "mcp-config-row active" : "mcp-config-row"}
                              onClick={() => mcp.setSelectedMcpServerId(server.config.id)}
                              type="button"
                            >
                              <div className="mcp-config-row-header">
                                <strong>{server.config.name}</strong>
                                <button
                                  className={connected ? "mcp-connection-badge connected" : "mcp-connection-badge"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (connected) {
                                      void mcp.handleDisconnectMcpServer(server.config.id);
                                    } else {
                                      void mcp.handleConnectMcpServer(server.config.id);
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
                        {mcp.mcpServers.length === 0 && <div className="empty">暂无 MCP 服务器配置</div>}
                      </aside>

                      <div className="model-config-form">
                        <div className="model-form-card mcp-form-card">
                          <label>
                            <span>服务名称</span>
                            <input
                              value={mcp.mcpDraft.name}
                              onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, name: event.target.value })}
                              placeholder="amap-maps"
                            />
                          </label>
                          <label>
                            <span>协议</span>
                            <select
                              value={mcp.mcpDraft.transport}
                              onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, transport: event.target.value })}
                            >
                              <option value="stdio">stdio 本地进程</option>
                              <option value="sse">SSE</option>
                              <option value="streamable_http">Streamable HTTP</option>
                            </select>
                          </label>
                          {mcp.mcpDraft.transport === "stdio" ? (
                            <>
                              <label>
                                <span>命令</span>
                                <textarea
                                  value={mcp.stdioCommandLine}
                                  onChange={(event) => mcp.setStdioCommandLine(event.target.value)}
                                  rows={3}
                                  placeholder={"npx -y @modelcontextprotocol/server-filesystem C:\\Users\\13439\\Desktop"}
                                  spellCheck={false}
                                />
                              </label>
                              <label>
                                <span>环境变量 JSON</span>
                                <textarea
                                  value={mcp.mcpDraft.env_json}
                                  onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, env_json: event.target.value })}
                                  rows={3}
                                  placeholder={"{\"API_KEY\": \"...\"}"}
                                />
                              </label>
                              <label>
                                <span>工作目录</span>
                                <input
                                  value={mcp.mcpDraft.working_dir}
                                  onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, working_dir: event.target.value })}
                                  placeholder="可选"
                                />
                              </label>
                            </>
                          ) : (
                            <>
                              <label>
                                <span>地址</span>
                                <input
                                  value={mcp.mcpDraft.url}
                                  onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, url: event.target.value })}
                                  placeholder={mcp.mcpDraft.transport === "sse" ? "https://example.com/sse" : "https://example.com/mcp"}
                                />
                              </label>
                              <label>
                                <span>请求头 JSON</span>
                                <textarea
                                  value={mcp.mcpDraft.headers_json}
                                  onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, headers_json: event.target.value })}
                                  rows={3}
                                  placeholder={"{\"Authorization\": \"Bearer ...\"}"}
                                />
                              </label>
                            </>
                          )}
                        </div>

                        <div className="modal-actions icon-actions mcp-actions">
                          <div className="mcp-action-status">
                            {mcp.selectedMcpServer?.status.error && (
                              <span className="mcp-status-text error" title={mcp.selectedMcpServer.status.error}>连接错误</span>
                            )}
                            {mcp.selectedMcpServer && (
                              <div className="mcp-tools-tooltip-wrap">
                                <button className="icon-only-btn compact" type="button" aria-label="查看工具详情" title="查看工具详情">
                                  <Info />
                                </button>
                                <div className="mcp-tools-tooltip" role="tooltip">
                                  <div className="mcp-tools-tooltip-header">
                                    <strong>工具详情{mcp.selectedMcpServer.status.connected ? ` · ${mcp.selectedMcpServer.tools.length}` : ""}</strong>
                                    {mcp.selectedMcpServer.status.connected && (
                                      <button
                                        className="icon-only-btn compact"
                                        onClick={() => void mcp.handleRefreshMcpTools(mcp.selectedMcpServer!.config.id)}
                                        disabled={mcp.mcpBusyId === mcp.selectedMcpServer.config.id}
                                        type="button"
                                        title="刷新工具列表"
                                        aria-label="刷新工具列表"
                                      >
                                        {mcp.mcpBusyId === mcp.selectedMcpServer.config.id ? <Loader2 style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw />}
                                      </button>
                                    )}
                                  </div>
                                  {!mcp.selectedMcpServer.status.connected && <div className="mcp-tools-tooltip-empty">连接后可查看工具</div>}
                                  {mcp.selectedMcpServer.status.connected && mcp.selectedMcpServer.tools.length === 0 && <div className="mcp-tools-tooltip-empty">该服务器暂未暴露工具</div>}
                                  {mcp.selectedMcpServer.status.connected && mcp.selectedMcpServer.tools.length > 0 && (
                                    <div className="mcp-tools-tooltip-list">
                                      {mcp.selectedMcpServer.tools.map((tool) => (
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
                          <button className="icon-text-btn success-btn" onClick={mcp.handleSaveMcpServer} title="保存配置" type="button">
                            <Save />
                            <span>保存</span>
                          </button>
                          <button className="icon-text-btn danger-btn" title="删除 MCP 服务器" onClick={mcp.handleDeleteMcpServer} disabled={mcp.mcpBusyId === mcp.mcpDraft.id} type="button">
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
                              <span className={env.envStatus.node ? "env-status-ok" : "env-status-missing"}>
                                {env.envStatus.node ? "✓ 已就绪" : "✗ 未检测到"}
                              </span>
                            </div>
                            <div className="env-status-item-compact">
                              <span>Python</span>
                              <span className={env.envStatus.python ? "env-status-ok" : "env-status-missing"}>
                                {env.envStatus.python ? "✓ 已就绪" : "✗ 未检测到"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="env-status-actions">
                          <div className="env-actions-menu-wrap">
                            <button
                              className="secondary env-action-btn"
                              type="button"
                              onClick={() => env.setShowEnvActionsMenu((current) => !current)}
                              aria-expanded={env.showEnvActionsMenu}
                            >
                              更多
                              <ChevronDown size={16} />
                            </button>
                            {env.showEnvActionsMenu && (
                              <div className="env-actions-menu">
                                <button
                                  type="button"
                                  onClick={() => {
                                    env.setShowEnvActionsMenu(false);
                                    void env.runEnvCheck();
                                  }}
                                  disabled={env.isCheckingEnv || env.isInstallingEnv}
                                >
                                  {env.isCheckingEnv ? "正在检测..." : "重新检测环境"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    env.setShowEnvActionsMenu(false);
                                    void env.handleAutoInstallMissing();
                                  }}
                                  disabled={env.isCheckingEnv || env.isInstallingEnv}
                                >
                                  {env.isInstallingEnv ? "正在安装..." : "自动配置/安装 (winget)"}
                                </button>
                                {env.envStatus.node && env.envStatus.python && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      env.setShowEnvActionsMenu(false);
                                      env.setShowCustomPaths((current) => !current);
                                    }}
                                  >
                                    {env.showCustomPaths ? "隐藏自定义配置" : "配置自定义路径"}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {(!env.envStatus.node || !env.envStatus.python || env.showCustomPaths) && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Node.js 自定义路径:</label>
                              <input
                                value={env.nodePath}
                                onChange={(e) => env.setNodePath(e.target.value)}
                                placeholder="系统默认 PATH / 点击保存"
                                onBlur={env.handleSaveCustomPaths}
                                style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                              />
                            </div>
                            <div className="skills-param-field" style={{ margin: 0 }}>
                              <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Python 自定义路径:</label>
                              <input
                                value={env.pythonPath}
                                onChange={(e) => env.setPythonPath(e.target.value)}
                                placeholder="系统默认 PATH / 点击保存"
                                onBlur={env.handleSaveCustomPaths}
                                style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                              />
                            </div>
                          </div>
                          {env.isInstallingEnv && (
                            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                              <span className="spinner">⏳</span> {env.envInstallProgress}
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
                              <span className={env.envStatus.tavily_cli ? "env-status-ok" : "env-status-missing"}>
                                {env.envStatus.tavily_cli ? "✓ 已就绪" : "✗ 未检测到"}
                              </span>
                            </div>
                            <div className="env-status-item-compact">
                              <span>API Key</span>
                              <span className={env.tavilyApiKey.trim() ? "env-status-ok" : "env-status-missing"}>
                                {env.tavilyApiKey.trim() ? "✓ 已配置" : "✗ 未配置"}
                              </span>
                            </div>
                          </div>
                        </div>
                        {!env.envStatus.tavily_cli && (
                          <div className="env-status-actions">
                            <button
                              className="secondary env-action-btn"
                              type="button"
                              onClick={env.handleInstallTavilyCli}
                              disabled={env.isInstallingEnv || env.isCheckingEnv}
                            >
                              {env.isInstallingEnv ? "安装中..." : "安装 CLI"}
                            </button>
                          </div>
                        )}
                      </div>
                      {env.isInstallingEnv && env.envInstallProgress.includes("Tavily") && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className="spinner">⏳</span> {env.envInstallProgress}
                        </div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "12px", alignItems: "end" }}>
                        <div className="skills-param-field" style={{ margin: 0 }}>
                          <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Tavily API Key:</label>
                          <input
                            type="password"
                            value={env.tavilyApiKey}
                            onChange={(e) => env.setTavilyApiKey(e.target.value)}
                            placeholder="tvly-..."
                            style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                          />
                        </div>
                        <button
                          className="secondary"
                          onClick={env.handleSaveTavilyApiKey}
                          disabled={env.isSavingTavilyApiKey}
                          type="button"
                          style={{ height: "32px" }}
                        >
                          {env.isSavingTavilyApiKey ? "保存中..." : "保存 Key"}
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
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                ref={runtimeToggleBtnRef}
                className="compact-btn"
                aria-label="Agent Runtime 运行详情"
                title="Agent Runtime 运行详情"
                onClick={() => obs.setShowChatRuntime(!obs.showChatRuntime)}
                type="button"
                style={{
                  fontSize: "12px",
                  padding: "4px 8px",
                  height: "28px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  color: obs.showChatRuntime ? "var(--accent-cyan)" : "var(--text-secondary)",
                  borderColor: obs.showChatRuntime ? "var(--accent-cyan)" : "var(--border-color)",
                  background: "transparent",
                  outline: "none"
                }}
              >
                <Activity size={13} />
                <span>运行详情</span>
              </button>
              <button
                className="icon"
                aria-label="关闭当前会话"
                title="关闭当前会话"
                onClick={handleCloseConversation}
                type="button"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </header>

        {obs.showChatRuntime && (
          <AgentRuntimePanel
            panelRef={runtimePanelRef}
            activeConversationId={activeConversationId}
            activeConversationTitle={activeConversation?.title}
            timelines={obs.agentRunTimelines}
            activeTimeline={obs.activeRunTimeline}
            isCollapsed={obs.agentRuntimeCollapsed}
            expandedRows={obs.expandedObservabilityRows}
            onToggleCollapsed={() => obs.setAgentRuntimeCollapsed(!obs.agentRuntimeCollapsed)}
            onToggleRow={obs.toggleTimelineRow}
          />
        )}

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
              <select value={model.activeModelId} onChange={(event) => void model.handleActiveModelChange(event.target.value)}>
                <option value="">选择模型</option>
                {model.models.filter((m) => m.id !== "embedding-config").map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
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

        {env.showEnvPrompt && (
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
                  <span style={{ color: env.envStatus.node ? "var(--accent-green)" : "var(--accent-red)", fontWeight: "bold" }}>
                    {env.envStatus.node ? "✓ 已就绪" : "✗ 未检测到"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Python 环境:</span>
                  <span style={{ color: env.envStatus.python ? "var(--accent-green)" : "var(--accent-red)", fontWeight: "bold" }}>
                    {env.envStatus.python ? "✓ 已就绪" : "✗ 未检测到"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <h4 style={{ margin: "4px 0", fontSize: "0.95rem" }}>配置已有路径（若已安装）：</h4>
                <div className="skills-param-field" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Node.js 可执行文件路径:</label>
                  <input
                    value={env.nodePath}
                    onChange={(e) => env.setNodePath(e.target.value)}
                    placeholder="例如: C:\Program Files\nodejs\node.exe 或直接输入 node"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
                <div className="skills-param-field" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Python 可执行文件路径:</label>
                  <input
                    value={env.pythonPath}
                    onChange={(e) => env.setPythonPath(e.target.value)}
                    placeholder="例如: C:\Users\...\python.exe 或直接输入 python"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {env.isInstallingEnv && (
                <div style={{ padding: "10px", backgroundColor: "var(--bg-main)", borderRadius: "6px", fontSize: "0.85rem", borderLeft: "4px solid var(--accent-blue)" }}>
                  <span className="spinner" style={{ marginRight: "8px" }}>⌛</span>
                  {env.envInstallProgress}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "8px", justifyContent: "flex-end" }}>
                <button
                  className="secondary"
                  onClick={env.dismissEnvPrompt}
                  disabled={env.isInstallingEnv || env.isCheckingEnv}
                  type="button"
                >
                  稍后提醒
                </button>
                <button
                  className="secondary"
                  onClick={env.handleSaveCustomPaths}
                  disabled={env.isInstallingEnv || env.isCheckingEnv}
                  type="button"
                >
                  保存已有路径
                </button>
                <button
                  className="primary"
                  onClick={env.handleAutoInstallMissing}
                  disabled={env.isInstallingEnv || env.isCheckingEnv}
                  type="button"
                >
                  {env.isInstallingEnv ? "正在配置..." : "自动配置 (winget)"}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      {projects.contextMenu.visible && (
        <div
          className="custom-context-menu"
          style={{
            top: `${projects.contextMenu.y}px`,
            left: `${projects.contextMenu.x}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {projects.contextMenu.conversation && (
            <>
              <button
                className="custom-context-menu-item"
                onClick={() => {
                  if (projects.contextMenu.conversation) {
                    void handleRenameConversation(
                      projects.contextMenu.conversation.id,
                      projects.contextMenu.conversation.title
                    );
                  }
                  projects.setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                type="button"
              >
                <Edit size={14} />
                <span>重命名</span>
              </button>
              <button
                className="custom-context-menu-item"
                onClick={() => {
                  if (projects.contextMenu.conversation) {
                    void handleContextArchiveConversation(projects.contextMenu.conversation);
                  }
                  projects.setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                type="button"
              >
                <Archive size={14} />
                <span>归档会话</span>
              </button>
              <button
                className="custom-context-menu-item danger-action"
                onClick={() => {
                  if (projects.contextMenu.conversation) {
                    void handleContextDeleteConversation(projects.contextMenu.conversation);
                  }
                  projects.setContextMenu((prev) => ({ ...prev, visible: false }));
                }}
                type="button"
              >
                <Trash2 size={14} />
                <span>删除会话</span>
              </button>
            </>
          )}

          {projects.contextMenu.project && (
            <button
              className="custom-context-menu-item danger-action"
              onClick={() => {
                if (projects.contextMenu.project) {
                  projects.handleRemoveProjectApproval(projects.contextMenu.project);
                }
                projects.setContextMenu((prev) => ({ ...prev, visible: false }));
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

export default App;
