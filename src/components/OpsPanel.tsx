import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, Maximize2, Minimize2, Pencil, PlugZap, Plus, Save, Server, Terminal, Trash2, X } from "lucide-react";
import {
  deleteOpsServer,
  listOpsServers,
  saveOpsServer,
  sendOpsSshInput,
  startOpsSshSession,
  stopOpsSshSession,
  testOpsSshConnection
} from "../api";
import type { OpsServer, OpsServerDraft, OpsSshEvent } from "../types";
import { confirmAction } from "../lib/dialogs";

interface OpsPanelProps {
  notice: string;
  setNotice: (message: string) => void;
}

const emptyDraft: OpsServerDraft = {
  name: "",
  host: "",
  port: 22,
  username: "",
  auth_method: "key",
  key_path: "",
  password: "",
  remote_dir: ""
};

function applyTerminalBackspaces(value: string) {
  const output: string[] = [];
  for (const char of value) {
    if (char === "\b" || char === "\u007f") {
      output.pop();
    } else {
      output.push(char);
    }
  }
  return output.join("");
}

function normalizeTerminalOutput(value: string) {
  return applyTerminalBackspaces(value)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[P\]^_][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b\[(?![0-9;]*m)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b(?!\[)[@-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g, "");
}

function terminalAnsiClasses(codes: number[], currentClasses: string[]) {
  const nextClasses = new Set(currentClasses);
  const normalizedCodes = codes.length > 0 ? codes : [0];

  for (let index = 0; index < normalizedCodes.length; index += 1) {
    const code = normalizedCodes[index];
    if (code === 0) {
      nextClasses.clear();
    } else if (code === 1) {
      nextClasses.add("ansi-bold");
    } else if (code === 2) {
      nextClasses.add("ansi-dim");
    } else if (code === 3) {
      nextClasses.add("ansi-italic");
    } else if (code === 4) {
      nextClasses.add("ansi-underline");
    } else if (code === 22) {
      nextClasses.delete("ansi-bold");
      nextClasses.delete("ansi-dim");
    } else if (code === 23) {
      nextClasses.delete("ansi-italic");
    } else if (code === 24) {
      nextClasses.delete("ansi-underline");
    } else if (code === 39) {
      Array.from(nextClasses).forEach((className) => {
        if (className.startsWith("ansi-fg-")) nextClasses.delete(className);
      });
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      Array.from(nextClasses).forEach((className) => {
        if (className.startsWith("ansi-fg-")) nextClasses.delete(className);
      });
      nextClasses.add(`ansi-fg-${code}`);
    } else if (code === 38 && normalizedCodes[index + 1] === 5 && typeof normalizedCodes[index + 2] === "number") {
      Array.from(nextClasses).forEach((className) => {
        if (className.startsWith("ansi-fg-")) nextClasses.delete(className);
      });
      nextClasses.add(`ansi-fg-256-${normalizedCodes[index + 2]}`);
      index += 2;
    }
  }

  return Array.from(nextClasses);
}

function renderTerminalOutput(value: string): ReactNode[] {
  const output = normalizeTerminalOutput(value);
  const segments: ReactNode[] = [];
  let currentClasses: string[] = [];
  let cursor = 0;
  const ansiPattern = /\x1b\[([0-9;]*)m/g;
  let match: RegExpExecArray | null;

  while ((match = ansiPattern.exec(output)) !== null) {
    if (match.index > cursor) {
      const text = output.slice(cursor, match.index);
      segments.push(
        currentClasses.length > 0
          ? <span className={currentClasses.join(" ")} key={segments.length}>{text}</span>
          : text
      );
    }

    currentClasses = terminalAnsiClasses(
      match[1].split(";").filter(Boolean).map((part) => Number(part)),
      currentClasses
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < output.length) {
    const text = output.slice(cursor);
    segments.push(
      currentClasses.length > 0
        ? <span className={currentClasses.join(" ")} key={segments.length}>{text}</span>
        : text
    );
  }

  return segments;
}

function serverToDraft(server: OpsServer): OpsServerDraft {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_method: server.auth_method,
    key_path: server.key_path,
    password: server.password,
    remote_dir: server.remote_dir
  };
}

export default function OpsPanel({ notice, setNotice }: OpsPanelProps) {
  const [servers, setServers] = useState<OpsServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [draft, setDraft] = useState<OpsServerDraft>(emptyDraft);
  const [sshOutput, setSshOutput] = useState("");
  const [sshSessionId, setSshSessionId] = useState("");
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const sshSessionIdRef = useRef("");
  const terminalRef = useRef<HTMLPreElement | null>(null);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) || null,
    [servers, selectedServerId]
  );
  const renderedSshOutput = useMemo(() => renderTerminalOutput(sshOutput), [sshOutput]);

  useEffect(() => {
    void refreshServers();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<OpsSshEvent>("ops-ssh", (event) => {
      const payload = event.payload;
      if (payload.session_id !== sshSessionIdRef.current) {
        return;
      }
      if (payload.kind === "data" || payload.kind === "ready") {
        setSshOutput((current) => current + payload.data);
      } else if (payload.kind === "error") {
        setSshOutput((current) => current + `\r\n[error] ${payload.data}\r\n`);
        setNotice(`SSH 会话错误：${payload.data}`);
      } else if (payload.kind === "closed") {
        setSshSessionId("");
        sshSessionIdRef.current = "";
        setSshOutput((current) => current + "\r\n[session closed]\r\n");
      }
      window.setTimeout(() => {
        terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight });
      }, 0);
    }).then((dispose) => {
      unlisten = dispose;
    });
    return () => {
      unlisten?.();
      if (sshSessionIdRef.current) {
        void stopOpsSshSession(sshSessionIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedServer) {
      setDraft(emptyDraft);
      return;
    }
    setDraft(serverToDraft(selectedServer));
  }, [selectedServer?.id]);

  useEffect(() => {
    if (sshSessionIdRef.current) {
      void stopOpsSshSession(sshSessionIdRef.current);
      sshSessionIdRef.current = "";
      setSshSessionId("");
    }
    setSshOutput("");
  }, [selectedServerId]);

  async function refreshServers(nextSelectedId?: string) {
    try {
      const nextServers = await listOpsServers();
      setServers(nextServers);
      setSelectedServerId((current) => {
        if (nextSelectedId && nextServers.some((server) => server.id === nextSelectedId)) {
          return nextSelectedId;
        }
        if (current && nextServers.some((server) => server.id === current)) {
          return current;
        }
        return nextServers[0]?.id || "";
      });
    } catch (error) {
      setNotice(`加载服务器列表失败：${String(error)}`);
    }
  }

  function updateDraft<K extends keyof OpsServerDraft>(key: K, value: OpsServerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleNewServer() {
    setDraft(emptyDraft);
    setShowConfigDialog(true);
  }

  async function persistDraft() {
    const saved = await saveOpsServer(draft);
    await refreshServers(saved.id);
    return saved;
  }

  async function handleSaveServer() {
    setBusyAction("save");
    try {
      await persistDraft();
      setNotice("服务器已保存。");
      setShowConfigDialog(false);
    } catch (error) {
      setNotice(`保存服务器失败：${String(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteServer() {
    if (!selectedServer) return;
    if (!(await confirmAction(`确定删除服务器「${selectedServer.name}」吗？`))) return;
    setBusyAction("delete");
    try {
      await deleteOpsServer(selectedServer.id);
      setNotice("服务器已删除。");
      await refreshServers();
      setDraft(emptyDraft);
      setSshOutput("");
      setShowConfigDialog(false);
    } catch (error) {
      setNotice(`删除服务器失败：${String(error)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function handleTestConnection() {
    setBusyAction("ssh");
    try {
      const saved = await persistDraft();
      const output = await testOpsSshConnection(saved.id);
      setSshOutput(output);
      setNotice("SSH 连接成功。");
    } catch (error) {
      const message = String(error);
      setSshOutput(message);
      setNotice(`SSH 连接失败：${message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function handleStartSshSession() {
    if (!selectedServer) {
      setNotice("请先保存并选择一台服务器。");
      return;
    }
    setBusyAction("session");
    try {
      if (sshSessionIdRef.current) {
        await stopOpsSshSession(sshSessionIdRef.current);
      }
      setSshOutput("");
      const sessionId = await startOpsSshSession(selectedServer.id);
      sshSessionIdRef.current = sessionId;
      setSshSessionId(sessionId);
      window.setTimeout(() => terminalRef.current?.focus(), 0);
    } catch (error) {
      const message = String(error);
      setSshOutput(message);
      setNotice(`SSH 会话启动失败：${message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function handleStopSshSession() {
    if (!sshSessionIdRef.current) {
      return;
    }
    const sessionId = sshSessionIdRef.current;
    sshSessionIdRef.current = "";
    setSshSessionId("");
    await stopOpsSshSession(sessionId);
  }

  function getTerminalSelection() {
    const selection = window.getSelection();
    const terminal = terminalRef.current;
    if (!selection || !terminal || selection.rangeCount === 0) {
      return "";
    }

    const range = selection.getRangeAt(0);
    if (!terminal.contains(range.commonAncestorContainer)) {
      return "";
    }

    return selection.toString();
  }

  async function copyTerminalSelection() {
    const selectedText = getTerminalSelection();
    if (!selectedText) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(selectedText);
      return true;
    } catch (error) {
      setNotice(`复制失败：${String(error)}`);
      return false;
    }
  }

  async function pasteIntoTerminal(text?: string) {
    if (!sshSessionIdRef.current) {
      setNotice("请先连接 SSH 会话。");
      return;
    }

    try {
      const clipboardText = text ?? await navigator.clipboard.readText();
      if (!clipboardText) {
        return;
      }
      await sendOpsSshInput(sshSessionIdRef.current, clipboardText);
      window.setTimeout(() => terminalRef.current?.focus(), 0);
    } catch (error) {
      setNotice(`粘贴失败：${String(error)}`);
    }
  }

  function mapTerminalKey(event: React.KeyboardEvent<HTMLElement>) {
    if (event.ctrlKey && event.key.toLowerCase() === "c") return "\u0003";
    if (event.ctrlKey && event.key.toLowerCase() === "d") return "\u0004";
    if (event.ctrlKey && event.key.toLowerCase() === "l") return "\u000c";
    if (event.key === "Enter") return "\r";
    if (event.key === "Backspace") return "\u007f";
    if (event.key === "Tab") return "\t";
    if (event.key === "ArrowUp") return "\u001b[A";
    if (event.key === "ArrowDown") return "\u001b[B";
    if (event.key === "ArrowRight") return "\u001b[C";
    if (event.key === "ArrowLeft") return "\u001b[D";
    if (event.key === "Escape") return "\u001b";
    if (!event.ctrlKey && !event.metaKey && event.key.length === 1) return event.key;
    return "";
  }

  function handleTerminalKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyTerminalSelection();
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void pasteIntoTerminal();
      return;
    }
    if (!sshSessionIdRef.current) {
      return;
    }
    const input = mapTerminalKey(event);
    if (!input) {
      return;
    }
    event.preventDefault();
    void sendOpsSshInput(sshSessionIdRef.current, input);
  }

  function handleTerminalPaste(event: React.ClipboardEvent<HTMLElement>) {
    event.preventDefault();
    void pasteIntoTerminal(event.clipboardData.getData("text"));
  }

  function handleTerminalContextMenu(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    if (getTerminalSelection()) {
      void copyTerminalSelection();
      return;
    }
    void pasteIntoTerminal();
  }

  function toggleTerminalFullscreen() {
    setTerminalFullscreen((current) => !current);
    window.setTimeout(() => terminalRef.current?.focus(), 0);
  }

  return (
    <section className={terminalFullscreen ? "ops-panel terminal-fullscreen" : "ops-panel"}>
      <header className="ops-header">
        <div>
          <Server size={20} />
          <div className="ops-header-title">
            <strong>运维区</strong>
            <span>服务器管理 · SSH 连接 · 远程命令</span>
          </div>
        </div>
      </header>

      <div className={terminalFullscreen ? "ops-layout terminal-fullscreen" : "ops-layout"}>
        <aside className="ops-server-list">
          <div className="ops-section-title">
            <div>
              <span>服务器列表</span>
              <small>{servers.length} 台</small>
            </div>
            <button className="icon-text-btn compact" type="button" onClick={handleNewServer} title="新增服务器">
              <Plus size={15} />
            </button>
          </div>
          <div className="ops-server-items">
            {servers.map((server) => (
              <div
                key={server.id}
                className={server.id === selectedServerId ? "ops-server-item active" : "ops-server-item"}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedServerId(server.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    setSelectedServerId(server.id);
                  }
                }}
              >
                <div className="ops-server-item-info">
                  <strong>{server.name}</strong>
                  <span>{server.username}@{server.host}:{server.port}</span>
                </div>
                <button
                  className="ops-server-edit-btn"
                  type="button"
                  title="编辑服务器"
                  aria-label={`编辑 ${server.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedServerId(server.id);
                    setDraft(serverToDraft(server));
                    setShowConfigDialog(true);
                  }}
                >
                  <Pencil size={15} />
                </button>
              </div>
            ))}
            {servers.length === 0 && (
              <div className="empty ops-empty">还没有服务器</div>
            )}
          </div>
        </aside>

        <div className="ops-workspace">
          <section className="ops-card">
            <div className="ops-card-header">
              <div>
                <Terminal size={17} />
                <strong>SSH 交互</strong>
              </div>
              <div className="ops-actions">
                <button
                  className="icon-text-btn compact"
                  type="button"
                  onClick={toggleTerminalFullscreen}
                  aria-label={terminalFullscreen ? "退出全屏" : "全屏"}
                  title={terminalFullscreen ? "退出全屏" : "全屏"}
                >
                  {terminalFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                {sshSessionId ? (
                  <button className="icon-text-btn danger-btn" type="button" onClick={() => void handleStopSshSession()}>
                    <X size={16} />
                    <span>断开</span>
                  </button>
                ) : (
                  <button className="icon-text-btn" type="button" onClick={() => void handleStartSshSession()} disabled={busyAction === "session" || !selectedServer}>
                    <PlugZap size={16} />
                    <span>{busyAction === "session" ? "连接中" : "连接"}</span>
                  </button>
                )}
              </div>
            </div>

            <pre
              ref={terminalRef}
              className="ops-output ops-terminal-output"
              tabIndex={0}
              onKeyDown={handleTerminalKeyDown}
              onPaste={handleTerminalPaste}
              onContextMenu={handleTerminalContextMenu}
              onClick={() => terminalRef.current?.focus()}
            >
              {sshOutput ? renderedSshOutput : "选择服务器后点击连接，在这里直接输入 SSH 交互命令。"}
            </pre>
          </section>
        </div>
        {/*
          AI 运维协作 UI 暂时隐藏，先调试服务器管理、SSH 连接和远程命令基础功能。
          后端 ask_ops_ai 命令与 API 入口保留，后续恢复 UI 时可重新接入。
        */}
      </div>
      {showConfigDialog && (
        <div className="modal-backdrop" onClick={() => setShowConfigDialog(false)}>
          <section className="ops-config-dialog" onClick={(event) => event.stopPropagation()}>
            <header className="ops-config-dialog-header">
              <div>
                <Server size={18} />
                <strong>{draft.id ? "编辑服务器" : "新增服务器"}</strong>
              </div>
              <button className="modal-close-btn" type="button" onClick={() => setShowConfigDialog(false)} aria-label="关闭" title="关闭">
                <X size={16} />
              </button>
            </header>

            <div className="ops-form-grid">
              <label>
                <span>名称</span>
                <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="生产服务器" />
              </label>
              <label>
                <span>主机</span>
                <input value={draft.host} onChange={(event) => updateDraft("host", event.target.value)} placeholder="192.168.1.10 / example.com" />
              </label>
              <label>
                <span>端口</span>
                <input type="number" min={1} max={65535} value={draft.port || 22} onChange={(event) => updateDraft("port", Number(event.target.value) || 22)} />
              </label>
              <label>
                <span>用户名</span>
                <input value={draft.username} onChange={(event) => updateDraft("username", event.target.value)} placeholder="root / ubuntu" />
              </label>
              <label>
                <span>认证方式</span>
                <select value={draft.auth_method} onChange={(event) => updateDraft("auth_method", event.target.value)}>
                  <option value="key">密钥路径</option>
                  <option value="agent">SSH Agent / 本机配置</option>
                  <option value="password">用户名密码</option>
                </select>
              </label>
              {draft.auth_method === "password" ? (
                <label>
                  <span>密码</span>
                  <input type="password" value={draft.password} onChange={(event) => updateDraft("password", event.target.value)} placeholder="服务器登录密码" />
                </label>
              ) : (
                <label>
                  <span>私钥路径</span>
                  <input value={draft.key_path} onChange={(event) => updateDraft("key_path", event.target.value)} placeholder="C:\Users\...\id_rsa" />
                </label>
              )}
              <label className="ops-form-wide">
                <span>默认远程目录</span>
                <input value={draft.remote_dir} onChange={(event) => updateDraft("remote_dir", event.target.value)} placeholder="/opt/app/" />
              </label>
            </div>

            <footer className="ops-config-dialog-footer icon-actions-bar ops-dialog-actions">
              {draft.id && selectedServer && (
                <button
                  className="icon-text-btn danger-btn"
                  type="button"
                  onClick={handleDeleteServer}
                  disabled={busyAction === "delete"}
                  aria-label="删除"
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                className="icon-text-btn"
                type="button"
                onClick={handleTestConnection}
                disabled={busyAction === "ssh" || busyAction === "save"}
                aria-label={busyAction === "ssh" ? "连接中" : "测试连接"}
                title={busyAction === "ssh" ? "连接中" : "测试连接"}
              >
                <CheckCircle2 size={16} />
              </button>
              <button className="icon-text-btn" type="button" onClick={() => setShowConfigDialog(false)} aria-label="取消" title="取消">
                <X size={16} />
              </button>
              <button
                className="icon-text-btn success-btn"
                type="button"
                onClick={handleSaveServer}
                disabled={busyAction === "save"}
                aria-label={busyAction === "save" ? "保存中" : "保存"}
                title={busyAction === "save" ? "保存中" : "保存"}
              >
                <Save size={16} />
              </button>
            </footer>
          </section>
        </div>
      )}
      {notice && <div className="notice" onClick={() => setNotice("")}>{notice}</div>}
    </section>
  );
}
