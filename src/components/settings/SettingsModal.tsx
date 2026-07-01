import {
  Activity, Archive, Bot, Brain, Cpu, Monitor, Settings, Sparkles, Sun, X
} from "lucide-react";
import SettingsThemeTab from "./SettingsThemeTab";
import SettingsMemoryTab from "./SettingsMemoryTab";
import SettingsArchiveTab from "./SettingsArchiveTab";
import SettingsModelTab from "./SettingsModelTab";
import SettingsEmbeddingTab from "./SettingsEmbeddingTab";
import SettingsSkillsTab from "./SettingsSkillsTab";
import SettingsObservabilityTab from "./SettingsObservabilityTab";
import SettingsMcpTab from "./SettingsMcpTab";
import SettingsEnvironmentTab from "./SettingsEnvironmentTab";
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
      <section className="modal-panel modal-shell modal-shell--settings" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <Settings size={18} />
            <strong>系统设置</strong>
          </div>
          <button className="modal-close-btn" onClick={() => setShowModelConfig(false)} aria-label="关闭" title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="settings-modal-layout">
          <aside className="settings-sidebar">
            <button
              className={activeSettingsTab === "theme" ? "settings-nav-item active" : "settings-nav-item"}
              onClick={() => setActiveSettingsTab("theme")}
            >
              <Sun size={16} />
              <span>通用设置</span>
            </button>
            <button
              className={activeSettingsTab === "memory" ? "settings-nav-item active" : "settings-nav-item"}
              onClick={() => { setActiveSettingsTab("memory"); workspace.handleKindChange("memory"); }}
            >
              <Brain size={16} />
              <span>记忆库</span>
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
              onClick={() => { setActiveSettingsTab("embedding"); model.handleOpenEmbeddingConfig(); }}
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
            {activeSettingsTab === "theme" && <SettingsThemeTab themeMode={themeMode} setThemeMode={setThemeMode} />}
            {activeSettingsTab === "memory" && <SettingsMemoryTab workspace={workspace} memory={memory} workspaceRef={workspaceRef as React.Ref<HTMLElement>} />}
            {activeSettingsTab === "archive" && (
              <SettingsArchiveTab
                archivedConversations={archivedConversations}
                previewArchivedId={previewArchivedId}
                previewMessages={previewMessages}
                tempDir={skills.tempDir}
                loadArchivedPreview={loadArchivedPreview}
                handleRestoreConversation={handleRestoreConversation}
                handleDeleteArchivedConversation={handleDeleteArchivedConversation}
              />
            )}
            {activeSettingsTab === "model" && <SettingsModelTab model={model} setShowModelConfig={setShowModelConfig} />}
            {activeSettingsTab === "embedding" && <SettingsEmbeddingTab model={model} />}
            {activeSettingsTab === "skills" && <SettingsSkillsTab skills={skills} />}
            {activeSettingsTab === "observability" && <SettingsObservabilityTab obs={obs} />}
            {activeSettingsTab === "mcp" && <SettingsMcpTab mcp={mcp} />}
            {activeSettingsTab === "environment" && <SettingsEnvironmentTab env={env} />}
          </div>
        </div>
      </section>
    </div>
  );
}
