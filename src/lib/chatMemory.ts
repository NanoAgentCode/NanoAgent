import { createMemory, listRelevantMemories } from "../api";
import { safeRecordAgentStep } from "./agentSafe";
import type { extractPersonalizationMemoryDraft } from "./messageHelpers";

export async function savePersonalizationMemory(
  draft: ReturnType<typeof extractPersonalizationMemoryDraft>,
  runId?: string | null
) {
  if (!draft) return;
  try {
    const existing = await listRelevantMemories(draft.content, 5);
    const normalizedContent = normalizeMemoryText(draft.content);
    const isDuplicate = existing.some((memory) =>
      normalizeMemoryText(memory.content) === normalizedContent ||
      normalizeMemoryText(memory.title) === normalizeMemoryText(draft.title)
    );
    if (isDuplicate) return;

    const savedMemory = await createMemory(draft);
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

function normalizeMemoryText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
