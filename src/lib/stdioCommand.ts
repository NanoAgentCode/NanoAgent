import type { McpServerDraft } from "../types";

export function formatStdioCommandLine(draft: McpServerDraft) {
  const args = parseJsonStringArray(draft.args_json);
  return [draft.command, ...args].filter(Boolean).map(quoteCommandPart).join(" ");
}

export function parseStdioCommandLine(value: string) {
  const parts = splitCommandLine(value.trim());
  if (parts.length === 0 || !parts[0]) {
    throw new Error("stdio 命令不能为空。");
  }
  return {
    command: parts[0],
    args: parts.slice(1)
  };
}

export function parseJsonStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function quoteCommandPart(value: string) {
  if (!value) return "";
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function splitCommandLine(value: string) {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      if (quote === '"' && char === "\\" && (next === '"' || next === "\\")) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new Error("stdio 命令中的引号未闭合。");
  }
  if (current) parts.push(current);
  return parts;
}
