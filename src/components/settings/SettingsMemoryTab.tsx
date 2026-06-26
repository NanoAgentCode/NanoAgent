import WorkspaceGrid from "../WorkspaceGrid";
import type { UseWorkspaceReturn } from "../../hooks/useWorkspace";
import type { UseMemoryReturn } from "../../hooks/useMemory";

interface SettingsMemoryTabProps {
  workspace: UseWorkspaceReturn;
  memory: UseMemoryReturn;
  workspaceRef: React.Ref<HTMLElement>;
}

export default function SettingsMemoryTab({ workspace, memory, workspaceRef }: SettingsMemoryTabProps) {
  return (
    <div className="settings-tab-content">
      <h3>记忆系统</h3>
      <p className="description">配置AI的长期记忆偏好与项目上下文，提高回答精准度。</p>
      <WorkspaceGrid workspace={workspace} memory={memory} workspaceRef={workspaceRef} />
    </div>
  );
}
