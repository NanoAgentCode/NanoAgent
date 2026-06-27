import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Global styles
import "./styles/main.css";

// Component styles
import "./components/Sidebar.css";
import "./components/ChatPane.css";
import "./components/OpsPanel.css";
import "./components/WorkspaceGrid.css";
import "./components/AgentRuntimePanel.css";
import "./components/ObservabilityPanel.css";
import "./components/ObservabilityDetailPanel.css";
import "./components/settings/SettingsModal.css";
import "./components/settings/SettingsSkillsTab.css";
import "./components/settings/SettingsMcpTab.css";
import "./components/settings/SettingsEnvironmentTab.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
