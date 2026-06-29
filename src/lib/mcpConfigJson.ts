import type { McpServerDraft } from "../types";

const mcpTransports = new Set(["stdio", "sse", "streamable_http"]);

type JsonObject = Record<string, unknown>;

export function formatMcpConfigJson(draft: McpServerDraft) {
  const config: JsonObject = {
    name: draft.name,
    transport: normalizeTransport(draft.transport, "stdio"),
    command: draft.command,
    args_json: normalizeJsonArrayString(draft.args_json),
    env_json: normalizeJsonObjectString(draft.env_json),
    url: draft.url,
    headers_json: normalizeJsonObjectString(draft.headers_json),
    working_dir: draft.working_dir,
    enabled: draft.enabled
  };
  if (draft.id) {
    config.id = draft.id;
  }
  return JSON.stringify(config, null, 2);
}

const fallbackMcpDraft: McpServerDraft = {
  name: "MCP Server",
  transport: "stdio",
  command: "",
  args_json: "[]",
  env_json: "{}",
  url: "",
  headers_json: "{}",
  working_dir: "",
  enabled: true
};

export function parseMcpConfigJson(value: string, fallback: McpServerDraft = fallbackMcpDraft): McpServerDraft {
  const parsed = JSON.parse(value) as unknown;
  const { name, config } = unwrapMcpConfig(parsed);
  const transport = inferTransport(config, fallback.transport || "stdio");

  return {
    id: readString(config.id) || fallback.id,
    name: readString(config.name) || name || fallback.name,
    transport,
    command: readString(config.command) || fallback.command,
    args_json: readJsonArrayField(config.args_json, config.args, fallback.args_json),
    env_json: readJsonObjectField(config.env_json, config.env, fallback.env_json),
    url: readString(config.url) || fallback.url,
    headers_json: readJsonObjectField(config.headers_json, config.headers, fallback.headers_json),
    working_dir: readString(config.working_dir) || readString(config.cwd) || fallback.working_dir,
    enabled: typeof config.enabled === "boolean" ? config.enabled : fallback.enabled
  };
}

function unwrapMcpConfig(value: unknown): { name: string; config: JsonObject } {
  if (!isJsonObject(value)) {
    throw new Error("MCP 配置 JSON 必须是对象。");
  }
  if (isJsonObject(value.mcpServers)) {
    const [name, config] = Object.entries(value.mcpServers).find(([, candidate]) => isJsonObject(candidate)) || [];
    if (name && isJsonObject(config)) {
      return { name, config };
    }
    throw new Error("mcpServers 中没有可用的服务器配置。");
  }
  return { name: "", config: value };
}

function readJsonArrayField(value: unknown, alias: unknown, fallback: string) {
  if (typeof value === "string") return normalizeJsonArrayString(value);
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => String(item)));
  if (Array.isArray(alias)) return JSON.stringify(alias.map((item) => String(item)));
  return normalizeJsonArrayString(fallback);
}

function readJsonObjectField(value: unknown, alias: unknown, fallback: string) {
  if (typeof value === "string") return normalizeJsonObjectString(value);
  if (isJsonObject(value)) return JSON.stringify(value);
  if (isJsonObject(alias)) return JSON.stringify(alias);
  return normalizeJsonObjectString(fallback);
}

function normalizeJsonArrayString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "[]";
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("args_json 必须是 JSON 数组。");
  }
  return JSON.stringify(parsed.map((item) => String(item)));
}

function normalizeJsonObjectString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "{}";
  const parsed = JSON.parse(trimmed) as unknown;
  if (!isJsonObject(parsed) || Array.isArray(parsed)) {
    throw new Error("env_json 和 headers_json 必须是 JSON 对象。");
  }
  return JSON.stringify(parsed);
}

function normalizeTransport(value: string, fallback: string) {
  if (mcpTransports.has(value)) return value;
  if (mcpTransports.has(fallback)) return fallback;
  return "stdio";
}

function inferTransport(config: JsonObject, fallback: string) {
  const explicit = readString(config.transport) || readString(config.type);
  if (mcpTransports.has(explicit)) return explicit;
  if (readString(config.command)) return "stdio";
  return normalizeTransport("", fallback);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
