import { useEffect, useState, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  appendMessage,
  archiveConversation,
  renameConversation,
  chat,
  chatStream,
  createConversation,
  createMemory,
  deleteConversation,
  deleteMessages,
  listEnabledMemories,
  listArchivedConversations,
  listConversations,
  listItems,
  listMessages,
  listProjectFiles,
  listRagFiles,
  searchRagContext,
  deleteRagFile,
  indexRagFile,
  readAbsoluteFile
} from "../api";
import type {
  ChatMessage,
  ChatStreamEvent,
  AgentRun,
  AgentToolCall,
  Conversation,
  Item,
  ItemKind,
  Memory,
  McpServerView,
  ModelConfig,
  PersistedMessage,
  RagChunkMatch,
  RagFile,
  ProjectEntry,
  ProjectFileEntry
} from "../types";
import {
  isSupportedRagFile,
  MAX_CONTEXT_TOKENS,
  estimateTokens,
  formatProjectFileTree,
  buildRuntimeContext
} from "../lib/formatters";
import {
  extractMemoryDraft,
  parseTags,
  parseToolCall,
  parseToolResult,
  type ParsedToolCall
} from "../lib/messageHelpers";
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
} from "../lib/agentSafe";

import type { UseProjectsReturn } from "./useProjects";
import type { UseModelReturn } from "./useModel";
import type { UseSkillsReturn } from "./useSkills";
import type { UseMcpReturn } from "./useMcp";
import type { UseMemoryReturn } from "./useMemory";

const systemMessage: ChatMessage = {
  role: "system",
  content: "你是一个专注的本地效率助手。请保持回答简明且实用。记忆写入由应用本地功能处理；除非应用明确提供结果，否则不要声称已经保存或更新记忆。"
};

const kindLabels: Record<ItemKind, string> = {
  note: "笔记",
  prompt: "提示词"
};

