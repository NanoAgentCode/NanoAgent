import { confirm as tauriConfirm, message as tauriMessage } from "@tauri-apps/plugin-dialog";

type DialogKind = "info" | "warning" | "error";

const APP_DIALOG_TITLE = "NanoAgent";

export async function confirmAction(content: string, kind: DialogKind = "warning") {
  try {
    return await tauriConfirm(content, {
      title: APP_DIALOG_TITLE,
      kind
    });
  } catch (error) {
    console.error("Failed to show confirmation dialog:", error);
    return window.confirm(content);
  }
}

export async function showAppMessage(content: string, kind: DialogKind = "info") {
  try {
    await tauriMessage(content, {
      title: APP_DIALOG_TITLE,
      kind
    });
  } catch (error) {
    console.error("Failed to show message dialog:", error);
  }
}
