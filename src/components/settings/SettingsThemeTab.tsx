import { Monitor, Moon, Sun } from "lucide-react";
import { themeLabels } from "../../lib/appHelpers";
import type { ThemeMode } from "../../types";

interface SettingsThemeTabProps {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

export default function SettingsThemeTab({ themeMode, setThemeMode }: SettingsThemeTabProps) {
  return (
    <div className="settings-tab-content theme-tab-content">
      <h3>主题选择</h3>
      <p className="description">自定义NanoAgent的外观显示，适配各种工作环境。</p>
      <div className="theme-switcher" role="group" aria-label="主题切换">
        {(["system", "light", "dark"] as ThemeMode[]).map((mode) => {
          const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
          return (
            <button
              key={mode}
              className={themeMode === mode ? "active" : ""}
              onClick={() => setThemeMode(mode)}
              type="button"
            >
              <Icon size={15} />
              {themeLabels[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
