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

  const policy = classifyPersonalization(normalized, lower, isPreference);
  const tags = ["auto", "personalization", isPreference ? "preference" : "profile"];
  if (policy.dimension) {
    tags.push(`${policy.multi ? "profile-dimension" : "personalization"}:${policy.dimension}`);
  }
  if (policy.always) {
    tags.push("personalization:always");
  }
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
    .replace(/^(请|帮我|麻烦你|你)?\s*(记住|记一下|记到记忆|保存到记忆|加入记忆|以后记得)[：:\s,，]*/i, "")
    .trim();
}

function classifyPersonalization(content: string, lower: string, isPreference: boolean) {
  if (isPreference) {
    if (/(中文|英文|英语|语言).*(回答|回复)|(?:回答|回复).*(中文|英文|英语|语言)/.test(content) || /\b(chinese|english|language)\b.*\b(answer|reply|respond)/.test(lower)) {
      return { dimension: "response-language", always: true };
    }
    if (/(简洁|简短|精简|详细|展开|啰嗦|回答长度|回复长度)/.test(content) || /\b(concise|brief|short|detailed|verbose)\b/.test(lower)) {
      return { dimension: "response-length", always: true };
    }
    if (/(表格|列表|要点|分点|markdown|代码块|回答格式|回复格式)/i.test(content) || /\b(table|bullet|markdown|format)\b/.test(lower)) {
      return { dimension: "response-format", always: true };
    }
    if (/(语气|表达风格|回答风格|回复风格|正式|随意|直接一点)/.test(content) || /\b(tone|response style|formal|casual)\b/.test(lower)) {
      return { dimension: "response-tone", always: true };
    }
    if (/(希望你|以后.*(?:回答|回复)|请你以后|以后请)/.test(content) || /\b(always|want you to)\b/.test(lower)) {
      return { dimension: "response-style", always: true };
    }
    if (/(工作方式|工作流程|我习惯|先.+再|每次.+先)/.test(content) || /\b(workflow|i usually)\b/.test(lower)) {
      return { dimension: "workflow", always: false, multi: true };
    }
    return { dimension: null, always: false };
  }

  if (/(我叫|我的名字)/.test(content) || /\b(my name is)\b/.test(lower)) {
    return { dimension: "profile-name", always: true };
  }
  if (/(我的工作|我的角色|我负责|我是.*(?:工程师|开发|设计师|产品|经理|学生|教师))/.test(content) || /\b(my role is|i'm responsible for|i am an? .*?(engineer|developer|designer|manager))\b/.test(lower)) {
    return { dimension: "profile-role", always: true };
  }
  if (/(工作目录|项目目录|workspace)/i.test(content)) {
    return { dimension: "profile-workspace", always: false };
  }
  if (/(我用的是|操作系统|windows|macos|linux)/i.test(content)) {
    return { dimension: "profile-environment", always: false };
  }
  if (/(常用|主要使用|技术栈|开发语言|框架)/.test(content) || /\b(i use|tech stack|framework|programming language)\b/.test(lower)) {
    return { dimension: "tooling", always: false, multi: true };
  }
  if (/(项目是|我正在做|我主要维护|长期项目)/.test(content) || /\b(i work on|my project|i maintain)\b/.test(lower)) {
    return { dimension: "project", always: false, multi: true };
  }
  if (/(我关注|我感兴趣|研究方向)/.test(content) || /\b(i am interested in|i care about)\b/.test(lower)) {
    return { dimension: "interest", always: false, multi: true };
  }
  return { dimension: null, always: false };
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
