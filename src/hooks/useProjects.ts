import { useEffect, useState, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createProjectDirectory, listConversations } from "../api";
import type { ProjectEntry, Conversation } from "../types";

const projectStorageKey = "nano-agent-projects";
const activeProjectStorageKey = "nano-agent-active-project-id";

function projectNameFromPath(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized || "未命名项目";
}

function loadSavedProjects() {
  const saved = localStorage.getItem(projectStorageKey);
  if (saved) {
    try {
      return JSON.parse(saved) as ProjectEntry[];
    } catch (e) {
      console.error("Failed to parse projects from localStorage", e);
    }
  }
  return [];
}

function saveProjects(projects: ProjectEntry[], activeProjectId: string) {
  localStorage.setItem(projectStorageKey, JSON.stringify(projects));
  if (activeProjectId) {
    localStorage.setItem(activeProjectStorageKey, activeProjectId);
  } else {
    localStorage.removeItem(activeProjectStorageKey);
  }
}

export interface UseProjectsReturn {
  projects: ProjectEntry[];
  setProjects: React.Dispatch<React.SetStateAction<ProjectEntry[]>>;
  activeProjectId: string;
  setActiveProjectId: React.Dispatch<React.SetStateAction<string>>;
  expandedProjectIds: string[];
  setExpandedProjectIds: React.Dispatch<React.SetStateAction<string[]>>;
  projectsSectionExpanded: boolean;
  setProjectsSectionExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  chatsSectionExpanded: boolean;
  setChatsSectionExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  projectConversations: Record<string, Conversation[]>;
  setProjectConversations: React.Dispatch<React.SetStateAction<Record<string, Conversation[]>>>;
  showNewProjectDialog: boolean;
  setShowNewProjectDialog: React.Dispatch<React.SetStateAction<boolean>>;
  newProjectParent: string;
  setNewProjectParent: React.Dispatch<React.SetStateAction<string>>;
  newProjectName: string;
  setNewProjectName: React.Dispatch<React.SetStateAction<string>>;
  pendingProjectRemoval: ProjectEntry | null;
  setPendingProjectRemoval: React.Dispatch<React.SetStateAction<ProjectEntry | null>>;
  projectApprovalText: string;
  setProjectApprovalText: React.Dispatch<React.SetStateAction<string>>;
  contextMenu: {
    x: number;
    y: number;
    visible: boolean;
    conversation: Conversation | null;
    project: ProjectEntry | null;
  };
  setContextMenu: React.Dispatch<React.SetStateAction<{
    x: number;
    y: number;
    visible: boolean;
    conversation: Conversation | null;
    project: ProjectEntry | null;
  }>>;
  activeProject: ProjectEntry | null;
  selectProject: (project: ProjectEntry) => void;
  upsertProject: (path: string) => void;
  handleOpenProject: () => Promise<void>;
  handleSelectNewProjectParent: () => Promise<void>;
  handleCreateProject: () => Promise<void>;
  handleRemoveProjectApproval: (project: ProjectEntry) => void;
  handleConfirmRemoveProject: () => void;
  toggleProjectExpanded: (projectId: string) => void;
  refreshProjectConversationMap: (projectList?: ProjectEntry[]) => Promise<void>;
  findConversationById: (conversationId: string) => Conversation | null;
  findConversationProject: (conversation: Conversation | null) => ProjectEntry | null;
  resolveConversationProject: (conversationId: string, projectHint?: ProjectEntry | null) => ProjectEntry | null;
}

