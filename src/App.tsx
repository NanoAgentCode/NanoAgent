import { useEffect, useMemo, useRef, useState } from "react";
import { setTheme } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import {
  Archive,
  Bot,
  Brain,
  CheckSquare,
  FileText,
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
  Trash2
} from "lucide-react";
import {
  appendMessage,
  archiveConversation,
  chatStream,
  createConversation,
  createItem,
  createMemory,
  deleteConversation,
  deleteItem,
  deleteMemory,
  deleteModelConfig,
  internetSearch,
  listEnabledMemories,
  listArchivedConversations,
  listConversations,
  listItems,
  listMemories,
  listMessages,
  listModelConfigs,
  saveModelConfig,
  searchItems,
  searchMemories,
  updateItem,
  updateMemory
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

function App() {
  const listRequestRef = useRef(0);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeKind, setActiveKind] = useState<WorkspaceView>("all");
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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [messages, setMessages] = useState<PersistedMessage[]>([]);
  const [messageReasoning, setMessageReasoning] = useState<Record<string, string>>({});
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
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

  useEffect(() => {
    void loadAll();
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
    setMessageReasoning({});
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    void loadMessages(activeConversationId);
  }, [activeConversationId]);

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
    try {
      setMessages(await listMessages(conversationId));
    } catch (error) {
      setNotice(String(error));
    }
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

    await updateItem({
      id: selectedItem.id,
      title,
      body,
      status,
      tags: parseTags(tagsText),
      reminder_at: activeKind === "task" ? fromLocalDateTimeInput(reminderAt) : null,
      repeat_rule: activeKind === "task" && repeatRule !== "none" ? repeatRule : null
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
      setActiveModelId("");
      setModelDraft(emptyModelDraft);
      return;
    }
    const model = models.find((item) => item.id === id);
    if (model) {
      setActiveModelId(model.id);
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
    setActiveModelId(nextModels[0]?.id || "");
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

  async function handleNewConversation() {
    const conversation = await createConversation({
      title: "新对话",
      model_config_id: activeModelId || null
    });
    await refreshConversations(conversation.id);
    setMessages([]);
  }

  async function handleDeleteConversation() {
    if (!activeConversationId) {
      return;
    }

    await deleteConversation(activeConversationId);
    const rest = conversations.filter((item) => item.id !== activeConversationId);
    setConversations(rest);
    setActiveConversationId(rest[0]?.id || "");
  }

  async function handleArchiveConversation() {
    if (!activeConversationId) {
      return;
    }

    await archiveConversation(activeConversationId, true);
    const rest = conversations.filter((item) => item.id !== activeConversationId);
    setConversations(rest);
    setActiveConversationId(rest[0]?.id || "");
    setMessages([]);
    await refreshConversations(rest[0]?.id);
  }

  async function handleRestoreConversation(conversation: Conversation) {
    await archiveConversation(conversation.id, false);
    await refreshConversations(conversation.id);
    setShowModelConfig(false);
    await loadMessages(conversation.id);
  }

  async function handleDeleteArchivedConversation(id: string) {
    await deleteConversation(id);
    setArchivedConversations((current) => current.filter((item) => item.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId("");
      setMessages([]);
    }
  }

  async function ensureConversation() {
    if (activeConversationId) {
      return activeConversationId;
    }

    const conversation = await createConversation({
      title: "新对话",
      model_config_id: activeModelId || null
    });
    await refreshConversations(conversation.id);
    return conversation.id;
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
      const userMessage = await appendMessage({
        conversation_id: conversationId,
        role: "user",
        content
      });
      const nextMessages = [...messages, userMessage];
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
        await refreshConversations(conversationId);
        return;
      }

      const enabledMemories = await listEnabledMemories();
      const webResults = webSearchEnabled ? await internetSearch(content) : [];
      const modelMessages: ChatMessage[] = [
        buildSystemMessage(enabledMemories, webResults),
        ...nextMessages.map((message) => ({
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
      setMessages([...nextMessages, temporaryAssistantMessage]);

      const unlisten = await listen<ChatStreamEvent>("chat-stream", (event) => {
        if (event.payload.request_id !== requestId) {
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

      await chatStream(requestId, activeModelId, modelMessages);
      unlisten();

      if (!streamedContent.trim()) {
        setMessages(nextMessages);
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

      setMessages([...nextMessages, assistantMessage]);
      if (streamedReasoning.trim()) {
        setMessageReasoning((current) => {
          const { [requestId]: _, ...rest } = current;
          return {
            ...rest,
            [assistantMessage.id]: streamedReasoning
          };
        });
      }
      await refreshConversations(conversationId);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
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

        <div className="nav-wrap">
          <nav className="nav-group">
            <div className="nav-item">
              <button className={activeKind === "all" ? "active" : ""} onClick={() => handleKindChange("all")}>
                <FileText size={18} /> 全部
              </button>
              <button className="nav-inline-create" onClick={() => void handleNewItem("note")} aria-label="新建笔记" title="新建笔记">
                <Plus size={16} />
              </button>
            </div>
            <div className="nav-item">
              <button className={activeKind === "note" ? "active" : ""} onClick={() => handleKindChange("note")}>
                <FileText size={18} /> 笔记
              </button>
              <button className="nav-inline-create" onClick={() => void handleNewItem("note")} aria-label="新建笔记" title="新建笔记">
                <Plus size={16} />
              </button>
            </div>
            <div className="nav-item">
              <button className={activeKind === "task" ? "active" : ""} onClick={() => handleKindChange("task")}>
                <CheckSquare size={18} /> 备忘录
              </button>
              <button className="nav-inline-create" onClick={() => void handleNewItem("task")} aria-label="新建备忘录" title="新建备忘录">
                <Plus size={16} />
              </button>
            </div>
            <div className="nav-item">
              <button className={activeKind === "prompt" ? "active" : ""} onClick={() => handleKindChange("prompt")}>
                <MessageSquare size={18} /> 提示词
              </button>
              <button className="nav-inline-create" onClick={() => void handleNewItem("prompt")} aria-label="新建提示词" title="新建提示词">
                <Plus size={16} />
              </button>
            </div>
            <div className="nav-item">
              <button className={activeKind === "memory" ? "active" : ""} onClick={() => handleKindChange("memory")}>
                <Brain size={18} /> 记忆库
              </button>
            </div>
          </nav>
        </div>

        <button className="settings-entry" onClick={handleOpenModelConfig}>
          <Settings size={18} />
          <span>系统设置</span>
        </button>
      </aside>

      {showModelConfig && (
        <div className="modal-backdrop" onClick={() => setShowModelConfig(false)}>
          <section className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <Settings size={18} />
                <strong>系统设置</strong>
              </div>
              <button className="ghost" onClick={handleNewModelConfig}>新建配置</button>
            </header>

            <section className="theme-section">
              <header>
                <Sun size={17} />
                <strong>外观主题</strong>
              </header>
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
            </section>

            <div className="model-config-grid">
              <aside className="model-config-list">
                {models.map((model) => (
                  <button
                    key={model.id}
                    className={model.id === modelDraft.id ? "model-config-row active" : "model-config-row"}
                    onClick={() => {
                      setModelDraft({ ...model });
                      setActiveModelId(model.id);
                    }}
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
                <div className="modal-actions">
                  <button onClick={handleSaveModel}><Save size={15} /> 保存并使用</button>
                  <button className="ghost" onClick={() => setShowModelConfig(false)}>关闭</button>
                  <button className="icon danger" aria-label="删除模型" title="删除模型" onClick={handleDeleteModel} disabled={!modelDraft.id}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>

            <section className="archived-section">
              <header>
                <Archive size={17} />
                <strong>归档对话</strong>
              </header>
              <div className="archived-list">
                {archivedConversations.map((conversation) => (
                  <div key={conversation.id} className="archived-row">
                    <button onClick={() => handleRestoreConversation(conversation)}>
                      <strong>{conversation.title}</strong>
                      <span>{conversation.archived_at || conversation.updated_at}</span>
                    </button>
                    <button
                      className="icon"
                      aria-label="恢复并回复"
                      title="恢复并回复"
                      onClick={() => handleRestoreConversation(conversation)}
                    >
                      <RotateCcw size={15} />
                    </button>
                    <button
                      className="icon danger"
                      aria-label="删除归档对话"
                      title="删除归档对话"
                      onClick={() => handleDeleteArchivedConversation(conversation.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {archivedConversations.length === 0 && <div className="empty">暂无归档对话</div>}
              </div>
            </section>
          </section>
        </div>
      )}

      <section className="workspace-pane" ref={workspaceRef}>
      <section className="list-pane" style={{ flexBasis: `${workspaceListRatio}%` }}>
        <header className="list-header">
          <strong>{workspaceLabels[activeKind]}</strong>
          <span>{activeKind === "memory" ? memoryItems.length : items.length} 条</span>
        </header>
        <div className="search-bar">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => handleSearch(event.target.value)}
            placeholder="搜索本地内容"
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
      </section>

      <div className="row-resizer" onMouseDown={beginWorkspaceSplitResize} />

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
                <button onClick={handleSaveMemory} disabled={!selectedMemory}><Save size={16} /> 保存</button>
                <button className="icon danger" aria-label="删除记忆" title="删除记忆" onClick={handleDeleteMemory} disabled={!selectedMemory}>
                  <Trash2 size={16} />
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
                <button onClick={handleSaveItem} disabled={!selectedItem}><Save size={16} /> 保存</button>
                <button className="icon danger" aria-label="删除项目" title="删除项目" onClick={handleDeleteItem} disabled={!selectedItem}>
                  <Trash2 size={16} />
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
            {activeKind === "task" && (
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

      <aside className="chat-pane">
        <header className="chat-header">
          <div>
            <Bot size={19} />
            <strong>AI 助手</strong>
          </div>
          <div className="chat-header-actions">
            <button className="icon" aria-label="新对话" title="新对话" onClick={handleNewConversation}>
              <Plus size={15} />
            </button>
            <button className="icon" aria-label="归档对话" title="归档对话" onClick={handleArchiveConversation} disabled={!activeConversationId}>
              <Archive size={15} />
            </button>
            <button className="icon danger" aria-label="删除对话" title="删除对话" onClick={handleDeleteConversation} disabled={!activeConversationId}>
              <Trash2 size={15} />
            </button>
          </div>
        </header>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={conversation.id === activeConversationId ? "conversation-row active" : "conversation-row"}
              onClick={() => setActiveConversationId(conversation.id)}
            >
              {conversation.title}
            </button>
          ))}
        </div>

        <div className="chat-log">
          {messages.map((message) => (
            <div key={message.id} className={`chat-message ${message.role}`}>
              {message.role === "assistant" && messageReasoning[message.id]?.trim() && (
                <div className="reasoning-panel">
                  <div className="reasoning-title">思考过程</div>
                  <MarkdownMessage content={messageReasoning[message.id]} />
                </div>
              )}
              <MarkdownMessage content={message.content} />
            </div>
          ))}
          {messages.length === 0 && <div className="empty">在下方输入开始对话，记录将保存在本地</div>}
        </div>

        <div className="chat-input">
          <textarea
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="问点什么，或者梳理当前的思绪..."
          />
          <div className="chat-input-footer">
            <div className="chat-input-left">
              <button
                className={webSearchEnabled ? "web-toggle active" : "web-toggle"}
                onClick={() => setWebSearchEnabled((enabled) => !enabled)}
                type="button"
                title="联网检索"
              >
                联网
              </button>
              <select value={activeModelId} onChange={(event) => handleEditModel(event.target.value)}>
                <option value="">选择模型</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
            <button aria-label="发送" title="发送" onClick={handleSendMessage} disabled={busy || !chatInput.trim()}>
              <SendHorizontal size={17} />
            </button>
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
              }}>查看</button>
            </div>
          </div>
        )}
      </aside>
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

function buildSystemMessage(memories: Memory[], webResults: WebSearchResult[] = []): ChatMessage {
  if (memories.length === 0 && webResults.length === 0) {
    return systemMessage;
  }

  const memoryContext = memories
    .map((memory) => `- ${memory.title}: ${memory.content}`)
    .join("\n");

  const webContext = webResults
    .map((result, index) => {
      const snippet = result.snippet ? `\n   摘要: ${result.snippet}` : "";
      return `${index + 1}. ${result.title}\n   链接: ${result.url}${snippet}`;
    })
    .join("\n");

  const sections = [
    memoryContext ? `用户维护的长期记忆，在相关时使用，不要无意义提及：\n${memoryContext}` : "",
    webContext ? `互联网检索结果，仅在回答当前问题相关时使用；使用其中事实时尽量给出链接：\n${webContext}` : ""
  ].filter(Boolean);

  return {
    role: "system",
    content: `${systemMessage.content}\n\n${sections.join("\n\n")}`
  };
}

export default App;
