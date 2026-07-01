import { useLayoutEffect, useState } from "react";
import { setTheme } from "@tauri-apps/api/app";
import type { ThemeMode } from "../types";

const THEME_STORAGE_KEY = "nano-agent-theme";

function resolveThemeMode(themeMode: ThemeMode) {
  if (themeMode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return themeMode;
}

function applyDocumentTheme(themeMode: ThemeMode) {
  const resolvedTheme = resolveThemeMode(themeMode);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeMode = themeMode;
  return resolvedTheme;
}

function readStoredThemeMode(): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const initialTheme = readStoredThemeMode();
    applyDocumentTheme(initialTheme);
    return initialTheme;
  });

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = applyDocumentTheme(themeMode);
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);

      const tauriTheme = resolvedTheme === "light" ? "light" : "dark";
      void setTheme(tauriTheme);
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  return { themeMode, setThemeMode };
}
