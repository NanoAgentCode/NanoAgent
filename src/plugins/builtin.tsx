import { lazy } from "react";
import { Activity, Archive, Bot, Brain, Cpu, Monitor, Server, Settings, Sparkles, Sun } from "lucide-react";
import { AppPluginRegistry, type FrontendPlugin } from "../core/plugins";

const OpsPanel = lazy(() => import("../components/OpsPanel"));
const SettingsThemeTab = lazy(() => import("../components/settings/SettingsThemeTab"));
const SettingsMemoryTab = lazy(() => import("../components/settings/SettingsMemoryTab"));
const SettingsArchiveTab = lazy(() => import("../components/settings/SettingsArchiveTab"));
const SettingsModelTab = lazy(() => import("../components/settings/SettingsModelTab"));
const SettingsEmbeddingTab = lazy(() => import("../components/settings/SettingsEmbeddingTab"));
const SettingsSkillsTab = lazy(() => import("../components/settings/SettingsSkillsTab"));
const SettingsObservabilityTab = lazy(() => import("../components/settings/SettingsObservabilityTab"));
const SettingsMcpTab = lazy(() => import("../components/settings/SettingsMcpTab"));
const SettingsEnvironmentTab = lazy(() => import("../components/settings/SettingsEnvironmentTab"));

const coreUiPlugin: FrontendPlugin = {
  manifest: {
    id: "nanoagent.core-ui",
    name: "Core UI",
    version: "0.1.0",
    capabilities: ["settings"]
  },
  settings: [
    {
      id: "theme",
      label: "通用设置",
      icon: Sun,
      render: ({ themeMode, setThemeMode }) => <SettingsThemeTab themeMode={themeMode} setThemeMode={setThemeMode} />
    },
    {
      id: "memory",
      label: "记忆库",
      icon: Brain,
      onActivate: ({ workspace }) => workspace.handleKindChange("memory"),
      render: ({ workspace, memory, workspaceRef }) => (
        <SettingsMemoryTab workspace={workspace} memory={memory} workspaceRef={workspaceRef as React.Ref<HTMLElement>} />
      )
    },
    {
      id: "model",
      label: "LLM 管理",
      icon: Bot,
      render: ({ model, close }) => <SettingsModelTab model={model} setShowModelConfig={(show) => !show && close()} />
    },
    {
      id: "embedding",
      label: "嵌入模型",
      icon: Cpu,
      onActivate: ({ model }) => model.handleOpenEmbeddingConfig(),
      render: ({ model }) => <SettingsEmbeddingTab model={model} />
    },
    {
      id: "archive",
      label: "归档列表",
      icon: Archive,
      render: (context) => (
        <SettingsArchiveTab
          archivedConversations={context.archivedConversations}
          previewArchivedId={context.previewArchivedId}
          previewMessages={context.previewMessages}
          tempDir={context.skills.tempDir}
          loadArchivedPreview={context.loadArchivedPreview}
          handleRestoreConversation={context.handleRestoreConversation}
          handleDeleteArchivedConversation={context.handleDeleteArchivedConversation}
        />
      )
    },
    {
      id: "observability",
      label: "链路追踪",
      icon: Activity,
      render: ({ obs }) => <SettingsObservabilityTab obs={obs} />
    }
  ]
};

const skillsPlugin: FrontendPlugin = {
  manifest: {
    id: "nanoagent.skills",
    name: "Skills",
    version: "0.1.0",
    capabilities: ["settings"]
  },
  settings: [{
    id: "skills",
    label: "Skills 管理",
    icon: Sparkles,
    render: ({ skills }) => <SettingsSkillsTab skills={skills} />
  }]
};

const mcpPlugin: FrontendPlugin = {
  manifest: {
    id: "nanoagent.mcp",
    name: "MCP",
    version: "0.1.0",
    capabilities: ["settings"]
  },
  settings: [{
    id: "mcp",
    label: "MCP 配置",
    icon: Monitor,
    render: ({ mcp }) => <SettingsMcpTab mcp={mcp} />
  }]
};

const environmentPlugin: FrontendPlugin = {
  manifest: {
    id: "nanoagent.environment",
    name: "Environment",
    version: "0.1.0",
    capabilities: ["settings"]
  },
  settings: [{
    id: "environment",
    label: "环境依赖",
    icon: Settings,
    render: ({ env }) => <SettingsEnvironmentTab env={env} />
  }]
};

const opsPlugin: FrontendPlugin = {
  manifest: {
    id: "nanoagent.ops",
    name: "Server Operations",
    version: "0.1.0",
    capabilities: ["main-view"]
  },
  mainViews: [{
    id: "ops",
    label: "服务器管理",
    icon: Server,
    component: OpsPanel
  }]
};

export const appPlugins = new AppPluginRegistry([
  coreUiPlugin,
  skillsPlugin,
  mcpPlugin,
  environmentPlugin,
  opsPlugin
]);
