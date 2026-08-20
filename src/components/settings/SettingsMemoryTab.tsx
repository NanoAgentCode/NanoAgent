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
      <div className="memory-data-flow-notice" role="note">
        语义索引会把启用记忆的标题、标签和正文，以及检索问题，发送到“嵌入模型”中配置的服务。
        向量仅保存在本机 SQLite；服务不可用时自动使用全文检索和知识图谱召回。
      </div>
      <WorkspaceGrid workspace={workspace} memory={memory} workspaceRef={workspaceRef} />
    </div>
  );
}
