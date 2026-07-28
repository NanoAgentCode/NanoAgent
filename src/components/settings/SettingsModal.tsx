import {
  Activity, Archive, Bot, Brain, Cpu, Monitor, Settings, Sparkles, Sun
} from "lucide-react";
import { Group, Modal, NavLink, Text, ThemeIcon } from "@mantine/core";
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
  return (
    <Modal
      opened={showModelConfig}
      onClose={() => setShowModelConfig(false)}
      size="920px"
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="nanoBlue" size="md">
            <Settings size={16} />
          </ThemeIcon>
          <Text fw={650}>系统设置</Text>
        </Group>
      }
      classNames={{
        content: "settings-modal-shell",
        body: "settings-modal-body"
      }}
    >
        <div className="settings-modal-layout">
          <aside className="settings-sidebar">
            <NavLink
              active={activeSettingsTab === "theme"}
              label="通用设置"
              leftSection={<Sun size={16} />}
              onClick={() => setActiveSettingsTab("theme")}
            />
            <NavLink
              active={activeSettingsTab === "memory"}
              label="记忆库"
              leftSection={<Brain size={16} />}
              onClick={() => { setActiveSettingsTab("memory"); workspace.handleKindChange("memory"); }}
            />
            <NavLink
              active={activeSettingsTab === "model"}
              label="LLM 管理"
              leftSection={<Bot size={16} />}
              onClick={() => setActiveSettingsTab("model")}
            />
            <NavLink
              active={activeSettingsTab === "embedding"}
              label="嵌入模型"
              leftSection={<Cpu size={16} />}
              onClick={() => { setActiveSettingsTab("embedding"); model.handleOpenEmbeddingConfig(); }}
            />
            <NavLink
              active={activeSettingsTab === "archive"}
              label="归档列表"
              leftSection={<Archive size={16} />}
              onClick={() => setActiveSettingsTab("archive")}
            />
            <NavLink
              active={activeSettingsTab === "observability"}
              label="链路追踪"
              leftSection={<Activity size={16} />}
              onClick={() => setActiveSettingsTab("observability")}
            />
            <NavLink
              active={activeSettingsTab === "skills"}
              label="Skills 管理"
              leftSection={<Sparkles size={16} />}
              onClick={() => setActiveSettingsTab("skills")}
            />
            <NavLink
              active={activeSettingsTab === "mcp"}
              label="MCP 配置"
              leftSection={<Monitor size={16} />}
              onClick={() => setActiveSettingsTab("mcp")}
            />
            <NavLink
              active={activeSettingsTab === "environment"}
              label="环境依赖"
              leftSection={<Settings size={16} />}
              onClick={() => setActiveSettingsTab("environment")}
            />
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
    </Modal>
  );
}
