import { ChevronDown, ChevronRight, Folder, MessageSquare, Plus, Server, Settings } from "lucide-react";
import type { Conversation, ProjectEntry } from "../types";
import type { UseProjectsReturn } from "../hooks/useProjects";

interface SidebarProps {
  projects: UseProjectsReturn;
  conversations: Conversation[];
  activeConversationId: string;
  setActiveConversationId: (id: string) => void;
  handleNewConversation: () => Promise<void>;
  handleNewProjectConversation: (project: ProjectEntry) => Promise<void>;
  handleContextMenu: (e: React.MouseEvent, conversation: Conversation) => void;
  handleProjectContextMenu: (e: React.MouseEvent, project: ProjectEntry) => void;
  onOpenSettings: () => void;
  activeMainView: "chat" | "ops";
  onMainViewChange: (view: "chat" | "ops") => void;
}

export default function Sidebar({
  projects,
  conversations,
  activeConversationId,
  setActiveConversationId,
  handleNewConversation,
  handleNewProjectConversation,
  handleContextMenu,
  handleProjectContextMenu,
  onOpenSettings,
  activeMainView,
  onMainViewChange
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <p className="sidebar-slogan">本地优先，智能协作</p>

      <div className="sidebar-section projects">
        <div className="sidebar-section-header">
          <div
            className="sidebar-section-toggle"
            onClick={() => projects.setProjectsSectionExpanded(!projects.projectsSectionExpanded)}
          >
            {projects.projectsSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <Folder size={16} />
            <span>项目区</span>
          </div>
          <div className="sidebar-section-actions">
            <button className="new-chat-btn" onClick={() => projects.setShowNewProjectDialog(true)} title="新建项目" type="button">
              <Plus size={16} />
            </button>
            <button className="new-chat-btn" onClick={() => void projects.handleOpenProject()} title="打开已有项目" type="button">
              <Folder size={16} />
            </button>
          </div>
        </div>
        {projects.projectsSectionExpanded && (
          <div className="sidebar-project-list">
            {projects.projects.map((project) => {
              const isActiveProject = project.id === projects.activeProjectId;
              const isExpanded = projects.expandedProjectIds.includes(project.id);
              const projectChats = projects.projectConversations[project.id] || [];
              const hasNoChats = projectChats.length === 0;
              const tooltipText = hasNoChats ? "暂无项目会话" : project.path;

              return (
                <div key={project.id} className="sidebar-project-group">
                  <div
                    className={isActiveProject ? "sidebar-project-item active" : "sidebar-project-item"}
                    role="button"
                    tabIndex={0}
                    onClick={() => projects.selectProject(project)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        projects.selectProject(project);
                      }
                    }}
                    onContextMenu={(e) => handleProjectContextMenu(e, project)}
                    title={tooltipText}
                  >
                    <button
                      className="project-expand-btn"
                      type="button"
                      aria-label={isExpanded ? "收起项目详情" : "展开项目详情"}
                      title={isExpanded ? "收起项目详情" : "展开项目详情"}
                      onClick={(event) => {
                        event.stopPropagation();
                        projects.toggleProjectExpanded(project.id);
                      }}
                      style={{ visibility: hasNoChats ? "hidden" : "visible" }}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <span className="sidebar-project-dot" />
                    <span className="project-title" title={tooltipText}>{project.name}</span>
                    <button
                      className="project-add-chat-btn"
                      type="button"
                      aria-label="新建项目会话"
                      title="新建项目会话"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleNewProjectConversation(project);
                        onMainViewChange("chat");
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  {isExpanded && !hasNoChats && (
                    <div className="project-detail">
                      <div className="project-chat-list">
                        {projectChats.map((conversation) => (
                          <button
                            key={conversation.id}
                            className={activeMainView === "chat" && conversation.id === activeConversationId ? "sidebar-chat-item active" : "sidebar-chat-item"}
                            onClick={() => {
                              onMainViewChange("chat");
                              projects.selectProject(project);
                              setActiveConversationId(conversation.id);
                            }}
                            onContextMenu={(e) => handleContextMenu(e, conversation)}
                            type="button"
                          >
                            <MessageSquare size={14} className="chat-icon" />
                            <span className="chat-title">{conversation.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {projects.projects.length === 0 && (
              <div className="empty project-empty">打开或新建一个项目</div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-section chats">
        <div className="sidebar-section-header">
          <div
            className="sidebar-section-toggle"
            onClick={() => projects.setChatsSectionExpanded(!projects.chatsSectionExpanded)}
          >
            {projects.chatsSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <MessageSquare size={16} />
            <span>对话区</span>
          </div>
          <button className="new-chat-btn" onClick={() => {
            onMainViewChange("chat");
            void handleNewConversation();
          }} title="新建对话" type="button">
            <Plus size={16} />
          </button>
        </div>
        {projects.chatsSectionExpanded && (
          <div className="sidebar-chat-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={activeMainView === "chat" && conversation.id === activeConversationId ? "sidebar-chat-item active" : "sidebar-chat-item"}
                onClick={() => {
                  onMainViewChange("chat");
                  setActiveConversationId(conversation.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, conversation)}
                type="button"
              >
                <MessageSquare size={14} className="chat-icon" />
                <span className="chat-title">{conversation.title}</span>
              </button>
            ))}
            {conversations.length === 0 && <div className="empty">暂无对话</div>}
          </div>
        )}
      </div>

      <div className="sidebar-bottom-actions">
        <button
          className={activeMainView === "ops" ? "sidebar-bottom-item active" : "sidebar-bottom-item"}
          onClick={() => onMainViewChange("ops")}
          type="button"
        >
          <Server size={18} />
          <span>服务器管理</span>
        </button>
        <button className="sidebar-bottom-item settings-entry" onClick={onOpenSettings} type="button">
          <Settings size={18} />
          <span>系统设置</span>
        </button>
      </div>
    </aside>
  );
}
