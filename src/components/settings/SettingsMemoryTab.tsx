import { useCallback, useEffect, useState } from "react";
import { Fingerprint, RefreshCw } from "lucide-react";
import WorkspaceGrid from "../WorkspaceGrid";
import { getUserProfile } from "../../api";
import type { UseWorkspaceReturn } from "../../hooks/useWorkspace";
import type { UseMemoryReturn } from "../../hooks/useMemory";
import type { UserProfile } from "../../types";

interface SettingsMemoryTabProps {
  workspace: UseWorkspaceReturn;
  memory: UseMemoryReturn;
  workspaceRef: React.Ref<HTMLElement>;
}

export default function SettingsMemoryTab({ workspace, memory, workspaceRef }: SettingsMemoryTabProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError("");
    try {
      setProfile(await getUserProfile());
    } catch (error) {
      setProfileError(String(error));
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, memory.memoryItems]);

  return (
    <div className="settings-tab-content">
      <h3>记忆库</h3>
      <p className="description">管理会进入对话上下文的记忆；同类自动偏好会更新旧值，关闭上下文使用不会删除记忆。</p>
      <section className="user-profile-card" aria-labelledby="user-profile-title">
        <header className="user-profile-header">
          <div className="user-profile-heading">
            <span className="user-profile-mark" aria-hidden="true"><Fingerprint size={20} /></span>
            <div>
              <h4 id="user-profile-title">用户画像</h4>
              <p>由启用的个性化记忆聚合，所有事实均可追溯到原始记忆。</p>
            </div>
          </div>
          <button
            className="user-profile-refresh"
            type="button"
            onClick={() => void loadProfile()}
            disabled={profileLoading}
            aria-label="刷新用户画像"
            title="刷新用户画像"
          >
            <RefreshCw size={15} className={profileLoading ? "svg-spin" : undefined} />
          </button>
        </header>

        {profileError ? (
          <p className="user-profile-state user-profile-state--error">画像读取失败：{profileError}</p>
        ) : profile?.facts.length ? (
          <>
            <div className="user-profile-stats" aria-label="画像统计">
              <span><strong>{profile.global_preference_count}</strong> 项全局偏好</span>
              <span><strong>{profile.profile_fact_count}</strong> 项身份与工作画像</span>
              <span><strong>{profile.facts.length}</strong> 项有效事实</span>
            </div>
            <div className="user-profile-facts">
              {profile.facts.slice(0, 8).map((fact) => (
                <article
                  className={`user-profile-fact${fact.global ? " user-profile-fact--global" : ""}`}
                  key={fact.source_memory_id}
                  title={`来源记忆：${fact.source_memory_id}`}
                >
                  <div className="user-profile-fact-meta">
                    <span>{fact.label}</span>
                    {fact.global && <em>全局生效</em>}
                  </div>
                  <p>{fact.value}</p>
                </article>
              ))}
            </div>
            {profile.facts.length > 8 && (
              <p className="user-profile-more">其余 {profile.facts.length - 8} 项可在下方记忆列表中查看和编辑。</p>
            )}
          </>
        ) : (
          <p className="user-profile-state">
            {profileLoading ? "正在生成画像…" : "尚未形成画像。可在对话中说明你的偏好、角色、常用技术或长期项目。"}
          </p>
        )}
      </section>
      <div className="memory-data-flow-notice" role="note">
        语义索引会把启用记忆的标题、标签和正文，以及检索问题，发送到“嵌入模型”中配置的服务。
        向量仅保存在本机 SQLite；服务不可用时自动使用全文检索和知识图谱召回。
      </div>
      <WorkspaceGrid workspace={workspace} memory={memory} workspaceRef={workspaceRef} />
    </div>
  );
}
