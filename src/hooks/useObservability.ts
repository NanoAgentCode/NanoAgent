import { useEffect, useState, useMemo } from "react";
import {
  listObservabilitySpans,
  listAgentRunTimelines,
  clearObservabilitySpans
} from "../api";
import { confirmAction } from "../lib/dialogs";
import type { ObservabilitySpan, AgentRunTimeline } from "../types";
import type { ObservabilityTraceGroup } from "../components/ObservabilityPanel";

export interface UseObservabilityReturn {
  observabilitySpans: ObservabilitySpan[];
  agentRunTimelines: AgentRunTimeline[];
  selectedTraceId: string;
  setSelectedTraceId: React.Dispatch<React.SetStateAction<string>>;
  expandedObservabilityRows: string[];
  setExpandedObservabilityRows: React.Dispatch<React.SetStateAction<string[]>>;
  traceTimelineCollapsed: boolean;
  setTraceTimelineCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isLoadingObservability: boolean;
  showChatRuntime: boolean;
  setShowChatRuntime: React.Dispatch<React.SetStateAction<boolean>>;
  traceGroups: ObservabilityTraceGroup[];
  selectedTrace: ObservabilityTraceGroup | null;
  activeRunTimeline: AgentRunTimeline | null;
  activeTraceTimelineItems: ObservabilitySpan[];
  refreshObservability: () => Promise<void>;
  handleClearObservability: () => Promise<void>;
  toggleTimelineRow: (id: string) => void;
}

export function useObservability(
  setNotice: (message: string) => void,
  activeConversationId: string,
  showModelConfig: boolean,
  activeSettingsTab: string
): UseObservabilityReturn {
  const [observabilitySpans, setObservabilitySpans] = useState<ObservabilitySpan[]>([]);
  const [agentRunTimelines, setAgentRunTimelines] = useState<AgentRunTimeline[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState("");
  const [expandedObservabilityRows, setExpandedObservabilityRows] = useState<string[]>([]);
  const [traceTimelineCollapsed, setTraceTimelineCollapsed] = useState(false);
  const [isLoadingObservability, setIsLoadingObservability] = useState(false);
  const [showChatRuntime, setShowChatRuntime] = useState(false);

  const traceGroups = useMemo<ObservabilityTraceGroup[]>(() => {
    const groups = new Map<string, ObservabilitySpan[]>();
    for (const span of observabilitySpans) {
      const current = groups.get(span.trace_id) || [];
      current.push(span);
      groups.set(span.trace_id, current);
    }

    return Array.from(groups.entries())
      .map(([traceId, spans]) => {
        const sorted = [...spans].sort(
          (left, right) => Date.parse(left.started_at) - Date.parse(right.started_at)
        );
        const errors = sorted.filter((span) => span.status === "error").length;
        const duration = sorted.reduce((sum, span) => sum + (span.duration_ms || 0), 0);
        const startedAt = sorted[0]?.started_at || "";
        const lastSpan = sorted[sorted.length - 1];
        return {
          traceId,
          spans: sorted,
          errors,
          duration,
          startedAt,
          lastOperation: lastSpan?.operation || ""
        };
      })
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  }, [observabilitySpans]);

  const selectedTrace = useMemo(() => {
    return traceGroups.find((trace) => trace.traceId === selectedTraceId) || traceGroups[0] || null;
  }, [traceGroups, selectedTraceId]);

  const activeRunTimeline = useMemo(() => {
    return agentRunTimelines[0] || null;
  }, [agentRunTimelines]);

  const activeTraceTimelineItems = useMemo(() => {
    return selectedTrace?.spans || [];
  }, [selectedTrace]);

  useEffect(() => {
    setExpandedObservabilityRows([]);
    setTraceTimelineCollapsed(false);
  }, [selectedTrace?.traceId]);

  useEffect(() => {
    if (showModelConfig && activeSettingsTab === "observability") {
      void refreshObservability();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModelConfig, activeSettingsTab, activeConversationId]);

  async function refreshObservability() {
    setIsLoadingObservability(true);
    try {
      const spans = await listObservabilitySpans(200);
      setObservabilitySpans(spans);
      if (activeConversationId) {
        setAgentRunTimelines(await listAgentRunTimelines(activeConversationId, 20));
      } else {
        setAgentRunTimelines([]);
      }
      setSelectedTraceId((current) =>
        current && spans.some((span) => span.trace_id === current)
          ? current
          : spans[0]?.trace_id || ""
      );
    } catch (error) {
      setNotice(String(error));
    } finally {
      setIsLoadingObservability(false);
    }
  }

  async function handleClearObservability() {
    if (!(await confirmAction("确定要清空全部观测追踪记录吗？"))) {
      return;
    }

    try {
      await clearObservabilitySpans();
      setObservabilitySpans([]);
      setAgentRunTimelines([]);
      setSelectedTraceId("");
    } catch (error) {
      setNotice(String(error));
    }
  }

  const toggleTimelineRow = (id: string) => {
    setExpandedObservabilityRows((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  return {
    observabilitySpans,
    agentRunTimelines,
    selectedTraceId,
    setSelectedTraceId,
    expandedObservabilityRows,
    setExpandedObservabilityRows,
    traceTimelineCollapsed,
    setTraceTimelineCollapsed,
    isLoadingObservability,
    showChatRuntime,
    setShowChatRuntime,
    traceGroups,
    selectedTrace,
    activeRunTimeline,
    activeTraceTimelineItems,
    refreshObservability,
    handleClearObservability,
    toggleTimelineRow
  };
}
