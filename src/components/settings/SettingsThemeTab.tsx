import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { themeLabels } from "../../lib/appHelpers";
import type { ThemeMode } from "../../types";
import { getAutostart, setAutostart } from "../../api";
import {
  getStoredCloseAction,
  getStoredCloseSkipPrompt,
  setStoredCloseAction,
  setStoredCloseSkipPrompt,
  subscribeClosePreferencesChanged,
  type CloseAction
} from "../../lib/closeBehavior";

interface SettingsThemeTabProps {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

export default function SettingsThemeTab({ themeMode, setThemeMode }: SettingsThemeTabProps) {
  const [autostart, setAutostartState] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartLoaded, setAutostartLoaded] = useState(false);
  const [closeAction, setCloseAction] = useState<CloseAction>(() => getStoredCloseAction());
  const [closeSkipPrompt, setCloseSkipPrompt] = useState(() => getStoredCloseSkipPrompt());

  useEffect(() => {
    let active = true;
    getAutostart()
      .then((enabled) => {
        if (active) {
          setAutostartState(enabled);
        }
      })
      .catch((err) => console.error("Failed to query autostart status:", err))
      .finally(() => {
        if (active) {
          setAutostartLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return subscribeClosePreferencesChanged((preferences) => {
      setCloseAction(preferences.action);
      setCloseSkipPrompt(preferences.skipPrompt);
    });
  }, []);

  const handleAutostartChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    setAutostartBusy(true);
    setAutostartState(checked);
    try {
      await setAutostart(checked);
    } catch (err) {
      console.error("Failed to update autostart status:", err);
      setAutostartState(!checked);
    } finally {
      setAutostartBusy(false);
    }
  };

  const handleCloseActionChange = (action: CloseAction) => {
    setCloseAction(action);
    setStoredCloseAction(action);
  };

  const handleCloseSkipPromptChange = (checked: boolean) => {
    setCloseSkipPrompt(checked);
    setStoredCloseSkipPrompt(checked);
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
        <div className="close-choice-options" role="radiogroup" aria-label="右上角关闭按钮行为" style={{ gap: "8px" }}>
          <label className="close-choice-option">
            <input
              type="radio"
              name="settings-close-action"
              checked={closeAction === "tray"}
              onChange={() => handleCloseActionChange("tray")}
            />
            <span>关闭按钮最小化到系统托盘</span>
          </label>
          <label className="close-choice-option">
            <input
              type="radio"
              name="settings-close-action"
              checked={closeAction === "quit"}
              onChange={() => handleCloseActionChange("quit")}
            />
            <span>关闭按钮退出应用</span>
          </label>
        </div>
        <label className="close-choice-checkbox" style={{ margin: 0, padding: 0 }}>
          <input
            type="checkbox"
            checked={closeSkipPrompt}
            onChange={(event) => handleCloseSkipPromptChange(event.target.checked)}
          />
          <span>关闭时不再提示</span>
        </label>
        <label className="close-choice-checkbox" style={{ margin: 0, padding: 0 }}>
          <input
            type="checkbox"
            checked={autostart}
            onChange={handleAutostartChange}
            disabled={!autostartLoaded || autostartBusy}
          />
          <span>开机自启动</span>
        </label>
      </div>
    </div>
  );
}
