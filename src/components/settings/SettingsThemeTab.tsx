import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { themeLabels } from "../../lib/appHelpers";
import type { ThemeMode } from "../../types";
import { getAutostart, setAutostart } from "../../api";

interface SettingsThemeTabProps {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

export default function SettingsThemeTab({ themeMode, setThemeMode }: SettingsThemeTabProps) {
  const [autostart, setAutostartState] = useState(false);

  useEffect(() => {
    getAutostart()
      .then(setAutostartState)
      .catch((err) => console.error("Failed to query autostart status:", err));
  }, []);

  const handleAutostartChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    try {
      await setAutostart(checked);
      setAutostartState(checked);
    } catch (err) {
      console.error("Failed to update autostart status:", err);
    }
  };

  return (
    <div className="settings-tab-content theme-tab-content">
      <h3>通用设置</h3>
      <p className="description">自定义系统主题与基础启动配置。</p>

      <h4 style={{ margin: "18px 0 8px", fontSize: "var(--font-size-lg)", color: "var(--text-primary)" }}>界面主题</h4>
      <div className="theme-switcher" role="group" aria-label="主题切换" style={{ marginBottom: "24px" }}>
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

      <h4 style={{ margin: "18px 0 8px", fontSize: "var(--font-size-lg)", color: "var(--text-primary)" }}>系统选项</h4>
      <div className="general-settings-options" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <label className="close-choice-checkbox" style={{ margin: 0, padding: 0 }}>
          <input
            type="checkbox"
            checked={autostart}
            onChange={handleAutostartChange}
          />
          <span>开机自启动</span>
        </label>
      </div>
    </div>
  );
}
