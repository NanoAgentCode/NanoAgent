import { useEffect, useMemo, useRef, useState } from "react";
import { setTheme } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import {
  Archive,
  Bot,
  Brain,
  CheckSquare,
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
  Trash2
} from "lucide-react";
import {
  appendMessage,
  archiveConversation,
  chat,
  chatStream,
  createConversation,
  createItem,
  createMemory,
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
type SettingsTab =
  | "task"
  | "prompt"
  | "memory"
  | "theme"
  | "archive"
  | "model"
  | "skills"
  | "mcp";

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
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("task");
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

            const summaryResponse = await chat(activeModelId, [{ role: "user", content: summaryPrompt }]);
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
        buildSystemMessage(enabledMemories, webResults),
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

      setMessages([...currentMessages, assistantMessage]);
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
            <div style={{ padding: "12px", borderTop: "1px solid var(--border-color)", display: "flex", gap: "8px" }}>
              <button 
                className="ghost" 
                onClick={() => void handleNewItem(activeKind as ItemKind)} 
                style={{ flex: 1, minHeight: "32px", fontSize: "13px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", border: "1px solid var(--border-color)", borderRadius: "6px" }}
              >
                <Plus size={14} /> 新建{kindLabels[activeKind as ItemKind] || "备忘录"}
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
            <div>
              <Folder size={14} />
              <span>项目区</span>
            </div>
          </div>
          <div className="sidebar-project-list">
            <button className="sidebar-project-item active">
              <span className="sidebar-project-dot" />
              <span>默认项目</span>
            </button>
            <button className="sidebar-project-item">
              <span className="sidebar-project-dot" />
              <span>知识库</span>
            </button>
          </div>
        </div>

        <div className="sidebar-section chats">
          <div className="sidebar-section-header">
            <div>
              <MessageSquare size={14} />
              <span>对话区</span>
            </div>
            <button className="new-chat-btn" onClick={handleNewConversation} title="新建对话">
              <Plus size={14} />
            </button>
          </div>
          <div className="sidebar-chat-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === activeConversationId ? "sidebar-chat-item active" : "sidebar-chat-item"}
                onClick={() => setActiveConversationId(conversation.id)}
              >
                <MessageSquare size={14} className="chat-icon" />
                <span className="chat-title">{conversation.title}</span>
              </button>
            ))}
            {conversations.length === 0 && <div className="empty">暂无对话</div>}
          </div>
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
                  </div>
                )}

                {activeSettingsTab === "model" && (
                  <div className="settings-tab-content model-tab-content">
                    <div className="model-header-row">
                      <h3>模型管理</h3>
                      <button className="ghost compact-btn" onClick={handleNewModelConfig}><Plus size={14} /> 新建配置</button>
                    </div>
                    <p className="description" style={{ marginTop: "-4px" }}>配置OpenAI兼容接口或Claude原生模型，供AI助手对话使用。</p>
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
                          <button className="icon danger" aria-label="删除模型" title="删除模型" onClick={handleDeleteModel} disabled={!modelDraft.id}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeSettingsTab === "skills" && (
                  <div className="settings-tab-content placeholder-tab-content">
                    <h3>Skills 管理</h3>
                    <p className="description">配置并扩展 AI 助手的工具与自动化能力（例如执行脚本、文件读写、网页检索等）。</p>
                    <div className="skills-mockup-list">
                      <div className="skills-mockup-item">
                        <div className="skills-item-header">
                          <strong className="skills-item-title">Terminal Execution (命令行执行)</strong>
                          <span className="skills-status-badge">已启用</span>
                        </div>
                        <span className="skills-item-desc">允许 AI 助手在本地安全终端中运行受控的命令与脚本。</span>
                      </div>
                      <div className="skills-mockup-item">
                        <div className="skills-item-header">
                          <strong className="skills-item-title">File System Reader (文件读取器)</strong>
                          <span className="skills-status-badge">已启用</span>
                        </div>
                        <span className="skills-item-desc">支持 AI 检索和读取指定项目目录中的代码与文档。</span>
                      </div>
                      <div className="skills-mockup-item">
                        <div className="skills-item-header">
                          <strong className="skills-item-title">Web Browser Agent (网页浏览器)</strong>
                          <span className="skills-status-badge disabled">未启用</span>
                        </div>
                        <span className="skills-item-desc">支持 AI 启动无头浏览器，提取复杂动态网页内容。</span>
                      </div>
                    </div>
                    <div className="coming-soon-banner">
                      <span>✨ Skills 管理功能即将在下个版本上线，敬请期待！</span>
                    </div>
                  </div>
                )}

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
          <div className="chat-header-actions">
            <button className="icon" aria-label="归档对话" title="归档对话" onClick={handleArchiveConversation} disabled={!activeConversationId}>
              <Archive size={15} />
            </button>
            <button className="icon danger" aria-label="删除对话" title="删除对话" onClick={handleDeleteConversation} disabled={!activeConversationId}>
              <Trash2 size={15} />
            </button>
          </div>
        </header>

        <div className="chat-log">
          {messages.map((message) => (
            <div key={message.id} className={`chat-message ${message.role}`}>
              {message.role === "assistant" && messageReasoning[message.id]?.trim() && (
                <details className="reasoning-panel">
                  <summary className="reasoning-title">思考过程</summary>
                  <MarkdownMessage content={messageReasoning[message.id]} />
                </details>
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
            <div className="chat-input-actions">
              <button className="chat-input-action ghost" aria-label="新对话" title="新对话" onClick={handleNewConversation} type="button">
                <Plus size={17} />
              </button>
              <button className="chat-input-action send" aria-label="发送" title="发送" onClick={handleSendMessage} disabled={busy || !chatInput.trim()} type="button">
                <SendHorizontal size={17} />
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

  const sections = [
    runtimeContext,
    memoryContext ? `用户维护的长期记忆，在相关时使用，不要无意义提及：\n${memoryContext}` : "",
    webContext ? `互联网检索结果，仅在回答当前问题相关时使用；使用其中事实时尽量给出链接：\n${webContext}` : ""
  ].filter(Boolean);

  return {
    role: "system",
    content: `${systemMessage.content}\n\n${sections.join("\n\n")}`
  };
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
