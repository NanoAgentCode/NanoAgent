import { useEffect, useRef } from "react";
import { Activity, Bot, FileText, ImagePlus, Plus, SendHorizontal, X } from "lucide-react";
import MarkdownMessage from "./MarkdownMessage";
import AgentRuntimePanel from "./AgentRuntimePanel";
import { formatWebSearchBadge, renderMessageContent } from "../lib/appHelpers";
import { parseToolCall, parseToolResult } from "../lib/messageHelpers";
import type { ParsedToolCall } from "../lib/messageHelpers";
import type { AgentToolCall, PersistedMessage, RagFile, Item, Conversation } from "../types";
import type { UseObservabilityReturn } from "../hooks/useObservability";
import type { UseModelReturn } from "../hooks/useModel";

interface ChatPaneProps {
  activeConversationId: string;
  activeConversation: Conversation | undefined;
  messages: PersistedMessage[];
  messageReasoning: Record<string, string>;
  chatInput: string;
  ragFiles: RagFile[];
  indexingRagFileName: string;
  promptSuggestions: Item[];
  selectedPromptIndex: number;
  busy: boolean;
  uploadingImageAttachment: boolean;
  isRagDragging: boolean;
  executingToolMessageId: string | null;
  messageToolCalls: Record<string, AgentToolCall>;
  notice: string;
  obs: UseObservabilityReturn;
  model: UseModelReturn;
  handleSendMessage: () => Promise<void>;
  handleNewConversation: () => Promise<void>;
  handleCloseConversation: () => void;
  handleExecuteTool: (messageId: string, toolCall: ParsedToolCall) => Promise<void>;
  handleRejectTool: (messageId: string, toolCall: ParsedToolCall) => Promise<void>;
  handleInputChange: (value: string, cursorIndex: number) => Promise<void>;
  handleChatInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleImageFiles: (files: FileList | File[]) => Promise<number>;
  insertPrompt: (item: Item) => void;
  handleDeleteRagFile: (id: string) => Promise<void>;
  setNotice: (message: string) => void;
}

export default function ChatPane({
  activeConversationId,
  activeConversation,
  messages,
  messageReasoning,
  chatInput,
  ragFiles,
  indexingRagFileName,
  promptSuggestions,
  selectedPromptIndex,
  busy,
  uploadingImageAttachment,
  isRagDragging,
  executingToolMessageId,
  messageToolCalls,
  notice,
  obs,
  model,
  handleSendMessage,
  handleNewConversation,
  handleCloseConversation,
  handleExecuteTool,
  handleRejectTool,
  handleInputChange,
  handleChatInputKeyDown,
  handleImageFiles,
  insertPrompt,
  handleDeleteRagFile,
  setNotice
}: ChatPaneProps) {
  const runtimePanelRef = useRef<HTMLElement | null>(null);
  const runtimeToggleBtnRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // AgentRuntime 打开时，点击面板和切换按钮之外的任意位置收起
  useEffect(() => {
    if (!obs.showChatRuntime) return;
    void obs.refreshObservability();
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        runtimePanelRef.current?.contains(target) ||
        runtimeToggleBtnRef.current?.contains(target)
      ) {
        return;
      }
      obs.setShowChatRuntime(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [obs.showChatRuntime, activeConversationId]);

  function handleToggleRuntime() {
    const nextVisible = !obs.showChatRuntime;
    obs.setShowChatRuntime(nextVisible);
  }

  function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { files } = event.currentTarget;
    if (files && files.length > 0) {
      void handleImageFiles(files);
    }
    event.currentTarget.value = "";
  }

  function getToolDisplayState(messageId: string, toolCall: ParsedToolCall) {
    const runtimeToolCall = messageToolCalls[messageId];
    if (runtimeToolCall) {
      return runtimeToolCall.status;
    }

    const messageIndex = messages.findIndex((item) => item.id === messageId);
    const resultMessage = messageIndex >= 0
      ? messages.slice(messageIndex + 1).find((item) =>
          item.role === "user" &&
          item.content.startsWith(`[工具执行结果: ${toolCall.name}]`)
        )
      : null;

    if (!resultMessage) return "pending_approval";
    if (resultMessage.content.includes("用户拒绝")) return "rejected";
    if (resultMessage.content.includes("执行失败")) return "failed";
    return "completed";
  }

  function renderToolStatus(status: string, isExecuting: boolean) {
    if (isExecuting || status === "approved" || status === "running") {
      return <span style={{ color: "var(--text-secondary)" }}>正在执行...</span>;
    }
    if (status === "completed") {
      return <span style={{ color: "var(--accent-emerald)", fontWeight: "bold" }}>已执行完成</span>;
    }
    if (status === "failed") {
      return <span style={{ color: "var(--accent-danger)", fontWeight: "bold" }}>执行失败</span>;
    }
    if (status === "rejected") {
      return <span style={{ color: "var(--text-secondary)", fontWeight: "bold" }}>已拒绝</span>;
    }
    return null;
  }

  return (
    <aside className="chat-pane">
      <header className="chat-header">
        <div>
          <Bot size={19} />
          <div className="chat-header-title">
            <strong>本地智能助手</strong>
            <span>私有记忆 · 项目上下文 · 工具协作</span>
          </div>
        </div>
        {activeConversationId && (
          <div className="chat-header-actions">
            <button
              ref={runtimeToggleBtnRef}
              className={`chat-header-square ${obs.showChatRuntime ? "active" : ""}`}
              aria-label="Agent Runtime 运行详情"
              title="Agent Runtime 运行详情"
              onClick={handleToggleRuntime}
              type="button"
            >
              <Activity size={16} />
            </button>
            <button
              className="icon chat-header-square"
              aria-label="关闭当前会话"
              title="关闭当前会话"
              onClick={handleCloseConversation}
              type="button"
            >
              <X size={16} />
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
          expandedRows={obs.expandedObservabilityRows}
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

          const toolStatus = toolCall ? getToolDisplayState(message.id, toolCall) : "";
          const toolStatusLabel = toolCall ? renderToolStatus(toolStatus, executingToolMessageId === message.id) : null;

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
                <div className="tool-call-card">
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
                    {toolStatusLabel ? (
                      toolStatusLabel
                    ) : isExecuted ? (
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

      <div className={`chat-input${isRagDragging ? " rag-dragging" : ""}${uploadingImageAttachment ? " image-uploading" : ""}`}>
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
          onKeyDown={handleChatInputKeyDown}
          placeholder="问点什么，或者梳理当前的思绪..."
        />
        <input
          ref={imageInputRef}
          className="chat-image-input"
          type="file"
          accept="image/png,image/jpeg,image/bmp,image/webp,image/tiff"
          multiple
          onChange={handleImageInputChange}
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
            <button
              className="chat-header-square ghost"
              aria-label="添加图片"
              title={uploadingImageAttachment ? "图片上传中" : "添加图片"}
              onClick={() => imageInputRef.current?.click()}
              disabled={busy || uploadingImageAttachment}
              type="button"
            >
              <ImagePlus size={18} />
            </button>
            <button className="project-add-chat-btn" aria-label="新对话" title="新对话" onClick={() => void handleNewConversation()} type="button">
              <Plus size={16} />
            </button>
            <button className="chat-header-square send" aria-label="发送" title="发送" onClick={handleSendMessage} disabled={busy || !chatInput.trim()} type="button">
              <SendHorizontal size={20} />
            </button>
          </div>
        </div>
      </div>

      {notice && <div className="notice" onClick={() => setNotice("")}>{notice}</div>}
    </aside>
  );
}
