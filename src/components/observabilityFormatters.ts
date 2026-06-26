import type { AgentRun, AgentRunTimeline, AgentStep, ObservabilitySpan } from "../types";

export type AgentTimelineEvent = {
  id: string;
  time: string;
  status: string;
  title: string;
  subtitle: string;
  detail: string;
};

export function buildAgentTimelineEvents(timeline: AgentRunTimeline): AgentTimelineEvent[] {
  const stepEvents = timeline.steps.map((step) => ({
    id: `step-${step.id}`,
    time: step.created_at,
    status: step.status,
    title: formatAgentStepTitle(step),
    subtitle: `step / ${step.kind}`,
    detail: [step.input_summary, step.output_summary, step.metadata_json]
      .filter(Boolean)
      .join("\n")
  }));

  const toolEvents = timeline.tool_calls.map((toolCall) => ({
    id: `tool-${toolCall.id}`,
    time: toolCall.created_at,
    status: toolCall.status,
    title: `工具请求：${toolCall.name}`,
    subtitle: `tool_call / message ${toolCall.message_id.slice(0, 8)}`,
    detail: [
      toolCall.args_json ? `args: ${toolCall.args_json}` : "",
      toolCall.result_summary,
      toolCall.error ? `error: ${toolCall.error}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  }));

  return [...stepEvents, ...toolEvents].sort(
    (left, right) => Date.parse(left.time) - Date.parse(right.time)
  );
}

export function formatAgentRunTitle(run: AgentRun) {
  const trigger = run.trigger_message_id ? `message ${run.trigger_message_id.slice(0, 8)}` : "manual";
  return `${formatRuntimeStatus(run.status)} · ${trigger}`;
}

function formatAgentStepTitle(step: AgentStep) {
  const labels: Record<string, string> = {
    message: "用户消息",
    model: "模型调用",
    model_continue: "模型继续",
    tool: "工具执行",
    approval: "审批",
    memory: "记忆写入",
    error: "错误"
  };
  return labels[step.kind] || step.kind;
}

export function formatRuntimeStatus(status: string) {
  const labels: Record<string, string> = {
    running: "运行中",
    awaiting_tool: "等待工具",
    pending_approval: "等待审批",
    approved: "已批准",
    rejected: "已拒绝",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  };
  return labels[status] || status;
}

export function formatShortTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function formatDuration(durationMs: number) {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 0 : 1)} s`;
  }
  return `${durationMs} ms`;
}

export function buildObservabilitySpanDetail(span: ObservabilitySpan) {
  return [
    span.input_summary ? `输入：${span.input_summary}` : "",
    span.output_summary ? `输出：${span.output_summary}` : "",
    span.error ? `错误：${span.error}` : "",
    span.metadata_json ? `元数据：${span.metadata_json}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
