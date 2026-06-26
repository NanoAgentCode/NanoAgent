import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { formatDateTime } from "../../lib/formatters";
import { formatWebSearchBadge, renderMessageContent } from "../../lib/appHelpers";
import { parseToolResult } from "../../lib/messageHelpers";
import type { Conversation, PersistedMessage } from "../../types";

interface SettingsArchiveTabProps {
  archivedConversations: Conversation[];
  previewArchivedId: string;
  previewMessages: PersistedMessage[];
  loadArchivedPreview: (conversationId: string) => Promise<void>;
  handleRestoreConversation: (conversation: Conversation) => Promise<void>;
  handleDeleteArchivedConversation: (conversation: Conversation) => Promise<void>;
}

export default function SettingsArchiveTab({
  archivedConversations,
  previewArchivedId,
  previewMessages,
  loadArchivedPreview,
  handleRestoreConversation,
  handleDeleteArchivedConversation
}: SettingsArchiveTabProps) {
  return (
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
                  <span className="archive-indicator-badge">已归档</span>
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
                      if (conversation) void handleRestoreConversation(conversation);
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
                      if (conversation) void handleDeleteArchivedConversation(conversation);
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
                              <small title={webSearchMeta.fallback_reason}>{webSearchMeta.fallback_reason}</small>
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
  );
}
