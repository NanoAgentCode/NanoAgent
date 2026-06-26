import ObservabilityPanel from "../ObservabilityPanel";
import type { UseObservabilityReturn } from "../../hooks/useObservability";

interface SettingsObservabilityTabProps {
  obs: UseObservabilityReturn;
}

export default function SettingsObservabilityTab({ obs }: SettingsObservabilityTabProps) {
  return (
    <ObservabilityPanel
      traces={obs.traceGroups}
      selectedTrace={obs.selectedTrace}
      timelineItems={obs.activeTraceTimelineItems}
      expandedRows={obs.expandedObservabilityRows}
      isTimelineCollapsed={obs.traceTimelineCollapsed}
      isLoading={obs.isLoadingObservability}
      spanCount={obs.observabilitySpans.length}
      onRefresh={() => void obs.refreshObservability()}
      onClear={() => void obs.handleClearObservability()}
      onSelectTrace={obs.setSelectedTraceId}
      onToggleTimeline={() => obs.setTraceTimelineCollapsed(!obs.traceTimelineCollapsed)}
      onToggleRow={obs.toggleTimelineRow}
    />
  );
}
