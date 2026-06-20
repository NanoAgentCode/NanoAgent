import { invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  Conversation,
  ConversationDraft,
  Item,
  ItemDraft,
  ItemPatch,
  Memory,
  MemoryDraft,
  MemoryPatch,
  MessageDraft,
  ModelConfig,
  ModelConfigDraft,
  PersistedMessage,
  GitHubSkill,
  ProjectFileContent,
  ProjectFileEntry,
  ProjectFileMoveRequest,
  ProjectFileWriteRequest,
  ObservabilitySpan,
  WebSearchResult
} from "./types";

export function listItems(kind?: string) {
  return invoke<Item[]>("list_items", { kind: kind || null });
}

export function searchItems(query: string) {
  return invoke<Item[]>("search_items", { query });
}

export function createItem(draft: ItemDraft) {
  return invoke<Item>("create_item", { draft });
}

export function updateItem(patch: ItemPatch) {
  return invoke<Item>("update_item", { patch });
}

export function deleteItem(id: string) {
  return invoke<void>("delete_item", { id });
}

export function listModelConfigs() {
  return invoke<ModelConfig[]>("list_model_configs");
}

export function saveModelConfig(draft: ModelConfigDraft) {
  return invoke<ModelConfig>("save_model_config", { draft });
}

export function deleteModelConfig(id: string) {
  return invoke<void>("delete_model_config", { id });
}

export function listConversations(projectPath?: string | null) {
  return invoke<Conversation[]>("list_conversations", { projectPath: projectPath || null });
}

export function listArchivedConversations(projectPath?: string | null) {
  return invoke<Conversation[]>("list_archived_conversations", { projectPath: projectPath || null });
}

export function createConversation(draft: ConversationDraft) {
  return invoke<Conversation>("create_conversation", { draft });
}

export function deleteConversation(id: string) {
  return invoke<void>("delete_conversation", { id });
}

export function archiveConversation(id: string, archived: boolean) {
  return invoke<void>("archive_conversation", { id, archived });
}

export function renameConversation(id: string, title: string) {
  return invoke<void>("rename_conversation", { id, title });
}

export function listMessages(conversationId: string) {
  return invoke<PersistedMessage[]>("list_messages", { conversationId });
}

export function appendMessage(draft: MessageDraft) {
  return invoke<PersistedMessage>("append_message", { draft });
}

export function listMemories() {
  return invoke<Memory[]>("list_memories");
}

export function listEnabledMemories() {
  return invoke<Memory[]>("list_enabled_memories");
}

export function searchMemories(query: string) {
  return invoke<Memory[]>("search_memories", { query });
}

export function createMemory(draft: MemoryDraft) {
  return invoke<Memory>("create_memory", { draft });
}

export function updateMemory(patch: MemoryPatch) {
  return invoke<Memory>("update_memory", { patch });
}

export function deleteMemory(id: string) {
  return invoke<void>("delete_memory", { id });
}

export function internetSearch(query: string, tavilyApiKey?: string) {
  return invoke<WebSearchResult[]>("internet_search", {
    query,
    tavilyApiKey: tavilyApiKey?.trim() || null
  });
}


export function listLocalSkills() {
  return invoke<[string, GitHubSkill[]]>("list_local_skills");
}

export function chat(
  modelConfigId: string,
  messages: ChatMessage[],
  temperature = 0.4,
  traceId?: string
) {
  return invoke<{ content: string }>("chat", {
    request: {
      model_config_id: modelConfigId,
      messages,
      temperature,
      trace_id: traceId || null
    }
  });
}

export function chatStream(
  requestId: string,
  modelConfigId: string,
  messages: ChatMessage[],
  temperature = 0.4,
  traceId?: string
) {
  return invoke<void>("chat_stream", {
    request: {
      request_id: requestId,
      model_config_id: modelConfigId,
      messages,
      temperature,
      trace_id: traceId || null
    }
  });
}

export function deleteMessages(ids: string[]) {
  return invoke<void>("delete_messages", { ids });
}

export function checkEnv(nodePath?: string, pythonPath?: string) {
  return invoke<Record<string, boolean>>("check_env", {
    nodePath: nodePath || null,
    pythonPath: pythonPath || null
  });
}

export function installEnv(tech: string) {
  return invoke<boolean>("install_env", { tech });
}

export function createProjectDirectory(parentPath: string, name: string) {
  return invoke<string>("create_project_directory", { parentPath, name });
}

export function listProjectFiles(projectPath: string) {
  return invoke<ProjectFileEntry[]>("list_project_files", { projectPath });
}

export function readProjectFile(projectPath: string, relativePath: string) {
  return invoke<ProjectFileContent>("read_project_file", { projectPath, relativePath });
}

export function createProjectFile(request: ProjectFileWriteRequest) {
  return invoke<ProjectFileContent>("create_project_file", { request });
}

export function writeProjectFile(request: ProjectFileWriteRequest) {
  return invoke<ProjectFileContent>("write_project_file", { request });
}

export function deleteProjectFile(projectPath: string, relativePath: string, approvalText: string) {
  return invoke<void>("delete_project_file", { projectPath, relativePath, approvalText });
}

export function renameProjectFile(request: ProjectFileMoveRequest) {
  return invoke<ProjectFileEntry>("rename_project_file", { request });
}

export function executeBashCommand(projectPath: string, command: string) {
  return invoke<string>("execute_bash_command", { projectPath, command });
}

export function writeLocalFile(projectPath: string, path: string, content: string) {
  return invoke<void>("write_local_file", { projectPath, path, content });
}

export function readLocalFile(projectPath: string, path: string) {
  return invoke<string>("read_local_file", { projectPath, path });
}

export function listObservabilitySpans(limit = 200) {
  return invoke<ObservabilitySpan[]>("list_observability_spans", { limit });
}

export function clearObservabilitySpans() {
  return invoke<void>("clear_observability_spans");
}
