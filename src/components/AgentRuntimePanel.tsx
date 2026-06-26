import type { RefObject } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AgentRunTimeline } from "../types";
import ObservabilityDetailPanel from "./ObservabilityDetailPanel";
import {
  buildAgentTimelineEvents,
  formatAgentRunTitle,
  formatRuntimeStatus,
  formatShortTime
} from "./observabilityFormatters";

interface AgentRuntimePanelProps {
  panelRef: RefObject<HTMLElement>;
  activeConversationId: string | null;
  activeConversationTitle?: string;
  timelines: AgentRunTimeline[];
  activeTimeline: AgentRunTimeline | null;
  isCollapsed: boolean;
  expandedRows: string[];
  onToggleCollapsed: () => void;
  onToggleRow: (rowId: string) => void;
}

export default function AgentRuntimePanel({
  panelRef,
  activeConversationId,
  activeConversationTitle,
  timelines,
  activeTimeline,
  isCollapsed,
  expandedRows,
  onToggleCollapsed,
  onToggleRow
}: AgentRuntimePanelProps) {
  const timelineEvents = activeTimeline ? buildAgentTimelineEvents(activeTimeline) : [];

  return (
    <section
      ref={panelRef}
      className="agent-runtime-panel"
      style={{
        position: "absolute",
        top: "56px",
        right: "20px",
        width: "480px",
        maxWidth: "calc(100% - 40px)",
        maxHeight: "calc(100% - 100px)",
        overflowY: "auto",
        zIndex: 100,
        background: "var(--bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: "8px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)",
        flexShrink: 0
      }}
    >
      <div className="observability-trace-summary clickable" onClick={onToggleCollapsed}>
        <div>
          <strong>Agent Runtime</strong>
          <span>{activeConversationTitle || "当前会话"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>
            {activeTimeline
              ? `${timelines.length} runs · ${activeTimeline.run.status}`
              : activeConversationId
                ? "暂无运行记录"
                : "未选择会话"}
          </span>
          {activeTimeline && (isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />)}
        </div>
      </div>
      {activeTimeline && !isCollapsed ? (
        <div className="agent-run-timeline">
          <div className={`agent-run-header ${activeTimeline.run.status}`}>
            <div>
              <strong>{formatAgentRunTitle(activeTimeline.run)}</strong>
              <span>{activeTimeline.run.id}</span>
            </div>
            <small>{new Date(activeTimeline.run.created_at).toLocaleString()}</small>
          </div>
          {timelineEvents.map((event) => {
            const rowId = `runtime-${event.id}`;
            const isExpanded = expandedRows.includes(rowId);

            return (
              <div key={event.id} className={`agent-timeline-row ${event.status}`}>
                <button className="timeline-row-toggle" onClick={() => onToggleRow(rowId)} type="button">
                  <span className="observability-status-dot" />
                  <span className="timeline-row-copy">
                    <strong>{event.title}</strong>
                    <small>{event.subtitle}</small>
                  </span>
                  <span className="agent-timeline-meta">
                    <span>{formatRuntimeStatus(event.status)}</span>
                    <span>{formatShortTime(event.time)}</span>
                  </span>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {isExpanded && event.detail && (
                  <div className="timeline-row-detail">
                    <ObservabilityDetailPanel detail={event.detail} />
                  </div>
                )}
              </div>
            );
          })}
          {timelineEvents.length === 0 && (
            <div className="empty">该 run 暂无步骤</div>
          )}
        </div>
      ) : activeTimeline ? null : (
        <div className="empty" style={{ padding: "20px" }}>
          当前会话还没有 Agent Runtime 记录
        </div>
      )}
    </section>
  );
}
