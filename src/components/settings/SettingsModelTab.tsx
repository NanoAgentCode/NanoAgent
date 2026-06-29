import { Activity, Edit3, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { normalizeModelDraft } from "../../hooks/useModel";
import type { UseModelReturn } from "../../hooks/useModel";

interface SettingsModelTabProps {
  model: UseModelReturn;
  setShowModelConfig: (show: boolean) => void;
}

export default function SettingsModelTab({ model, setShowModelConfig }: SettingsModelTabProps) {
  const llmModels = model.models.filter((m) => m.id !== "embedding-config");
  const isEditingModel = Boolean(model.modelDraft.id && model.modelDraft.id !== "embedding-config");

  return (
    <div className="settings-tab-content model-tab-content">
      <div className="model-header-row">
        <h3>LLM管理</h3>
        <button className="model-action-btn model-action-btn--new" onClick={() => model.handleNewModelConfig(setShowModelConfig)} title="新建模型配置" type="button">
          <Plus size={15} />
          <span>新建模型</span>
        </button>
      </div>
      <p className="description description--tight">配置用于聊天对话的大语言模型，供 AI 助手和会话调用。</p>
      <div className="model-config-grid llm-config-grid">
        <aside className="model-config-list">
          {llmModels.map((m) => {
            const statusInfo = model.modelTestStatuses[m.id] || { status: "idle" };
            let dotColor = "#9ca3af";
            let dotTitle = "未测试";
            if (statusInfo.status === "testing") {
              dotColor = "#3b82f6";
              dotTitle = "测试中...";
            } else if (statusInfo.status === "success") {
              dotColor = "var(--accent-green, #10b981)";
              dotTitle = "连通性正常";
            } else if (statusInfo.status === "error") {
              dotColor = "var(--accent-red, #ef4444)";
              dotTitle = `连通性异常: ${statusInfo.message || ""}`;
            }
            return (
              <button
                key={m.id}
                className={m.id === model.activeModelId ? "model-config-row active" : "model-config-row"}
                onClick={() => {
                  model.setModelDraft(normalizeModelDraft(m));
                  void model.handleActiveModelChange(m.id);
                }}
                title={m.id === model.activeModelId ? "当前使用中" : "切换到此模型"}
                type="button"
              >
                <span className={`status-dot status-dot--${statusInfo.status}`} title={dotTitle} />
                <div className="model-config-row-info">
                  <div className="model-config-row-title">
                    <strong>{m.name}</strong>
                    {m.id === model.activeModelId && <span className="model-active-badge">使用中</span>}
                  </div>
                  <span>{m.provider} / {m.model}</span>
                </div>
              </button>
            );
          })}
          {llmModels.length === 0 && <div className="empty">暂无大模型配置</div>}
        </aside>

        <div className="model-config-form">
          <div className="model-form-card">
            <label>
              <span>配置名称</span>
              <input value={model.modelDraft.name} onChange={(event) => model.setModelDraft({ ...model.modelDraft, name: event.target.value })} placeholder="例如：OpenAI 主账号" />
            </label>
            <label>
              <span>协议类型</span>
              <select value={model.modelDraft.provider} onChange={(event) => model.handleProviderChange(event.target.value)}>
                <option value="openai-compatible">OpenAI 兼容协议</option>
                <option value="anthropic">Anthropic 兼容协议</option>
              </select>
            </label>
            <label>
              <span>接口地址</span>
              <input value={model.modelDraft.base_url} onChange={(event) => model.setModelDraft({ ...model.modelDraft, base_url: event.target.value })} placeholder="https://api.openai.com/v1" />
            </label>
            <label>
              <span>模型标识</span>
              <input value={model.modelDraft.model} onChange={(event) => model.setModelDraft({ ...model.modelDraft, model: event.target.value })} placeholder="gpt-4o-mini" />
            </label>
            <label>
              <span>API Key</span>
              <input value={model.modelDraft.api_key} type="password" onChange={(event) => model.setModelDraft({ ...model.modelDraft, api_key: event.target.value })} placeholder="用于对话模型调用" />
            </label>
          </div>
          <div className="modal-actions icon-actions icon-actions-bar">
            {model.llmTestStatus.status === "success" && (
              <span className="status-text-panel status-text-panel--success">
                <span className="status-dot status-dot--success" />连通性正常
              </span>
            )}
            {model.llmTestStatus.status === "error" && (
              <span className="status-text-panel status-text-panel--error" title={model.llmTestStatus.message}>
                <span className="status-dot status-dot--error" />连通性异常 (悬浮查看详情)
              </span>
            )}
            {(model.llmTestStatus.status === "idle" || model.llmTestStatus.status === "testing") && <div className="status-spacer" />}
            <button className="model-action-btn model-action-btn--test" onClick={model.handleTestLlm} disabled={model.llmTestStatus.status === "testing"} title="测试连接" type="button">
              {model.llmTestStatus.status === "testing" ? <Loader2 className="svg-spin" /> : <Activity />}
              <span>测试</span>
            </button>
            <button className="model-action-btn model-action-btn--save" onClick={model.handleSaveModel} title={isEditingModel ? "保存修改并使用" : "创建模型并使用"} type="button">
              {isEditingModel ? <Edit3 /> : <Save />}
              <span>{isEditingModel ? "保存修改" : "创建模型"}</span>
            </button>
            <button className="model-action-btn model-action-btn--delete" title="删除模型" onClick={model.handleDeleteModel} disabled={!isEditingModel} type="button">
              <Trash2 />
              <span>删除模型</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
