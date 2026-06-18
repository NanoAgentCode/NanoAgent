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

export function listConversations() {
  return invoke<Conversation[]>("list_conversations");
}

export function listArchivedConversations() {
  return invoke<Conversation[]>("list_archived_conversations");
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

export function internetSearch(query: string) {
  return invoke<WebSearchResult[]>("internet_search", { query });
}

export function chat(modelConfigId: string, messages: ChatMessage[], temperature = 0.4) {
  return invoke<{ content: string }>("chat", {
    request: {
      model_config_id: modelConfigId,
      messages,
      temperature
    }
  });
}

export function chatStream(
  requestId: string,
  modelConfigId: string,
  messages: ChatMessage[],
  temperature = 0.4
) {
  return invoke<void>("chat_stream", {
    request: {
      request_id: requestId,
      model_config_id: modelConfigId,
      messages,
      temperature
    }
  });
}
