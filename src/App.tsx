import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Archive,
  Cpu,
  Edit,
  Edit3,
  FolderPlus,
  Power,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  archiveConversation,
  deleteConversation,
  minimizeToTray,
  quitApp,
  showAppWindow
} from "./api";
import { useEnv } from "./hooks/useEnv";
import { useMcp } from "./hooks/useMcp";
import { useMemory } from "./hooks/useMemory";
import { useModel } from "./hooks/useModel";
import { useSkills } from "./hooks/useSkills";
import { useObservability } from "./hooks/useObservability";
import { useProjects } from "./hooks/useProjects";
import { useThemeMode } from "./hooks/useThemeMode";
import { useWorkspace } from "./hooks/useWorkspace";
import { useChat } from "./hooks/useChat";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import ConfirmDialogHost from "./components/ConfirmDialogHost";
import OpsPanel from "./components/OpsPanel";
import SettingsModal from "./components/settings/SettingsModal";
import NotificationToast from "./components/NotificationToast";
import { confirmAction } from "./lib/dialogs";
import {
  getStoredCloseAction,
  getStoredClosePreferences,
  getStoredCloseSkipPrompt,
  setStoredClosePreferences,
  subscribeClosePreferencesChanged,
  type CloseAction
} from "./lib/closeBehavior";
import type {
  Conversation,
  ProjectEntry,
  SettingsTab
} from "./types";

type MainView = "chat" | "ops";

const SIDEBAR_COLLAPSED_KEY = "nano-agent-sidebar-collapsed";

