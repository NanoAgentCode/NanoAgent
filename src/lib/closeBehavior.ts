export type CloseAction = "tray" | "quit";

export const CLOSE_ACTION_KEY = "nano-agent-close-action";
export const CLOSE_SKIP_PROMPT_KEY = "nano-agent-close-skip-prompt";

export function getStoredCloseAction(): CloseAction {
  return localStorage.getItem(CLOSE_ACTION_KEY) === "quit" ? "quit" : "tray";
}

export function setStoredCloseAction(action: CloseAction) {
  localStorage.setItem(CLOSE_ACTION_KEY, action);
}

export function getStoredCloseSkipPrompt() {
  return localStorage.getItem(CLOSE_SKIP_PROMPT_KEY) === "true";
}

export function setStoredCloseSkipPrompt(skip: boolean) {
  if (skip) {
    localStorage.setItem(CLOSE_SKIP_PROMPT_KEY, "true");
  } else {
    localStorage.removeItem(CLOSE_SKIP_PROMPT_KEY);
  }
}
