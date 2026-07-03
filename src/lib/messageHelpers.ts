export function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function extractMemoryDraft(content: string) {
  const normalized = content.trim();
  const memoryIntent =
    /(记住|记一下|记到记忆|保存到记忆|加入记忆|更新(?:一下)?(?:我的)?记忆|修改(?:一下)?(?:我的)?记忆|以后记得)/.test(normalized);

  if (!memoryIntent) {
    return null;
  }

  const memoryContent = normalized
    .replace(/^(请|帮我|麻烦你|你)?\s*/, "")
    .replace(/^(记住|记一下|记到记忆|保存到记忆|加入记忆|以后记得)[：:\s]*/i, "")
    .replace(/^更新(?:一下)?(?:我的)?记忆[：:\s]*/i, "")
    .replace(/^修改(?:一下)?(?:我的)?记忆[：:\s]*/i, "")
    .trim();

  if (!memoryContent) {
    return null;
  }

  const title = memoryContent
    .replace(/[。.!！?？\n\r].*$/s, "")
    .slice(0, 24)
    .trim() || "聊天记忆";

  return {
    title,
    content: memoryContent,
    tags: ["chat"],
    enabled: true
  };
}

export function extractPersonalizationMemoryDraft(content: string) {
  const normalized = compactPersonalizationText(content);
  if (!normalized || normalized.length > 240 || normalized.endsWith("?") || normalized.endsWith("？")) {
    return null;
  }

  const lower = normalized.toLowerCase();
  const isPreference =
    /(我.*(喜欢|偏好|更喜欢|不喜欢|讨厌|习惯|希望你|以后.*回答|回复.*尽量|默认.*用)|请你以后|以后请)/.test(normalized) ||
    /\b(i|i'm|i am|me)\b.*\b(prefer|like|dislike|usually|always|want you to|don't like)\b/.test(lower);
  const isProfile =
    /(我是|我叫|我的名字|我目前|我正在|我主要|我负责|我的工作|我用的是|常用|工作目录|项目是)/.test(normalized) ||
    /\b(i am|i'm|my name is|i work on|i use|my role is|i'm responsible for)\b/.test(lower);

  if (!isPreference && !isProfile) {
    return null;
  }

  const tags = ["auto", "personalization", isPreference ? "preference" : "profile"];
  const title = buildPersonalizationTitle(normalized, isPreference ? "偏好" : "用户画像");

  return {
    title,
    content: normalized,
    tags,
    enabled: true
  };
}

function compactPersonalizationText(content: string) {
  return content
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPersonalizationTitle(content: string, fallback: string) {
  const title = content
    .replace(/[。.!！?？\n\r].*$/s, "")
    .replace(/^(请|麻烦你|以后请|请你以后)\s*/, "")
    .slice(0, 24)
    .trim();
  return title || fallback;
}

export interface ParsedToolCall {
  name: string;
  args: Record<string, string>;
  raw: string;
}

export interface ParsedToolResult {
  name: string;
  status: "success" | "failed" | "rejected" | "unknown";
  summary: string;
  detail: string;
}

export function parseToolCall(content: string): ParsedToolCall | null {
  if (!content) return null;
  const match = content.match(/<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/);
  if (!match) return null;

  const name = match[1];
  const body = match[2];
  const args: Record<string, string> = {};

  const tagRegex = /<([^>]+)>([\s\S]*?)<\/\1>/g;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(body)) !== null) {
    args[tagMatch[1]] = tagMatch[2].trim();
  }

  return { name, args, raw: match[0] };
}

export function parseToolResult(content: string): ParsedToolResult | null {
  if (!content) return null;
  const match = content.match(/^\[工具执行结果: ([^\]]+)\]\s*([\s\S]*)$/);
  if (!match) return null;

  const name = match[1].trim();
  const body = match[2].trim();
  if (body.startsWith("执行失败")) {
    return {
      name,
      status: "failed",
      summary: "执行失败",
      detail: body.replace(/^执行失败[:：]?\s*/, "").trim() || body
    };
  }
  if (body.startsWith("执行结果如下")) {
    return {
      name,
      status: "success",
      summary: "执行完成",
      detail: body.replace(/^执行结果如下[:：]?\s*/, "").trim() || body
    };
  }
  if (body.includes("用户拒绝")) {
    return {
      name,
      status: "rejected",
      summary: "用户拒绝",
      detail: body
    };
  }

  return {
    name,
    status: "unknown",
    summary: "工具结果",
    detail: body
  };
}