export function useProjects(
  setNotice: (message: string) => void,
  conversations: Conversation[]
): UseProjectsReturn {
  const [projects, setProjects] = useState<ProjectEntry[]>(() => loadSavedProjects());
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem(activeProjectStorageKey) || "");
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() => {
    const activeId = localStorage.getItem(activeProjectStorageKey) || "";
    return activeId ? [activeId] : [];
  });
  const [projectsSectionExpanded, setProjectsSectionExpanded] = useState(true);
  const [chatsSectionExpanded, setChatsSectionExpanded] = useState(true);
  const [projectConversations, setProjectConversations] = useState<Record<string, Conversation[]>>({});
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectParent, setNewProjectParent] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingProjectRemoval, setPendingProjectRemoval] = useState<ProjectEntry | null>(null);
  const [projectApprovalText, setProjectApprovalText] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
    conversation: Conversation | null;
    project: ProjectEntry | null;
  }>({ x: 0, y: 0, visible: false, conversation: null, project: null });

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects]
  );

  useEffect(() => {
    if (projects.length === 0) {
      if (activeProjectId) {
        setActiveProjectId("");
        localStorage.removeItem(activeProjectStorageKey);
      }
      return;
    }

    if (!projects.some((project) => project.id === activeProjectId)) {
      const nextActiveProjectId = projects[0].id;
      setActiveProjectId(nextActiveProjectId);
      localStorage.setItem(activeProjectStorageKey, nextActiveProjectId);
    }
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjectIds((current) =>
        current.includes(activeProjectId) ? current : [...current, activeProjectId]
      );
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refreshProjectConversationMap(projects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  function selectProject(project: ProjectEntry) {
    setActiveProjectId(project.id);
    saveProjects(projects, project.id);
    setExpandedProjectIds((current) => (current.includes(project.id) ? current : [...current, project.id]));
  }

  function upsertProject(path: string) {
    const normalizedPath = path.trim().replace(/[\\/]+$/, "");
    if (!normalizedPath) return;

    const now = new Date().toISOString();
    const existing = projects.find(
      (project) => project.path.toLowerCase() === normalizedPath.toLowerCase()
    );
    const nextProject: ProjectEntry = existing
      ? { ...existing, opened_at: now }
      : {
          id: normalizedPath,
          name: projectNameFromPath(normalizedPath),
          path: normalizedPath,
          opened_at: now
        };
    const nextProjects = [
      nextProject,
      ...projects.filter((project) => project.id !== nextProject.id)
    ];

    setProjects(nextProjects);
    setActiveProjectId(nextProject.id);
    setExpandedProjectIds((current) => (current.includes(nextProject.id) ? current : [...current, nextProject.id]));
    saveProjects(nextProjects, nextProject.id);
    setNotice(`已打开项目：${nextProject.name}`);
  }

  async function handleOpenProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "打开项目"
      });

      if (typeof selected === "string") {
        upsertProject(selected);
      }
    } catch (error) {
      setNotice(`打开项目失败：${String(error)}`);
    }
  }

  async function handleSelectNewProjectParent() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择新项目所在目录"
      });

      if (typeof selected === "string") {
        setNewProjectParent(selected);
      }
    } catch (error) {
      setNotice(`选择目录失败：${String(error)}`);
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!newProjectParent || !name) {
      setNotice("请选择父目录并填写项目名称");
      return;
    }

    try {
      const projectPath = await createProjectDirectory(newProjectParent, name);
      upsertProject(projectPath);
      setShowNewProjectDialog(false);
      setNewProjectParent("");
      setNewProjectName("");
    } catch (error) {
      setNotice(`新建项目失败：${String(error)}`);
    }
  }

  function handleRemoveProjectApproval(project: ProjectEntry) {
    setPendingProjectRemoval(project);
    setProjectApprovalText("");
  }

  function handleConfirmRemoveProject() {
    if (!pendingProjectRemoval || projectApprovalText.trim() !== pendingProjectRemoval.name) {
      return;
    }

    const nextProjects = projects.filter((project) => project.id !== pendingProjectRemoval.id);
    const nextActiveProjectId =
      activeProjectId === pendingProjectRemoval.id ? nextProjects[0]?.id || "" : activeProjectId;

    setProjects(nextProjects);
    setActiveProjectId(nextActiveProjectId);
    setExpandedProjectIds((current) => current.filter((id) => id !== pendingProjectRemoval.id));
    setProjectConversations((current) => {
      const { [pendingProjectRemoval.id]: _, ...rest } = current;
      return rest;
    });
    saveProjects(nextProjects, nextActiveProjectId);
    setPendingProjectRemoval(null);
    setProjectApprovalText("");
    setNotice("项目入口已移除，磁盘文件未删除。");
  }

  function toggleProjectExpanded(projectId: string) {
    setExpandedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }

  async function refreshProjectConversationMap(projectList = projects) {
    if (projectList.length === 0) {
      setProjectConversations({});
      return;
    }

    const pairs = await Promise.all(
      projectList.map(async (project) => {
        const projectItems = await listConversations(project.path);
        return [project.id, projectItems] as const;
      })
    );
    setProjectConversations(Object.fromEntries(pairs));
  }

  function findConversationById(conversationId: string) {
    const allProjectConversations = Object.values(projectConversations).flat();
    return [...conversations, ...allProjectConversations].find(
      (conversation) => conversation.id === conversationId
    ) || null;
  }

  function findConversationProject(conversation: Conversation | null) {
    return conversation?.project_path
      ? projects.find((project) => project.path === conversation.project_path) || null
      : null;
  }

  function resolveConversationProject(
    conversationId: string,
    projectHint: ProjectEntry | null = null
  ) {
    return findConversationProject(findConversationById(conversationId)) || projectHint;
  }

  return {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    expandedProjectIds,
    setExpandedProjectIds,
    projectsSectionExpanded,
    setProjectsSectionExpanded,
    chatsSectionExpanded,
    setChatsSectionExpanded,
    projectConversations,
    setProjectConversations,
    showNewProjectDialog,
    setShowNewProjectDialog,
    newProjectParent,
    setNewProjectParent,
    newProjectName,
    setNewProjectName,
    pendingProjectRemoval,
    setPendingProjectRemoval,
    projectApprovalText,
    setProjectApprovalText,
    contextMenu,
    setContextMenu,
    activeProject,
    selectProject,
    upsertProject,
    handleOpenProject,
    handleSelectNewProjectParent,
    handleCreateProject,
    handleRemoveProjectApproval,
    handleConfirmRemoveProject,
    toggleProjectExpanded,
    refreshProjectConversationMap,
    findConversationById,
    findConversationProject,
    resolveConversationProject
  };
}