function buildSystemMessage(
  memories: Memory[],
  activeProject: ProjectEntry | null = null,
  projectFiles: ProjectFileEntry[] = [],
  skills: any[] = [],
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

export interface UseChatReturn {
  conversations: Conversation[];
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  archivedConversations: Conversation[];
  setArchivedConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  previewArchivedId: string;
  setPreviewArchivedId: React.Dispatch<React.SetStateAction<string>>;
  previewMessages: PersistedMessage[];
  setPreviewMessages: React.Dispatch<React.SetStateAction<PersistedMessage[]>>;
  activeConversationId: string;
  setActiveConversationId: React.Dispatch<React.SetStateAction<string>>;
  messages: PersistedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<PersistedMessage[]>>;
  messageReasoning: Record<string, string>;
  setMessageReasoning: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  chatInput: string;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  ragFiles: RagFile[];
  setRagFiles: React.Dispatch<React.SetStateAction<RagFile[]>>;
  isRagDragging: boolean;
  setIsRagDragging: React.Dispatch<React.SetStateAction<boolean>>;
  indexingRagFileName: string;
  setIndexingRagFileName: React.Dispatch<React.SetStateAction<string>>;
  promptSuggestions: Item[];
  setPromptSuggestions: React.Dispatch<React.SetStateAction<Item[]>>;
  selectedPromptIndex: number;
  setSelectedPromptIndex: React.Dispatch<React.SetStateAction<number>>;
  promptTriggerIndex: number;
  setPromptTriggerIndex: React.Dispatch<React.SetStateAction<number>>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  executingToolMessageId: string | null;
  setExecutingToolMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  messageToolCalls: Record<string, AgentToolCall>;
  setMessageToolCalls: React.Dispatch<React.SetStateAction<Record<string, AgentToolCall>>>;
  conversationRunIds: Record<string, string>;
  setConversationRunIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  activeConversation: Conversation | undefined;
  activeConversationProject: ProjectEntry | null;
  loadMessages: (conversationId: string) => Promise<void>;
  refreshRagFiles: (conversationId: string) => Promise<void>;
  refreshConversations: (selectId?: string) => Promise<void>;
  createConversationForCurrentScope: (project: ProjectEntry | null) => Promise<Conversation>;
  ensureConversation: (project: ProjectEntry | null) => Promise<string>;
  getConversationProjectHint: () => ProjectEntry | null;
  handleNewConversation: () => Promise<void>;
  handleNewProjectConversation: (project: ProjectEntry) => Promise<void>;
  handleDeleteConversation: () => Promise<void>;
  handleArchiveConversation: () => Promise<void>;
  handleRenameConversation: (id: string, currentTitle: string) => Promise<void>;
  handleContextArchiveConversation: (conversation: Conversation) => Promise<void>;
  handleContextDeleteConversation: (conversation: Conversation) => Promise<void>;
  handleSendMessage: () => Promise<void>;
  handleExecuteTool: (messageId: string, toolCall: ParsedToolCall) => Promise<void>;
  handleRejectTool: (messageId: string, toolCall: ParsedToolCall) => Promise<void>;
  handleCloseConversation: () => void;
  handleRagFiles: (files: FileList | File[]) => Promise<void>;
  handleDroppedFilePaths: (paths: string[]) => Promise<void>;
  handleDeleteRagFile: (id: string) => Promise<void>;
  handleInputChange: (value: string, cursorIndex: number) => Promise<void>;
  handleChatInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => Promise<void>;
  insertPrompt: (item: Item) => void;
  loadArchivedPreview: (conversationId: string) => Promise<void>;
  resolveConversationModelId: (conversationId?: string | null) => string;
}

export interface UseChatArgs {
  setNotice: (message: string) => void;
  projects: UseProjectsReturn;
  model: UseModelReturn;
  skills: UseSkillsReturn;
  mcp: UseMcpReturn;
  memory: UseMemoryReturn;
  showModelConfig: boolean;
  activeSettingsTab: string;
}

export function useChat({
  setNotice,
  projects,
  model,
  skills,
  mcp,
  memory,
  showModelConfig,
  activeSettingsTab
}: UseChatArgs): UseChatReturn {
  const messageLoadRequestRef = useRef(0);
  const activeConversationIdRef = useRef("");

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

  const [executingToolMessageId, setExecutingToolMessageId] = useState<string | null>(null);
  const [messageToolCalls, setMessageToolCalls] = useState<Record<string, AgentToolCall>>({});
  const [conversationRunIds, setConversationRunIds] = useState<Record<string, string>>({});

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
    if (!showModelConfig || activeSettingsTab !== "archive") {
      setPreviewArchivedId("");
      setPreviewMessages([]);
    }
  }, [showModelConfig, activeSettingsTab]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, model.activeModelId]);

  function resolveConversationModelId(conversationId?: string | null) {
    const savedModelId =
      (conversationId ? projects.findConversationById(conversationId)?.model_config_id : activeConversation?.model_config_id) ||
      "";

    if (savedModelId && model.models.some((m) => m.id === savedModelId)) {
      return savedModelId;
    }

    return model.activeModelId;
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

  async function ensureConversation(project: ProjectEntry | null) {
    if (activeConversationId) {
      return activeConversationId;
    }

    const conversation = await createConversationForCurrentScope(project);
    setActiveConversationId(conversation.id);
    return conversation.id;
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
        setNotice("已保存");
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

  function handleCloseConversation() {
    setActiveConversationId("");
    setMessages([]);
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

  async function handleChatInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
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

  function insertPrompt(item: Item) {
    if (promptTriggerIndex === -1) return;
    const value = chatInput;
    const beforeTrigger = value.substring(0, promptTriggerIndex);
    
    const textarea = document.querySelector(".chat-input textarea") as HTMLTextAreaElement | null;
    const selectionEnd = textarea?.selectionEnd || value.length;
    const afterCursor = value.substring(selectionEnd);
    
    const nextValue = beforeTrigger + item.body + " " + afterCursor;
    setChatInput(nextValue);
    setPromptSuggestions([]);
    setPromptTriggerIndex(-1);
    
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        const nextCursorIndex = beforeTrigger.length + item.body.length + 1;
        textarea.setSelectionRange(nextCursorIndex, nextCursorIndex);
      }
    }, 0);
  }

  return {
    conversations,
    setConversations,
    archivedConversations,
    setArchivedConversations,
    previewArchivedId,
    setPreviewArchivedId,
    previewMessages,
    setPreviewMessages,
    activeConversationId,
    setActiveConversationId,
    messages,
    setMessages,
    messageReasoning,
    setMessageReasoning,
    chatInput,
    setChatInput,
    ragFiles,
    setRagFiles,
    isRagDragging,
    setIsRagDragging,
    indexingRagFileName,
    setIndexingRagFileName,
    promptSuggestions,
    setPromptSuggestions,
    selectedPromptIndex,
    setSelectedPromptIndex,
    promptTriggerIndex,
    setPromptTriggerIndex,
    busy,
    setBusy,
    executingToolMessageId,
    setExecutingToolMessageId,
    messageToolCalls,
    setMessageToolCalls,
    conversationRunIds,
    setConversationRunIds,
    activeConversation,
    activeConversationProject,
    loadMessages,
    refreshRagFiles,
    refreshConversations,
    createConversationForCurrentScope,
    ensureConversation,
    getConversationProjectHint,
    handleNewConversation,
    handleNewProjectConversation,
    handleDeleteConversation,
    handleArchiveConversation,
    handleRenameConversation,
    handleContextArchiveConversation,
    handleContextDeleteConversation,
    handleSendMessage,
    handleExecuteTool,
    handleRejectTool,
    handleCloseConversation,
    handleRagFiles,
    handleDroppedFilePaths,
    handleDeleteRagFile,
    handleInputChange,
    handleChatInputKeyDown,
    insertPrompt,
    loadArchivedPreview,
    resolveConversationModelId
  };
}
