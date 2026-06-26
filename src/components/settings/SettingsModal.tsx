import {
  Activity, Archive, Bot, Brain, ChevronDown, Cpu, Info, Loader2,
  Monitor, Moon, Plus, RotateCcw, Save, Settings, Sparkles,
  Sun, Trash2
} from "lucide-react";
import { formatDateTime, formatMcpTransportLabel } from "../../lib/formatters";
import { formatWebSearchBadge, renderMessageContent, themeLabels } from "../../lib/appHelpers";
import { normalizeModelDraft } from "../../hooks/useModel";
import { isBuiltInSkill } from "../../lib/skills";
import { parseToolResult } from "../../lib/messageHelpers";
import MarkdownMessage from "../../MarkdownMessage";
import WorkspaceGrid from "../WorkspaceGrid";
import ObservabilityPanel from "../ObservabilityPanel";
import type { Conversation, ThemeMode, SettingsTab, PersistedMessage } from "../../types";
import type { UseWorkspaceReturn } from "../../hooks/useWorkspace";
import type { UseMemoryReturn } from "../../hooks/useMemory";
import type { UseModelReturn } from "../../hooks/useModel";
import type { UseSkillsReturn } from "../../hooks/useSkills";
import type { UseMcpReturn } from "../../hooks/useMcp";
import type { UseEnvReturn } from "../../hooks/useEnv";
import type { UseObservabilityReturn } from "../../hooks/useObservability";

interface SettingsModalProps {
  showModelConfig: boolean;
  setShowModelConfig: (show: boolean) => void;
  activeSettingsTab: SettingsTab;
  setActiveSettingsTab: (tab: SettingsTab) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  workspace: UseWorkspaceReturn;
  memory: UseMemoryReturn;
  workspaceRef: React.RefObject<HTMLElement | null>;
  model: UseModelReturn;
  skills: UseSkillsReturn;
  mcp: UseMcpReturn;
  env: UseEnvReturn;
  obs: UseObservabilityReturn;
  archivedConversations: Conversation[];
  previewArchivedId: string;
  previewMessages: PersistedMessage[];
  loadArchivedPreview: (conversationId: string) => Promise<void>;
  handleRestoreConversation: (conversation: Conversation) => Promise<void>;
  handleDeleteArchivedConversation: (conversation: Conversation) => Promise<void>;
}

