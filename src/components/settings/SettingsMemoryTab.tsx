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
      <h3>记忆库</h3>
      <p className="description">管理会进入对话上下文的记忆；关闭上下文使用不会删除记忆。</p>
      <WorkspaceGrid workspace={workspace} memory={memory} workspaceRef={workspaceRef} />
    </div>
  );
}