function App() {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const runtimePanelRef = useRef<HTMLElement | null>(null);
  const runtimeToggleBtnRef = useRef<HTMLButtonElement | null>(null);

  const [notice, setNotice] = useState("");
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("theme");
  const [activeMainView, setActiveMainView] = useState<MainView>("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  });
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const chatRef = useRef<any>(null);

  const env = useEnv(setNotice);
  const mcp = useMcp(setNotice);
  const memory = useMemory(setNotice);
  const projects = useProjects(setNotice, () => chatRef.current?.conversations || []);
  const model = useModel(
    setNotice,
    () => chatRef.current?.activeConversationId || "",
    (updater: React.SetStateAction<Conversation[]>) => chatRef.current?.setConversations(updater),
    projects.setProjectConversations
  );
  const skills = useSkills(setNotice);

  const chat = useChat({
    setNotice,
    projects,
    model,
    skills,
    mcp,
    showModelConfig,
    activeSettingsTab
  });
  chatRef.current = chat;
  const {
    conversations,
    archivedConversations,
    previewArchivedId,
    previewMessages,
    activeConversationId,
    setActiveConversationId,
    messages,
    setMessages,
    messageReasoning,
    chatInput,
    ragFiles,
    isRagDragging,
    setIsRagDragging,
    indexingRagFileName,
    promptSuggestions,
    selectedPromptIndex,
    busy,
    uploadingImageAttachment,
    pendingImageAttachments,
    removePendingImageAttachment,
    attachmentProjectPath,
    executingToolMessageId,
    messageToolCalls,
    activeConversation,
    handleNewConversation,
    handleNewProjectConversation,
    handleRenameConversation,
    handleContextArchiveConversation,
    handleContextDeleteConversation,
    handleSendMessage,
    handleExecuteTool,
    handleRejectTool,
    handleCloseConversation,
    handleRagFiles,
    handleImageFiles,
    handleDeleteRagFile,
    handleInputChange,
    handleChatInputKeyDown,
    handleChatInputPaste,
    insertPrompt,
    loadArchivedPreview
  } = chat;

  const obs = useObservability(setNotice, activeConversationId, showModelConfig, activeSettingsTab);
  const workspace = useWorkspace(setNotice, memory);
  const [workspaceListRatio, setWorkspaceListRatio] = useState(38);
  const { themeMode, setThemeMode } = useThemeMode();
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closeAction, setCloseAction] = useState<CloseAction>(() => {
    return getStoredCloseAction();
  });
  const [closeDontAsk, setCloseDontAsk] = useState(() => {
    return getStoredCloseSkipPrompt();
  });
  const closePromptOpenRef = useRef(false);

  const performCloseAction = useCallback(async (action: CloseAction) => {
    try {
      if (action === "tray") {
        await minimizeToTray();
        return;
      }
      await quitApp();
    } catch (error) {
      setNotice(String(error));
    }
  }, []);

  useEffect(() => {
    closePromptOpenRef.current = closePromptOpen;
  }, [closePromptOpen]);

  useEffect(() => {
    return subscribeClosePreferencesChanged((preferences) => {
      setCloseAction(preferences.action);
      setCloseDontAsk(preferences.skipPrompt);
    });
  }, []);

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
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlistenClose: (() => void) | undefined;
    let unlistenTrayShow: (() => void) | undefined;

    void appWindow.onCloseRequested((event) => {
      event.preventDefault();
      if (closePromptOpenRef.current) {
        return;
      }

      const savedPreferences = getStoredClosePreferences();
      if (savedPreferences.skipPrompt) {
        void performCloseAction(savedPreferences.action);
        return;
      }

      setCloseAction(savedPreferences.action);
      setCloseDontAsk(savedPreferences.skipPrompt);
      setClosePromptOpen(true);
    }).then((unlisten) => {
      unlistenClose = unlisten;
    });

    void appWindow.listen("nano-agent-show-window", () => {
      void showAppWindow();
    }).then((unlisten) => {
      unlistenTrayShow = unlisten;
    });

    return () => {
      unlistenClose?.();
      unlistenTrayShow?.();
    };
  }, [performCloseAction]);

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

  async function loadAll() {
    try {
      await chat.refreshConversations();
      void memory.refreshMemories("");
    } catch (error) {
      setNotice(String(error));
    }
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
    if (!(await confirmAction(`确定要删除会话「${conversation.title}」吗？`))) {
      return;
    }

    try {
      await deleteConversation(conversation.id);
      chat.setArchivedConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (chat.activeConversationId === conversation.id) {
        chat.setActiveConversationId("");
        chat.setMessages([]);
      }
      if (chat.previewArchivedId === conversation.id) {
        chat.setPreviewArchivedId("");
        chat.setPreviewMessages([]);
      }
      await Promise.all([
        chat.refreshConversations(),
        projects.refreshProjectConversationMap()
      ]);
      setNotice("会话已删除。");
    } catch (error) {
      console.error(error);
      setNotice(`删除归档会话失败：${String(error)}`);
    }
  }

  async function handleRestoreConversation(conversation: Conversation) {
    await archiveConversation(conversation.id, false);
    await chat.refreshConversations(conversation.id);
    setShowModelConfig(false);
    await chat.loadMessages(conversation.id);
  }

  function handleCancelClosePrompt() {
    setClosePromptOpen(false);
  }

  function handleConfirmClosePrompt() {
    setStoredClosePreferences({ action: closeAction, skipPrompt: closeDontAsk });
    setClosePromptOpen(false);
    void performCloseAction(closeAction);
  }

  function openRenameDialog(conversation: Conversation) {
    setRenameTarget(conversation);
    setRenameTitle(conversation.title);
  }

  function closeRenameDialog() {
    setRenameTarget(null);
    setRenameTitle("");
  }

  async function handleConfirmRename() {
    if (!renameTarget) {
      return;
    }
    const trimmed = renameTitle.trim();
    if (!trimmed) {
      setNotice("会话名称不能为空");
      return;
    }
    await handleRenameConversation(renameTarget.id, trimmed);
    closeRenameDialog();
  }



  return (
    <main
      className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}
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
      <Sidebar
        projects={projects}
        conversations={conversations}
        activeConversationId={activeConversationId}
        setActiveConversationId={setActiveConversationId}
        handleNewConversation={handleNewConversation}
        handleNewProjectConversation={handleNewProjectConversation}
        handleContextMenu={handleContextMenu}
        handleProjectContextMenu={handleProjectContextMenu}
        onOpenSettings={() => model.handleOpenModelConfig(setShowModelConfig)}
        activeMainView={activeMainView}
        onMainViewChange={setActiveMainView}
        isCollapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />

      {projects.showNewProjectDialog && (
        <div className="modal-backdrop" onClick={() => projects.setShowNewProjectDialog(false)}>
          <section className="project-dialog modal-shell modal-shell--create" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <FolderPlus size={18} />
                <strong>新建项目</strong>
              </div>
              <button className="modal-close-btn" onClick={() => projects.setShowNewProjectDialog(false)} aria-label="关闭" title="关闭">
                <X size={16} />
              </button>
            </header>
            <label>
              <span>工作目录</span>
              <div className="project-path-picker">
                <input value={projects.newProjectWorkdir} readOnly placeholder="选择真实工作目录" />
                <button type="button" onClick={() => void projects.handleSelectNewProjectWorkdir()}>
                  选择
                </button>
              </div>
            </label>
            <label>
              <span>项目名称</span>
              <input
                value={projects.newProjectName}
                onChange={(event) => projects.setNewProjectName(event.target.value)}
                placeholder="逻辑名称，例如：官网改版"
                autoFocus
              />
            </label>
            <footer>
              <button className="modal-action-btn modal-action-btn--secondary" type="button" onClick={() => projects.setShowNewProjectDialog(false)}>
                取消
              </button>
              <button className="modal-action-btn modal-action-btn--create" type="button" onClick={() => void projects.handleCreateProject()}>
                <FolderPlus size={15} />
                添加并打开
              </button>
            </footer>
          </section>
        </div>
      )}

      {projects.pendingProjectRemoval && (
        <div className="modal-backdrop" onClick={() => projects.setPendingProjectRemoval(null)}>
          <section className="project-dialog modal-shell modal-shell--remove danger-approval" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <Trash2 size={18} />
                <strong>移除项目入口</strong>
              </div>
              <button className="modal-close-btn" onClick={() => projects.setPendingProjectRemoval(null)} aria-label="关闭" title="关闭">
                <X size={16} />
              </button>
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
              <button className="modal-action-btn modal-action-btn--secondary" type="button" onClick={() => projects.setPendingProjectRemoval(null)}>
                取消
              </button>
              <button
                className="modal-action-btn modal-action-btn--remove"
                type="button"
                onClick={projects.handleConfirmRemoveProject}
                disabled={projects.projectApprovalText.trim() !== projects.pendingProjectRemoval.name}
              >
                <Trash2 size={15} />
                批准移除
              </button>
            </footer>
          </section>
        </div>
      )}

      {renameTarget && (
        <div className="modal-backdrop" onClick={closeRenameDialog}>
          <section
            className="project-dialog modal-shell modal-shell--edit rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <Edit3 size={18} />
                <strong id="rename-dialog-title">重命名会话</strong>
              </div>
              <button className="modal-close-btn" onClick={closeRenameDialog} aria-label="关闭" title="关闭" type="button">
                <X size={16} />
              </button>
            </header>
            <label>
              <span>会话名称</span>
              <input
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleConfirmRename();
                  }
                  if (event.key === "Escape") {
                    closeRenameDialog();
                  }
                }}
                autoFocus
              />
            </label>
            <footer>
              <button className="modal-action-btn modal-action-btn--secondary" type="button" onClick={closeRenameDialog}>
                取消
              </button>
              <button className="modal-action-btn modal-action-btn--edit" type="button" onClick={() => void handleConfirmRename()}>
                <Edit3 size={15} />
                保存修改
              </button>
            </footer>
          </section>
        </div>
      )}

      {closePromptOpen && (
        <div className="modal-backdrop close-choice-backdrop" onClick={handleCancelClosePrompt}>
          <section
            className="close-choice-dialog modal-shell modal-shell--close-action"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-choice-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <Power size={18} />
                <strong id="close-choice-title">点击关闭按钮</strong>
              </div>
              <button className="modal-close-btn" type="button" aria-label="关闭" title="关闭" onClick={handleCancelClosePrompt}>
                <X size={16} />
              </button>
            </header>
            <div className="close-choice-options" role="radiogroup" aria-label="关闭按钮行为">
              <label className="close-choice-option">
                <input
                  type="radio"
                  name="close-action"
                  checked={closeAction === "tray"}
                  onChange={() => setCloseAction("tray")}
                />
                <span>最小化到系统托盘</span>
              </label>
              <label className="close-choice-option">
                <input
                  type="radio"
                  name="close-action"
                  checked={closeAction === "quit"}
                  onChange={() => setCloseAction("quit")}
                />
                <span>退出应用</span>
              </label>
            </div>
            <label className="close-choice-checkbox">
              <input
                type="checkbox"
                checked={closeDontAsk}
                onChange={(event) => setCloseDontAsk(event.target.checked)}
              />
              <span>不再提示</span>
            </label>
            <footer>
              <button className="modal-action-btn modal-action-btn--secondary" type="button" onClick={handleCancelClosePrompt}>
                取消
              </button>
              <button className="modal-action-btn modal-action-btn--close-action" type="button" onClick={handleConfirmClosePrompt}>
                <Power size={15} />
                确定
              </button>
            </footer>
          </section>
        </div>
      )}

      <SettingsModal
        showModelConfig={showModelConfig}
        setShowModelConfig={setShowModelConfig}
        activeSettingsTab={activeSettingsTab}
        setActiveSettingsTab={setActiveSettingsTab}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        workspace={workspace}
        memory={memory}
        workspaceRef={workspaceRef}
        model={model}
        skills={skills}
        mcp={mcp}
        env={env}
        obs={obs}
        archivedConversations={archivedConversations}
        previewArchivedId={previewArchivedId}
        previewMessages={previewMessages}
        loadArchivedPreview={loadArchivedPreview}
        handleRestoreConversation={handleRestoreConversation}
        handleDeleteArchivedConversation={handleDeleteArchivedConversation}
      />

      {activeMainView === "ops" ? (
        <OpsPanel setNotice={setNotice} />
      ) : (
        <ChatPane
          activeConversationId={activeConversationId}
          activeConversation={activeConversation}
          messages={messages}
          messageReasoning={messageReasoning}
          chatInput={chatInput}
          ragFiles={ragFiles}
          indexingRagFileName={indexingRagFileName}
          promptSuggestions={promptSuggestions}
          selectedPromptIndex={selectedPromptIndex}
          busy={busy}
          uploadingImageAttachment={uploadingImageAttachment}
          pendingImageAttachments={pendingImageAttachments}
          isRagDragging={isRagDragging}
          executingToolMessageId={executingToolMessageId}
          messageToolCalls={messageToolCalls}
          attachmentProjectPath={attachmentProjectPath}
          obs={obs}
          model={model}
          handleSendMessage={handleSendMessage}
          handleNewConversation={handleNewConversation}
          handleCloseConversation={handleCloseConversation}
          handleExecuteTool={handleExecuteTool}
          handleRejectTool={handleRejectTool}
          handleInputChange={handleInputChange}
          handleChatInputKeyDown={handleChatInputKeyDown}
          handleChatInputPaste={handleChatInputPaste}
          handleImageFiles={handleImageFiles}
          removePendingImageAttachment={removePendingImageAttachment}
          insertPrompt={insertPrompt}
          handleDeleteRagFile={handleDeleteRagFile}
          setNotice={setNotice}
        />
      )}

      {env.showEnvPrompt && (
        <div className="modal-backdrop env-setup-backdrop">
          <div className="env-setup-modal modal-shell modal-shell--setup">
            <header>
              <div>
                <Cpu size={18} />
                <strong>初始化环境配置</strong>
              </div>
            </header>
            <p>
              运行智能技能（Skills）依赖 <strong>Node.js</strong> 和 <strong>Python</strong> 环境。检测到您的系统当前缺少所需环境。
            </p>

            <div className="env-status-list">
              <div className="env-status-row">
                <span>Node.js 环境:</span>
                <span className={env.envStatus.node ? "env-status-pill ready" : "env-status-pill missing"}>
                  {env.envStatus.node ? "已就绪" : "未检测到"}
                </span>
              </div>
              <div className="env-status-row">
                <span>Python 环境:</span>
                <span className={env.envStatus.python ? "env-status-pill ready" : "env-status-pill missing"}>
                  {env.envStatus.python ? "已就绪" : "未检测到"}
                </span>
              </div>
            </div>

            <div className="env-path-fields">
              <h4>配置已有路径（若已安装）：</h4>
              <div className="skills-param-field env-field-no-margin">
                <label>Node.js 可执行文件路径:</label>
                <input
                  value={env.nodePath}
                  onChange={(e) => env.setNodePath(e.target.value)}
                  placeholder="例如: C:\Program Files\nodejs\node.exe 或直接输入 node"
                />
              </div>
              <div className="skills-param-field env-field-no-margin">
                <label>Python 可执行文件路径:</label>
                <input
                  value={env.pythonPath}
                  onChange={(e) => env.setPythonPath(e.target.value)}
                  placeholder="例如: C:\Users\...\python.exe 或直接输入 python"
                />
              </div>
            </div>

            {env.isInstallingEnv && (
              <div className="env-install-progress">
                {env.envInstallProgress}
              </div>
            )}

            <footer>
              <button
                className="modal-action-btn modal-action-btn--secondary"
                onClick={env.dismissEnvPrompt}
                disabled={env.isInstallingEnv || env.isCheckingEnv}
                type="button"
              >
                稍后提醒
              </button>
              <button
                className="modal-action-btn modal-action-btn--edit"
                onClick={env.handleSaveCustomPaths}
                disabled={env.isInstallingEnv || env.isCheckingEnv}
                type="button"
              >
                保存已有路径
              </button>
              <button
                className="modal-action-btn modal-action-btn--create"
                onClick={env.handleAutoInstallMissing}
                disabled={env.isInstallingEnv || env.isCheckingEnv}
                type="button"
              >
                {env.isInstallingEnv ? "正在配置..." : "自动配置 (winget)"}
              </button>
            </footer>
          </div>
        </div>
      )}

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
                    openRenameDialog(projects.contextMenu.conversation);
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
                  const conversation = projects.contextMenu.conversation;
                  projects.setContextMenu((prev) => ({ ...prev, visible: false }));
                  if (conversation) {
                    void handleContextArchiveConversation(conversation);
                  }
                }}
                type="button"
              >
                <Archive size={14} />
                <span>归档会话</span>
              </button>
              <button
                className="custom-context-menu-item danger-action"
                onClick={() => {
                  const conversation = projects.contextMenu.conversation;
                  projects.setContextMenu((prev) => ({ ...prev, visible: false }));
                  if (conversation) {
                    void handleContextDeleteConversation(conversation);
                  }
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
      <ConfirmDialogHost />
      {notice && (
        <NotificationToast notice={notice} onClose={() => setNotice("")} />
      )}
    </main>
  );
}

export default App;
