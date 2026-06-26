import { useEffect, useState, useMemo } from "react";
import { listLocalSkills } from "../api";
import {
  defaultSkills,
  isBuiltInSkill,
  normalizeSkills,
  type Skill
} from "../lib/skills";

export interface UseSkillsReturn {
  skills: Skill[];
  setSkills: React.Dispatch<React.SetStateAction<Skill[]>>;
  selectedSkillId: string;
  setSelectedSkillId: React.Dispatch<React.SetStateAction<string>>;
  isAddingSkill: boolean;
  setIsAddingSkill: React.Dispatch<React.SetStateAction<boolean>>;
  newSkillDraft: {
    id: string;
    name: string;
    provider: string;
    description: string;
    docUrl: string;
  };
  setNewSkillDraft: React.Dispatch<React.SetStateAction<{
    id: string;
    name: string;
    provider: string;
    description: string;
    docUrl: string;
  }>>;
  skillsDir: string;
  tempDir: string;
  checkLocalSkills: () => Promise<void>;
  handleToggleSkill: (id: string, enabled: boolean) => void;
  handleDeleteSkill: (id: string) => void;
  handleSaveNewSkill: () => void;
}

export function useSkills(setNotice: (message: string) => void): UseSkillsReturn {
  const [skillsDir, setSkillsDir] = useState<string>("");
  const [selectedSkillId, setSelectedSkillId] = useState<string>("text_editor");
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [newSkillDraft, setNewSkillDraft] = useState<{
    id: string;
    name: string;
    provider: string;
    description: string;
    docUrl: string;
  }>({
    id: "",
    name: "",
    provider: "Custom",
    description: "",
    docUrl: ""
  });

  const [skills, setSkills] = useState<Skill[]>(() => {
    const saved = localStorage.getItem("nano-agent-skills");
    if (saved) {
      try {
        return normalizeSkills(JSON.parse(saved) as Skill[]);
      } catch (e) {
        console.error("Failed to parse skills from localStorage", e);
      }
    }
    return defaultSkills;
  });

  const tempDir = useMemo(() => {
    return skillsDir
      ? skillsDir.replace(/[\\/]skills$/, "") + (skillsDir.includes("/") ? "/temp" : "\\temp")
      : "C:\\Users\\13439\\Desktop\\temp";
  }, [skillsDir]);

  // Cleanup computer_use logic and check local skills on mount
  useEffect(() => {
    const saved = localStorage.getItem("nano-agent-skills");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Skill[];
        if (parsed.some((s) => s.id === "computer_use")) {
          localStorage.removeItem("nano-agent-skills");
          setSkills(defaultSkills);
          setSelectedSkillId("text_editor");
        }
      } catch (e) {
        // ignore
      }
    }
    void checkLocalSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkLocalSkills() {
    try {
      const [dir, localSkills] = await listLocalSkills();
      setSkillsDir(dir);
      setSkills((current) => {
        const skillMap = new Map(current.map((s) => [s.id, s]));
        const scannedLocalIds = new Set<string>();

        localSkills.forEach((localSkill) => {
          const id = `local_${localSkill.slug}`;
          scannedLocalIds.add(id);

          if (!skillMap.has(id)) {
            skillMap.set(id, {
              id,
              name: localSkill.name,
              provider: "Local",
              description: localSkill.description,
              enabled: true,
              parameters: {
                workspace_root: "C:\\Users\\13439\\Desktop"
              },
              docUrl: localSkill.doc_url
            });
          } else {
            const existing = skillMap.get(id);
            if (existing) {
              skillMap.set(id, {
                ...existing,
                name: localSkill.name || existing.name,
                description: localSkill.description || existing.description,
                docUrl: localSkill.doc_url || existing.docUrl
              });
            }
          }
        });

        // Remove local skills that are no longer in the directory
        Array.from(skillMap.keys()).forEach((id) => {
          if (id.startsWith("local_") && !scannedLocalIds.has(id)) {
            skillMap.delete(id);
          }
        });

        // Update default skill_creator's skills_root parameter dynamically
        const skillCreator = skillMap.get("skill_creator");
        if (skillCreator && skillCreator.parameters.skills_root !== dir) {
          skillMap.set("skill_creator", {
            ...skillCreator,
            parameters: {
              ...skillCreator.parameters,
              skills_root: dir
            }
          });
        }

        const merged = Array.from(skillMap.values());
        localStorage.setItem("nano-agent-skills", JSON.stringify(merged));
        return merged;
      });
    } catch (error) {
      console.error("Failed to check local skills:", error);
    }
  }

  function handleToggleSkill(id: string, enabled: boolean) {
    const nextSkills = skills.map((s) =>
      s.id === id ? { ...s, enabled } : s
    );
    setSkills(nextSkills);
    localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
  }

  function handleDeleteSkill(id: string) {
    if (isBuiltInSkill(id)) {
      setNotice("系统内置技能只能禁用，不能删除。");
      return;
    }

    if (confirm("确定要删除该技能吗？")) {
      const nextSkills = skills.filter((s) => s.id !== id);
      setSkills(nextSkills);
      localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
      if (selectedSkillId === id) {
        setSelectedSkillId(nextSkills.length > 0 ? nextSkills[0].id : "");
      }
      setNotice("技能已成功删除！");
    }
  }

  function handleSaveNewSkill() {
    if (!newSkillDraft.id || !newSkillDraft.name) {
      alert("请填写技能ID和技能名称！");
      return;
    }
    
    if (skills.some((s) => s.id === newSkillDraft.id)) {
      alert("该技能ID已存在，请使用其他ID！");
      return;
    }

    const newSkill: Skill = {
      id: newSkillDraft.id,
      name: newSkillDraft.name,
      provider: "Custom",
      description: newSkillDraft.description || "自定义导入的技能工具。",
      enabled: true,
      parameters: {},
      docUrl: newSkillDraft.docUrl
    };

    const nextSkills = [...skills, newSkill];
    setSkills(nextSkills);
    localStorage.setItem("nano-agent-skills", JSON.stringify(nextSkills));
    
    setIsAddingSkill(false);
    setSelectedSkillId(newSkill.id);
    
    setNewSkillDraft({
      id: "",
      name: "",
      provider: "Custom",
      description: "",
      docUrl: ""
    });

    setNotice("自定义技能添加成功！");
  }

  return {
    skills,
    setSkills,
    selectedSkillId,
    setSelectedSkillId,
    isAddingSkill,
    setIsAddingSkill,
    newSkillDraft,
    setNewSkillDraft,
    skillsDir,
    tempDir,
    checkLocalSkills,
    handleToggleSkill,
    handleDeleteSkill,
    handleSaveNewSkill
  };
}
