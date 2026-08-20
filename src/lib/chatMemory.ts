import { upsertPersonalizationMemory } from "../api";
import { safeRecordAgentStep } from "./agentSafe";
import type { extractPersonalizationMemoryDraft } from "./messageHelpers";

export async function savePersonalizationMemory(
  draft: ReturnType<typeof extractPersonalizationMemoryDraft>,
  runId?: string | null
) {
  if (!draft) return;
  try {
    const savedMemory = await upsertPersonalizationMemory(draft);
    if (runId) {
      void safeRecordAgentStep({
        run_id: runId,
        kind: "memory",
        status: "completed",
        input_summary: `auto_personalization:${savedMemory.title}`,
        output_summary: `memory_id=${savedMemory.id}`
      });
    }
  } catch (error) {
    console.warn("Failed to save personalization memory:", error);
    if (runId && draft) {
      void safeRecordAgentStep({
        run_id: runId,
        kind: "memory",
        status: "failed",
        input_summary: draft.title,
        output_summary: String(error)
      });
    }
  }
}
