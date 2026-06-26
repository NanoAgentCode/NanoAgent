import { Save, Power, Trash2, Plus } from "lucide-react";
import { isBuiltInSkill } from "../../lib/skills";
import type { UseSkillsReturn } from "../../hooks/useSkills";

interface SettingsSkillsTabProps {
  skills: UseSkillsReturn;
}

export default function SettingsSkillsTab({ skills }: SettingsSkillsTabProps) {
  return (
    <div className="settings-tab-content skills-tab-layout">
      <div className="model-header-row">
        <h3>Skills 管理</h3>
        <button className="icon-only-btn compact" onClick={() => { skills.setIsAddingSkill(true); skills.setSelectedSkillId(""); }} title="添加自定义技能" aria-label="添加自定义技能" type="button">
          <Plus />
        </button>
      </div>
      <p className="description">配置并扩展 AI 助手的工具与自动化能力（例如内置 Anthropic 官方的 Text Editor、Bash Tool 等）。</p>
      <div className="skills-config-grid">
        <aside className="skills-config-list skills-config-list-inner">
          <div className="skills-config-list-scroll">
            {skills.skills.map((skill) => (
              <button key={skill.id} className={!skills.isAddingSkill && skill.id === skills.selectedSkillId ? "skills-config-row active" : "skills-config-row"}
                onClick={() => { skills.setIsAddingSkill(false); skills.setSelectedSkillId(skill.id); }} type="button">
                <div className="skills-config-row-header">
                  <strong>{skill.name}</strong>
                  <span className={`skills-indicator-badge ${skill.enabled ? "enabled" : "disabled"}`}>{skill.enabled ? "已启用" : "未启用"}</span>
                </div>
                <span>{skill.provider}</span>
              </button>
            ))}
          </div>
        </aside>
        <div className="skills-config-form-scroll">
          {skills.isAddingSkill ? (
            <div className="skills-add-form-inner">
              <h4 className="skills-h4-no-margin">添加自定义技能</h4>
              <div className="skills-param-field env-field-no-margin">
                <label className="skills-field-label">唯一标识符 (ID):</label>
                <input value={skills.newSkillDraft.id} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, id: e.target.value.trim().toLowerCase() }))} placeholder="例如: custom_file_helper" />
              </div>
              <div className="skills-param-field env-field-no-margin">
                <label className="skills-field-label">技能名称 (Name):</label>
                <input value={skills.newSkillDraft.name} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, name: e.target.value }))} placeholder="例如: 自定义文件助手" />
              </div>
              <div className="skills-param-field env-field-no-margin">
                <label className="skills-field-label">文档/项目链接 (Doc URL):</label>
                <input value={skills.newSkillDraft.docUrl} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, docUrl: e.target.value }))} placeholder="https://..." />
              </div>
              <div className="skills-param-field env-field-no-margin">
                <label className="skills-field-label">技能描述 (Description):</label>
                <textarea value={skills.newSkillDraft.description} onChange={(e) => skills.setNewSkillDraft(prev => ({ ...prev, description: e.target.value }))} placeholder="描述该技能的作用以及模型如何调用它..." rows={2} className="skills-textarea-custom" />
              </div>
              <div className="skills-add-form-actions">
                <button className="secondary" onClick={() => { skills.setIsAddingSkill(false); if (skills.skills.length > 0) skills.setSelectedSkillId(skills.skills[0].id); }} type="button">取消</button>
                <button className="primary" onClick={skills.handleSaveNewSkill} type="button"><Save size={15} /> 确认添加</button>
              </div>
            </div>
          ) : (() => {
            const skill = skills.skills.find((s) => s.id === skills.selectedSkillId);
            if (!skill) return <div className="empty">选择一个 Skill 以查看详情</div>;
            const isSystemSkill = isBuiltInSkill(skill.id);
            return (
              <>
                <div className="skills-form-header">
                  <div className="skills-form-title-row">
                    <h4>{skill.name}</h4>
                    <span className="skills-provider-tag">{skill.provider}</span>
                    {isSystemSkill && <span className="skills-provider-tag">系统内置</span>}
                  </div>
                  <p className="skills-desc-text">{skill.description}</p>
                  {skill.docUrl && (
                    <a href={skill.docUrl} target="_blank" rel="noopener noreferrer" className="skills-doc-link skills-link-text">查看官方文档说明 ↗</a>
                  )}
                </div>
                <div className="skills-form-section skills-form-section-margin">
                  <h5>启用状态</h5>
                  <div className="skills-switch-row">
                    <span className="skills-desc-text">{skill.enabled ? "该技能当前已激活，模型将在合适的时候自动调用" : "该技能当前已禁用"}</span>
                  </div>
                </div>
                <div className="skills-form-actions">
                  <button className={skill.enabled ? "icon-text-btn danger-btn" : "icon-text-btn"} onClick={() => skills.handleToggleSkill(skill.id, !skill.enabled)} type="button" title={skill.enabled ? "禁用技能" : "启用技能"}>
                    <Power size={18} />
                  </button>
                  {!isSystemSkill && (
                    <button className="icon-text-btn danger-btn" onClick={() => skills.handleDeleteSkill(skill.id)} type="button" title="删除技能">
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
