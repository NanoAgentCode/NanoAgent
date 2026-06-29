import { AlertTriangle, Braces, Check, Info, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { formatMcpTransportLabel } from "../../lib/formatters";
import type { UseMcpReturn } from "../../hooks/useMcp";

interface SettingsMcpTabProps {
  mcp: UseMcpReturn;
}

export default function SettingsMcpTab({ mcp }: SettingsMcpTabProps) {
  return (
    <div className="settings-tab-content model-tab-content">
      <div className="model-header-row">
        <h3>MCP 配置</h3>
        <button className="icon-only-btn compact" onClick={mcp.handleNewMcpServer} title="添加 MCP 服务器" aria-label="添加 MCP 服务器" type="button"><Plus /></button>
      </div>
      <p className="description description--tight">连接符合 Model Context Protocol 规范的工具服务器，支持 stdio、SSE 和 Streamable HTTP。</p>
      <div className="model-config-grid mcp-config-grid">
        <aside className="model-config-list">
          {mcp.mcpServers.map((server) => {
            const connected = server.status.connected;
            const busy = mcp.mcpBusyId === server.config.id;
            return (
              <button key={server.config.id} className={server.config.id === mcp.selectedMcpServerId ? "mcp-config-row active" : "mcp-config-row"}
                onClick={() => mcp.setSelectedMcpServerId(server.config.id)} type="button">
                <div className="mcp-config-row-header">
                  <strong>{server.config.name}</strong>
                  <button className={connected ? "mcp-connection-badge connected" : "mcp-connection-badge"}
                    onClick={(event) => { event.stopPropagation(); if (connected) { void mcp.handleDisconnectMcpServer(server.config.id); } else { void mcp.handleConnectMcpServer(server.config.id); } }}
                    disabled={busy} title={connected ? "断开 MCP 服务器" : "连接 MCP 服务器"} type="button">
                    {busy ? <Loader2 className="svg-spin mcp-loader-small" /> : <span className="mcp-pill-indicator" />}
                    <span>{connected ? "已连接" : "未连接"}</span>
                  </button>
                </div>
                <span title={server.config.command || server.config.url}>{formatMcpTransportLabel(server.config.transport)} · {server.config.command || server.config.url} · {server.tools.length} tools</span>
                {server.status.error && (
                  <span className="mcp-row-error" title={server.status.error}>启动失败</span>
                )}
              </button>
            );
          })}
          {mcp.mcpServers.length === 0 && <div className="empty">暂无 MCP 服务器配置</div>}
        </aside>
        <div className="model-config-form">
          <div className="model-form-card mcp-form-card">
            <label><span>服务名称</span>
              <input value={mcp.mcpDraft.name} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, name: event.target.value })} placeholder="amap-maps" />
            </label>
            <label><span>协议</span>
              <select value={mcp.mcpDraft.transport} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, transport: event.target.value })}>
                <option value="stdio">stdio 本地进程</option>
                <option value="sse">SSE</option>
                <option value="streamable_http">Streamable HTTP</option>
              </select>
            </label>
            {mcp.mcpDraft.transport === "stdio" ? (
              <>
                <label><span>命令</span>
                  <textarea value={mcp.stdioCommandLine} onChange={(event) => mcp.setStdioCommandLine(event.target.value)} rows={2}
                    placeholder={"npx -y @modelcontextprotocol/server-filesystem C:\\Users\\13439\\Desktop"} spellCheck={false} />
                </label>
                <label><span>环境变量 JSON</span>
                  <textarea value={mcp.mcpDraft.env_json} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, env_json: event.target.value })} rows={2} placeholder={'{"API_KEY": "..."}'} />
                </label>
                <label><span>工作目录</span>
                  <input value={mcp.mcpDraft.working_dir} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, working_dir: event.target.value })} placeholder="可选" />
                </label>
              </>
            ) : (
              <>
                <label><span>地址</span>
                  <input value={mcp.mcpDraft.url} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, url: event.target.value })}
                    placeholder={mcp.mcpDraft.transport === "sse" ? "https://example.com/sse" : "https://example.com/mcp"} />
                </label>
                <label><span>请求头 JSON</span>
                  <textarea value={mcp.mcpDraft.headers_json} onChange={(event) => mcp.setMcpDraft({ ...mcp.mcpDraft, headers_json: event.target.value })} rows={2} placeholder={'{"Authorization": "Bearer ..."}'} />
                </label>
              </>
            )}
            <label><span>配置 JSON</span>
              <textarea value={mcp.mcpConfigJson} onChange={(event) => mcp.setMcpConfigJson(event.target.value)} rows={10} spellCheck={false} />
            </label>
            <div className="mcp-json-actions icon-actions-bar">
              <button className="icon-only-btn compact" onClick={mcp.handleApplyMcpConfigJson} title="应用 JSON 配置" aria-label="应用 JSON 配置" type="button"><Check /></button>
              <button className="icon-only-btn compact" onClick={mcp.handleFormatMcpConfigJson} title="从表单格式化 JSON" aria-label="从表单格式化 JSON" type="button"><Braces /></button>
            </div>
            {mcp.selectedMcpServer?.status.error && (
              <div className="mcp-error-panel" role="status">
                <div className="mcp-error-panel-header">
                  <AlertTriangle />
                  <strong>启动诊断</strong>
                </div>
                <pre>{mcp.selectedMcpServer.status.error}</pre>
              </div>
            )}
          </div>
          <div className="modal-actions icon-actions mcp-actions icon-actions-bar">
            <div className="mcp-action-status">
              {mcp.selectedMcpServer?.status.error && (
                <span className="mcp-status-text error" title={mcp.selectedMcpServer.status.error}>启动失败</span>
              )}
              {mcp.selectedMcpServer && (
                <div className="mcp-tools-tooltip-wrap">
                  <button className="icon-only-btn compact" type="button" aria-label="查看工具详情" title="查看工具详情"><Info /></button>
                  <div className="mcp-tools-tooltip" role="tooltip">
                    <div className="mcp-tools-tooltip-header">
                      <strong>工具详情{mcp.selectedMcpServer.status.connected ? ` · ${mcp.selectedMcpServer.tools.length}` : ""}</strong>
                      {mcp.selectedMcpServer.status.connected && (
                        <button className="icon-only-btn compact" onClick={() => void mcp.handleRefreshMcpTools(mcp.selectedMcpServer!.config.id)}
                          disabled={mcp.mcpBusyId === mcp.selectedMcpServer.config.id} type="button" title="刷新工具列表" aria-label="刷新工具列表">
                          {mcp.mcpBusyId === mcp.selectedMcpServer.config.id ? <Loader2 className="svg-spin" /> : <RotateCcw />}
                        </button>
                      )}
                    </div>
                    {!mcp.selectedMcpServer.status.connected && <div className="mcp-tools-tooltip-empty">连接后可查看工具</div>}
                    {mcp.selectedMcpServer.status.connected && mcp.selectedMcpServer.tools.length === 0 && <div className="mcp-tools-tooltip-empty">该服务器暂未暴露工具</div>}
                    {mcp.selectedMcpServer.status.connected && mcp.selectedMcpServer.tools.length > 0 && (
                      <div className="mcp-tools-tooltip-list">
                        {mcp.selectedMcpServer.tools.map((tool) => (
                          <div key={`${tool.server_id}:${tool.name}`} className="mcp-tools-tooltip-item">
                            <strong>{tool.name}</strong>
                            {tool.description && <span>{tool.description}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button className="icon-text-btn success-btn" onClick={mcp.handleSaveMcpServer} title="保存配置" type="button"><Save /></button>
            <button className="icon-text-btn danger-btn" title="删除 MCP 服务器" onClick={mcp.handleDeleteMcpServer} disabled={mcp.mcpBusyId === mcp.mcpDraft.id} type="button"><Trash2 /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