export default function SettingsModal({
  showModelConfig,
  setShowModelConfig,
  activeSettingsTab,
  setActiveSettingsTab,
  themeMode,
  setThemeMode,
  workspace,
  memory,
  workspaceRef,
  model,
  skills,
  mcp,
  env,
  obs,
  archivedConversations,
  previewArchivedId,
  previewMessages,
  loadArchivedPreview,
  handleRestoreConversation,
  handleDeleteArchivedConversation
}: SettingsModalProps) {
  if (!showModelConfig) return null;

  return (
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
                workspace.handleKindChange("memory");
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
                <WorkspaceGrid workspace={workspace} memory={memory} workspaceRef={workspaceRef as React.Ref<HTMLElement>} />
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
                  <p className="description description--tight">配置用于聊天对话的大语言模型，供 AI 助手和会话调用。</p>
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
                          >
                            <span className="status-dot" style={{ backgroundColor: dotColor }} title={dotTitle} />
                            <div className="model-config-row-info">
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
                          <input value={model.modelDraft.name} onChange={(event) => model.setModelDraft({ ...model.modelDraft, name: event.target.value })} placeholder="例如：OpenAI 主账号" />
                        </label>
                        <label>
                          <span>协议类型</span>
                          <select value={model.modelDraft.provider} onChange={(event) => model.handleProviderChange(event.target.value)}>
                            <option value="openai-compatible">OpenAI 兼容协议</option>
                            <option value="anthropic">Anthropic 兼容协议</option>
                          </select>
                        </label>
                        <label>
                          <span>接口地址</span>
                          <input value={model.modelDraft.base_url} onChange={(event) => model.setModelDraft({ ...model.modelDraft, base_url: event.target.value })} placeholder="https://api.openai.com/v1" />
                        </label>
                        <label>
                          <span>模型标识</span>
                          <input value={model.modelDraft.model} onChange={(event) => model.setModelDraft({ ...model.modelDraft, model: event.target.value })} placeholder="gpt-4o-mini" />
                        </label>
                        <label>
                          <span>API Key</span>
                          <input value={model.modelDraft.api_key} type="password" onChange={(event) => model.setModelDraft({ ...model.modelDraft, api_key: event.target.value })} placeholder="用于对话模型调用" />
                        </label>
                      </div>
                      <div className="modal-actions icon-actions icon-actions-bar">
                        {model.llmTestStatus.status === "success" && (
                          <span className="status-text-panel status-text-panel--success">
                            <span className="status-dot status-dot--success" />连通性正常
                          </span>
                        )}
                        {model.llmTestStatus.status === "error" && (
                          <span className="status-text-panel status-text-panel--error" title={model.llmTestStatus.message}>
                            <span className="status-dot status-dot--error" />连通性异常 (悬浮查看详情)
                          </span>
                        )}
                        {(model.llmTestStatus.status === "idle" || model.llmTestStatus.status === "testing") && <div className="status-spacer" />}
                        <button className="icon-text-btn" onClick={model.handleTestLlm} disabled={model.llmTestStatus.status === "testing"} title="测试连接" type="button">
                          {model.llmTestStatus.status === "testing" ? <Loader2 className="svg-spin" /> : <Activity />}
                          <span>{model.llmTestStatus.status === "testing" ? "测试中..." : "测试连接"}</span>
                        </button>
                        <button className="icon-text-btn success-btn" onClick={model.handleSaveModel} title="保存并使用" type="button">
                          <Save /><span>保存并使用</span>
                        </button>
                        <button className="icon-text-btn danger-btn" title="删除模型" onClick={model.handleDeleteModel} disabled={!model.modelDraft.id || model.modelDraft.id === "embedding-config"} type="button">
                          <Trash2 /><span>删除</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {activeSettingsTab === "embedding" && (
              <div className="settings-tab-content model-tab-content">
                <div className="model-header-row"><h3>嵌入模型</h3></div>
                <p className="description description--tight">配置全局唯一嵌入模型 API，用于轻量 RAG 的文档向量化与匹配。</p>
                <div className="embedding-config-card">
                  <div className="model-config-form embedding-config-form">
                    <div className="model-form-card">
                      <label>
                        <span>协议类型</span>
                        <select value={model.embeddingDraft.embedding_provider} onChange={(event) => model.handleEmbeddingProviderChange(event.target.value)} disabled>
                          <option value="openai-compatible">OpenAI 兼容协议</option>
                        </select>
                      </label>
                      <label>
                        <span>接口地址</span>
                        <input value={model.embeddingDraft.embedding_base_url} onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_base_url: event.target.value })} placeholder="https://api.openai.com/v1" />
                      </label>
                      <label>
                        <span>模型标识</span>
                        <input value={model.embeddingDraft.embedding_model} onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_model: event.target.value })} placeholder="text-embedding-3-small" />
                      </label>
                      <label>
                        <span>API Key</span>
                        <input value={model.embeddingDraft.embedding_api_key} type="password" onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_api_key: event.target.value })} placeholder="用于 RAG 向量化，可与大模型不同" />
                      </label>
                    </div>
                    <div className="modal-actions icon-actions icon-actions-bar">
                      {model.embeddingTestStatus.status === "success" && (
                        <span className="status-text-panel status-text-panel--success">
                          <span className="status-dot status-dot--success" />连通性正常
                        </span>
                      )}
                      {model.embeddingTestStatus.status === "error" && (
                        <span className="status-text-panel status-text-panel--error" title={model.embeddingTestStatus.message}>
                          <span className="status-dot status-dot--error" />连通性异常 (悬浮查看详情)
                        </span>
                      )}
                      {(model.embeddingTestStatus.status === "idle" || model.embeddingTestStatus.status === "testing") && <div className="status-spacer" />}
                      <button className="icon-text-btn" onClick={model.handleTestEmbedding} disabled={model.embeddingTestStatus.status === "testing"} title="测试连接" type="button">
                        {model.embeddingTestStatus.status === "testing" ? <Loader2 className="svg-spin" /> : <Activity />}
                        <span>{model.embeddingTestStatus.status === "testing" ? "测试中..." : "测试连接"}</span>
                      </button>
                      <button className="icon-text-btn success-btn" onClick={model.handleSaveEmbeddingModel} title="保存并使用" type="button">
                        <Save /><span>保存并使用</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSettingsTab === "skills" && (
              <div className="settings-tab-content skills-tab-layout">
                <div className="skills-header-row">
                  <div>
                    <h3>Skills 管理</h3>
                    <p className="description description--no-margin">配置并扩展 AI 助手的工具与自动化能力（例如内置 Anthropic 官方的 Text Editor、Bash Tool 等）。</p>
                  </div>
                </div>
                <div className="skills-config-grid">
                  <aside className="skills-config-list skills-config-list-inner">
                    <div style={{ marginBottom: "4px" }}>
                      <button className="secondary skills-add-btn-full"
                        onClick={() => { skills.setIsAddingSkill(true); skills.setSelectedSkillId(""); }} type="button">
                        添加自定义技能
                      </button>
                    </div>
                    <div className="skills-config-list-scroll">
                      {skills.skills.map((skill) => (
                        <button key={skill.id} className={!skills.isAddingSkill && skill.id === skills.selectedSkillId ? "skills-config-row active" : "skills-config-row"}
                          onClick={() => { skills.setIsAddingSkill(false); skills.setSelectedSkillId(skill.id); }} type="button">
                          <div className="skills-config-row-header">
                            <strong>{skill.name}</strong>
                            <span className={`skills-indicator-badge ${skill.enabled ? "enabled" : "disabled"}`}>{skill.enabled ? "已启用" : "未启用"}</span>
                          </div>
                          <span>{skill.provider}</span>
                        </button>
                      ))}
                    </div>
                  </aside>
                  <div className="skills-config-form-scroll">
                    {skills.isAddingSkill ? (
                      <div className="skills-add-form-inner">
                        <h4 className="skills-h4-no-margin">添加自定义技能</h4>
                        <div className="skills-param-field env-field-no-margin">
                          <label className="skills-field-label">唯一标识符 (ID):</label>
                          <input value={skills.newSkillDraft.id} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, id: e.target.value.trim().toLowerCase() }))} placeholder="例如: custom_file_helper" />
                        </div>
                        <div className="skills-param-field env-field-no-margin">
                          <label className="skills-field-label">技能名称 (Name):</label>
                          <input value={skills.newSkillDraft.name} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, name: e.target.value }))} placeholder="例如: 自定义文件助手" />
                        </div>
                        <div className="skills-param-field env-field-no-margin">
                          <label className="skills-field-label">文档/项目链接 (Doc URL):</label>
                          <input value={skills.newSkillDraft.docUrl} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, docUrl: e.target.value }))} placeholder="https://..." />
                        </div>
                        <div className="skills-param-field env-field-no-margin">
                          <label className="skills-field-label">技能描述 (Description):</label>
                          <textarea value={skills.newSkillDraft.description} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, description: e.target.value }))} placeholder="描述该技能的作用以及模型如何调用它..." rows={2}
                            className="skills-textarea-custom" />
                        </div>
                        <div className="skills-add-form-actions">
                          <button className="secondary" onClick={() => { skills.setIsAddingSkill(false); if (skills.skills.length > 0) skills.setSelectedSkillId(skills.skills[0].id); }} type="button">取消</button>
                          <button className="primary" onClick={skills.handleSaveNewSkill} type="button"><Save size={15} /> 确认添加</button>
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
                            <p className="skills-desc-text">{skill.description}</p>
                            {skill.docUrl && (
                              <a href={skill.docUrl} target="_blank" rel="noopener noreferrer" className="skills-doc-link skills-link-text">查看官方文档说明 ↗</a>
                            )}
                          </div>
                          <div className="skills-form-section skills-form-section-margin">
                            <h5>启用状态</h5>
                            <div className="skills-switch-row">
                              <span className="skills-desc-text">{skill.enabled ? "该技能当前已激活，模型将在合适的时候自动调用" : "该技能当前已禁用"}</span>
                            </div>
                          </div>
                          <div className="skills-form-actions">
                            <button className={skill.enabled ? "danger" : "primary"} onClick={() => skills.handleToggleSkill(skill.id, !skill.enabled)} type="button">
                              {skill.enabled ? "禁用技能" : "启用技能"}
                            </button>
                            {!isSystemSkill && (
                              <button className="danger" onClick={() => skills.handleDeleteSkill(skill.id)} type="button">删除技能</button>
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
                <p className="description description--tight">连接符合 Model Context Protocol 规范的工具服务器，支持 stdio、SSE 和 Streamable HTTP。</p>
                <div className="model-config-grid mcp-config-grid">
                  <aside className="model-config-list">
                    {mcp.mcpServers.map((server) => {
                      const connected = server.status.connected;
                      const busy = mcp.mcpBusyId === server.config.id;
                      return (
                        <button key={server.config.id} className={server.config.id === mcp.selectedMcpServerId ? "mcp-config-row active" : "mcp-config-row"}
                          onClick={() => mcp.setSelectedMcpServerId(server.config.id)} type="button">
                          <div className="mcp-config-row-header">
                            <strong>{server.config.name}</strong>
                            <button className={connected ? "mcp-connection-badge connected" : "mcp-connection-badge"}
                              onClick={(event) => { event.stopPropagation(); if (connected) { void mcp.handleDisconnectMcpServer(server.config.id); } else { void mcp.handleConnectMcpServer(server.config.id); } }}
                              disabled={busy} title={connected ? "断开 MCP 服务器" : "连接 MCP 服务器"} type="button">
                                  {busy ? <Loader2 className="svg-spin mcp-loader-small" /> : <span className="mcp-pill-indicator" />}
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
                      <label><span>服务名称</span>
                        <input value={mcp.mcpDraft.name} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, name: event.target.value })} placeholder="amap-maps" />
                      </label>
                      <label><span>协议</span>
                        <select value={mcp.mcpDraft.transport} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, transport: event.target.value })}>
                          <option value="stdio">stdio 本地进程</option>
                          <option value="sse">SSE</option>
                          <option value="streamable_http">Streamable HTTP</option>
                        </select>
                      </label>
                      {mcp.mcpDraft.transport === "stdio" ? (
                        <>
                          <label><span>命令</span>
                            <textarea value={mcp.stdioCommandLine} onChange={(event) => mcp.setStdioCommandLine(event.target.value)} rows={3}
                              placeholder={"npx -y @modelcontextprotocol/server-filesystem C:\\Users\\13439\\Desktop"} spellCheck={false} />
                          </label>
                          <label><span>环境变量 JSON</span>
                            <textarea value={mcp.mcpDraft.env_json} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, env_json: event.target.value })} rows={3} placeholder={'{"API_KEY": "..."}'} />
                          </label>
                          <label><span>工作目录</span>
                            <input value={mcp.mcpDraft.working_dir} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, working_dir: event.target.value })} placeholder="可选" />
                          </label>
                        </>
                      ) : (
                        <>
                          <label><span>地址</span>
                            <input value={mcp.mcpDraft.url} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, url: event.target.value })}
                              placeholder={mcp.mcpDraft.transport === "sse" ? "https://example.com/sse" : "https://example.com/mcp"} />
                          </label>
                          <label><span>请求头 JSON</span>
                            <textarea value={mcp.mcpDraft.headers_json} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, headers_json: event.target.value })} rows={3} placeholder={'{"Authorization": "Bearer ..."}'} />
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
                            <button className="icon-only-btn compact" type="button" aria-label="查看工具详情" title="查看工具详情"><Info /></button>
                            <div className="mcp-tools-tooltip" role="tooltip">
                              <div className="mcp-tools-tooltip-header">
                                <strong>工具详情{mcp.selectedMcpServer.status.connected ? ` · ${mcp.selectedMcpServer.tools.length}` : ""}</strong>
                                {mcp.selectedMcpServer.status.connected && (
                                  <button className="icon-only-btn compact" onClick={() => void mcp.handleRefreshMcpTools(mcp.selectedMcpServer!.config.id)}
                                    disabled={mcp.mcpBusyId === mcp.selectedMcpServer.config.id} type="button" title="刷新工具列表" aria-label="刷新工具列表">
                                    {mcp.mcpBusyId === mcp.selectedMcpServer.config.id ? <Loader2 className="svg-spin" /> : <RotateCcw />}
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
                      <button className="icon-text-btn success-btn" onClick={mcp.handleSaveMcpServer} title="保存配置" type="button"><Save /><span>保存</span></button>
                      <button className="icon-text-btn danger-btn" title="删除 MCP 服务器" onClick={mcp.handleDeleteMcpServer} disabled={mcp.mcpBusyId === mcp.mcpDraft.id} type="button"><Trash2 /><span>删除</span></button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSettingsTab === "environment" && (
              <div className="settings-tab-content env-tab-content">
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
                          <span className={env.envStatus.node ? "env-status-ok" : "env-status-missing"}>{env.envStatus.node ? "✓ 已就绪" : "✗ 未检测到"}</span>
                        </div>
                        <div className="env-status-item-compact">
                          <span>Python</span>
                          <span className={env.envStatus.python ? "env-status-ok" : "env-status-missing"}>{env.envStatus.python ? "✓ 已就绪" : "✗ 未检测到"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="env-status-actions">
                      <div className="env-actions-menu-wrap">
                        <button className="secondary env-action-btn" type="button" onClick={() => env.setShowEnvActionsMenu((current) => !current)} aria-expanded={env.showEnvActionsMenu}>
                          更多<ChevronDown size={16} />
                        </button>
                        {env.showEnvActionsMenu && (
                          <div className="env-actions-menu">
                            <button type="button" onClick={() => { env.setShowEnvActionsMenu(false); void env.runEnvCheck(); }} disabled={env.isCheckingEnv || env.isInstallingEnv}>
                              {env.isCheckingEnv ? "正在检测..." : "重新检测环境"}
                            </button>
                            <button type="button" onClick={() => { env.setShowEnvActionsMenu(false); void env.handleAutoInstallMissing(); }} disabled={env.isCheckingEnv || env.isInstallingEnv}>
                              {env.isInstallingEnv ? "正在安装..." : "自动配置/安装 (winget)"}
                            </button>
                            {env.envStatus.node && env.envStatus.python && (
                              <button type="button" onClick={() => { env.setShowEnvActionsMenu(false); env.setShowCustomPaths((current) => !current); }}>
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
                      <div className="env-grid-2col">
                        <div className="skills-param-field env-field-no-margin">
                          <label className="env-section-label">Node.js 自定义路径:</label>
                          <input value={env.nodePath} onChange={(e) => env.setNodePath(e.target.value)} placeholder="系统默认 PATH / 点击保存" onBlur={env.handleSaveCustomPaths} className="env-input-compact" />
                        </div>
                        <div className="skills-param-field env-field-no-margin">
                          <label className="env-section-label">Python 自定义路径:</label>
                          <input value={env.pythonPath} onChange={(e) => env.setPythonPath(e.target.value)} placeholder="系统默认 PATH / 点击保存" onBlur={env.handleSaveCustomPaths} className="env-input-compact" />
                        </div>
                      </div>
                      {env.isInstallingEnv && (
                        <div className="env-install-progress">
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
                          <span className={env.envStatus.tavily_cli ? "env-status-ok" : "env-status-missing"}>{env.envStatus.tavily_cli ? "✓ 已就绪" : "✗ 未检测到"}</span>
                        </div>
                        <div className="env-status-item-compact">
                          <span>API Key</span>
                          <span className={env.tavilyApiKey.trim() ? "env-status-ok" : "env-status-missing"}>{env.tavilyApiKey.trim() ? "✓ 已配置" : "✗ 未配置"}</span>
                        </div>
                      </div>
                    </div>
                    {!env.envStatus.tavily_cli && (
                      <div className="env-status-actions">
                        <button className="secondary env-action-btn" type="button" onClick={env.handleInstallTavilyCli} disabled={env.isInstallingEnv || env.isCheckingEnv}>
                          {env.isInstallingEnv ? "安装中..." : "安装 CLI"}
                        </button>
                      </div>
                    )}
                  </div>
                      {env.isInstallingEnv && env.envInstallProgress.includes("Tavily") && (
                        <div className="env-install-progress">
                          <span className="spinner">⏳</span> {env.envInstallProgress}
                        </div>
                      )}
                      <div className="env-grid-tavily">
                        <div className="skills-param-field env-field-no-margin">
                          <label className="env-section-label">Tavily API Key:</label>
                          <input type="password" value={env.tavilyApiKey} onChange={(e) => env.setTavilyApiKey(e.target.value)} placeholder="tvly-..." className="env-input-compact" />
                        </div>
                        <button className="secondary" onClick={env.handleSaveTavilyApiKey} disabled={env.isSavingTavilyApiKey} type="button" style={{ height: "32px" }}>
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
  );
}
