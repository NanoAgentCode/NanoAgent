export type ItemKind = "note" | "task" | "prompt";

export interface Item {
  id: string;
  kind: ItemKind | string;
  title: string;
  body: string;
  status: string;
  tags: string[];
  reminder_at?: string | null;
  repeat_rule?: string | null;
  last_reminded_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemDraft {
  kind: string;
  title: string;
  body: string;
  status?: string;
  tags: string[];
  reminder_at?: string | null;
  repeat_rule?: string | null;
}

export interface ItemPatch {
  id: string;
  kind?: string;
  title?: string;
  body?: string;
  status?: string;
  tags?: string[];
  reminder_at?: string | null;
  repeat_rule?: string | null;
  last_reminded_at?: string | null;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  model: string;
  api_key: string;
  created_at: string;
  updated_at: string;
}

export interface ModelConfigDraft {
  id?: string;
  name: string;
  provider: string;
  base_url: string;
  model: string;
  api_key: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  model_config_id?: string | null;
  project_path?: string | null;
  archived: boolean;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationDraft {
  title?: string;
  model_config_id?: string | null;
  project_path?: string | null;
}

export interface PersistedMessage {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  created_at: string;
}

export interface MessageDraft {
  conversation_id: string;
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Memory {
  id: string;
  title: string;
  content: string;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemoryDraft {
  title: string;
  content: string;
  tags: string[];
  enabled?: boolean;
}

export interface MemoryPatch {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
  enabled?: boolean;
}

export type ChatStreamEvent =
  | { type: "delta"; request_id: string; content: string }
  | { type: "reasoning_delta"; request_id: string; content: string }
  | { type: "done"; request_id: string }
  | { type: "error"; request_id: string; message: string };

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface GitHubSkill {
  slug: string;
  name: string;
  description: string;
  doc_url: string;
}

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  opened_at: string;
}

export interface ProjectFileEntry {
  path: string;
  is_dir: boolean;
  size?: number | null;
}

export interface ProjectFileContent {
  path: string;
  content: string;
  hash: string;
  size: number;
}

export interface ProjectFileWriteRequest {
  project_path: string;
  relative_path: string;
  content: string;
  expected_hash?: string | null;
}

export interface ProjectFileMoveRequest {
  project_path: string;
  from_relative_path: string;
  to_relative_path: string;
  approval_text: string;
}

export interface ObservabilitySpan {
  id: string;
  trace_id: string;
  parent_span_id?: string | null;
  operation: string;
  category: string;
  entity_type?: string | null;
  entity_id?: string | null;
  status: string;
  started_at: string;
  ended_at?: string | null;
  duration_ms?: number | null;
  input_summary?: string | null;
  output_summary?: string | null;
  error?: string | null;
  metadata_json?: string | null;
}
