import { useState } from "react";
import { listItems } from "../api";
import type { Item } from "../types";

export interface UseChatInputReturn {
  chatInput: string;
  setChatInput: React.Dispatch<React.SetStateAction<string>>;
  promptSuggestions: Item[];
  setPromptSuggestions: React.Dispatch<React.SetStateAction<Item[]>>;
  selectedPromptIndex: number;
  setSelectedPromptIndex: React.Dispatch<React.SetStateAction<number>>;
  promptTriggerIndex: number;
  setPromptTriggerIndex: React.Dispatch<React.SetStateAction<number>>;
  handleInputChange: (value: string, cursorIndex: number) => Promise<void>;
  handleChatInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  insertPrompt: (item: Item) => void;
}

export function useChatInput(): UseChatInputReturn {
  const [chatInput, setChatInput] = useState("");
  const [promptSuggestions, setPromptSuggestions] = useState<Item[]>([]);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState(0);
  const [promptTriggerIndex, setPromptTriggerIndex] = useState(-1);

  async function handleInputChange(value: string, cursorIndex: number) {
    setChatInput(value);

    const textBeforeCursor = value.substring(0, cursorIndex);
    const lastHashIndex = textBeforeCursor.lastIndexOf("#");

    if (lastHashIndex !== -1) {
      const charBeforeHash = lastHashIndex > 0 ? textBeforeCursor[lastHashIndex - 1] : "";
      const isWordStart = lastHashIndex === 0 || /\s/.test(charBeforeHash);
      const textAfterHash = textBeforeCursor.substring(lastHashIndex + 1);

      if (isWordStart && !/\s/.test(textAfterHash)) {
        setPromptTriggerIndex(lastHashIndex);
        try {
          const allPrompts = await listItems("prompt");
          const search = textAfterHash.toLowerCase();
          const filtered = allPrompts.filter((p) =>
            p.title.toLowerCase().includes(search) ||
            p.body.toLowerCase().includes(search)
          );
          setPromptSuggestions(filtered);
          setSelectedPromptIndex(0);
        } catch (e) {
          console.error("Failed to list prompts", e);
        }
        return;
      }
    }

    setPromptSuggestions([]);
    setPromptTriggerIndex(-1);
  }

  function handleChatInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (promptSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = (selectedPromptIndex + 1) % promptSuggestions.length;
        setSelectedPromptIndex(nextIndex);
        setTimeout(() => {
          const activeEl = document.querySelector(".prompt-suggestion-item.selected");
          if (activeEl) {
            activeEl.scrollIntoView({ block: "nearest" });
          }
        }, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = (selectedPromptIndex - 1 + promptSuggestions.length) % promptSuggestions.length;
        setSelectedPromptIndex(nextIndex);
        setTimeout(() => {
          const activeEl = document.querySelector(".prompt-suggestion-item.selected");
          if (activeEl) {
            activeEl.scrollIntoView({ block: "nearest" });
          }
        }, 0);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = promptSuggestions[selectedPromptIndex];
        if (selected) {
          insertPrompt(selected);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setPromptSuggestions([]);
        setPromptTriggerIndex(-1);
      }
    }
    // Note: Enter-to-send is handled by the parent (useChat)
  }

  function insertPrompt(item: Item) {
    if (promptTriggerIndex === -1) return;
    const value = chatInput;
    const beforeTrigger = value.substring(0, promptTriggerIndex);

    const textarea = document.querySelector(".chat-input textarea") as HTMLTextAreaElement | null;
    const selectionEnd = textarea?.selectionEnd || value.length;
    const afterCursor = value.substring(selectionEnd);

    const nextValue = beforeTrigger + item.body + " " + afterCursor;
    setChatInput(nextValue);
    setPromptSuggestions([]);
    setPromptTriggerIndex(-1);

    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        const nextCursorIndex = beforeTrigger.length + item.body.length + 1;
        textarea.setSelectionRange(nextCursorIndex, nextCursorIndex);
      }
    }, 0);
  }

  return {
    chatInput,
    setChatInput,
    promptSuggestions,
    setPromptSuggestions,
    selectedPromptIndex,
    setSelectedPromptIndex,
    promptTriggerIndex,
    setPromptTriggerIndex,
    handleInputChange,
    handleChatInputKeyDown,
    insertPrompt
  };
}
