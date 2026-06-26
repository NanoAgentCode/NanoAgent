import { Activity, Loader2, Save } from "lucide-react";
import type { UseModelReturn } from "../../hooks/useModel";

interface SettingsEmbeddingTabProps {
  model: UseModelReturn;
}

export default function SettingsEmbeddingTab({ model }: SettingsEmbeddingTabProps) {
  return (
    <div className="settings-tab-content model-tab-content">
      <div className="model-header-row"><h3>嵌入模型</h3></div>
      <p className="description description--tight">配置全局唯一嵌入模型 API，用于轻量 RAG 的文档向量化与匹配。</p>
      <div className="embedding-config-card">
        <div className="model-config-form embedding-config-form">
          <div className="model-form-card">
            <label>
              <span>协议类型</span>
              <select value={model.embeddingDraft.embedding_provider} onChange={(event) => model.handleEmbeddingProviderChange(event.target.value)} disabled>
                <option value="openai-compatible">OpenAI 兼容协议</option>
              </select>
            </label>
            <label>
              <span>接口地址</span>
              <input value={model.embeddingDraft.embedding_base_url} onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_base_url: event.target.value })} placeholder="https://api.openai.com/v1" />
            </label>
            <label>
              <span>模型标识</span>
              <input value={model.embeddingDraft.embedding_model} onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_model: event.target.value })} placeholder="text-embedding-3-small" />
            </label>
            <label>
              <span>API Key</span>
              <input value={model.embeddingDraft.embedding_api_key} type="password" onChange={(event) => model.setEmbeddingDraft({ ...model.embeddingDraft, embedding_api_key: event.target.value })} placeholder="用于 RAG 向量化，可与大模型不同" />
            </label>
          </div>
          <div className="modal-actions icon-actions icon-actions-bar">
            {model.embeddingTestStatus.status === "success" && (
              <span className="status-text-panel status-text-panel--success">
                <span className="status-dot status-dot--success" />连通性正常
              </span>
            )}
            {model.embeddingTestStatus.status === "error" && (
              <span className="status-text-panel status-text-panel--error" title={model.embeddingTestStatus.message}>
                <span className="status-dot status-dot--error" />连通性异常 (悬浮查看详情)
              </span>
            )}
            {(model.embeddingTestStatus.status === "idle" || model.embeddingTestStatus.status === "testing") && <div className="status-spacer" />}
            <button className="icon-text-btn" onClick={model.handleTestEmbedding} disabled={model.embeddingTestStatus.status === "testing"} title="测试连接" type="button">
              {model.embeddingTestStatus.status === "testing" ? <Loader2 className="svg-spin" /> : <Activity />}
              <span>{model.embeddingTestStatus.status === "testing" ? "测试中..." : "测试连接"}</span>
            </button>
            <button className="icon-text-btn success-btn" onClick={model.handleSaveEmbeddingModel} title="保存并使用" type="button">
              <Save /><span>保存并使用</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
