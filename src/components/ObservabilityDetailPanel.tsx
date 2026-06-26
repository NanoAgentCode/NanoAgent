import { useState } from "react";

interface DetailSection {
  label: string;
  type: string;
  content: string;
  icon?: string;
}

function parseDetailSections(detail: string): DetailSection[] {
  const prefixes = [
    { key: "输入：", label: "输入 (Input)", type: "input", icon: "📥" },
    { key: "输出：", label: "输出 (Output)", type: "output", icon: "📤" },
    { key: "错误：", label: "错误 (Error)", type: "error", icon: "❌" },
    { key: "元数据：", label: "元数据 (Metadata)", type: "metadata", icon: "⚙️" },
    { key: "args: ", label: "参数 (Arguments)", type: "args", icon: "🔧" },
    { key: "error: ", label: "错误 (Error)", type: "error", icon: "❌" }
  ];

  const matches: { index: number; key: string; label: string; type: string; icon: string }[] = [];

  prefixes.forEach((pref) => {
    let pos = detail.indexOf(pref.key);
    while (pos !== -1) {
      matches.push({ index: pos, ...pref });
      pos = detail.indexOf(pref.key, pos + 1);
    }
  });

  matches.sort((a, b) => a.index - b.index);

  if (matches.length === 0) {
    return [{ label: "详情 (Detail)", type: "general", content: detail.trim() }];
  }

  const sections: DetailSection[] = [];

  const firstMatchIndex = matches[0].index;
  if (firstMatchIndex > 0) {
    const leadContent = detail.substring(0, firstMatchIndex).trim();
    if (leadContent) {
      sections.push({ label: "详情 (Detail)", type: "general", content: leadContent });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const startIndex = currentMatch.index + currentMatch.key.length;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : detail.length;

    const content = detail.substring(startIndex, endIndex).trim();
    sections.push({
      label: currentMatch.label,
      type: currentMatch.type,
      content,
      icon: currentMatch.icon
    });
  }

  return sections;
}

export default function ObservabilityDetailPanel({ detail }: { detail: string }) {
  const sections = parseDetailSections(detail);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="trace-detail-panel">
      {sections.map((section, idx) => {
        let isJson = false;
        let formattedContent = section.content;

        if (
          section.type === "metadata" ||
          section.type === "args" ||
          section.content.startsWith("{") ||
          section.content.startsWith("[")
        ) {
          try {
            const parsed = JSON.parse(section.content);
            formattedContent = JSON.stringify(parsed, null, 2);
            isJson = true;
          } catch {
            // Keep original text when detail content is not valid JSON.
          }
        }

        const isError = section.type === "error";

        return (
          <div key={idx} className={`trace-detail-section ${section.type} ${isError ? "error" : ""}`}>
            <div className="trace-detail-section-header">
              <span className="trace-detail-section-title">
                {section.icon && <span className="trace-detail-section-icon">{section.icon}</span>}
                {section.label}
              </span>
              <button
                className="trace-detail-copy-btn"
                onClick={() => handleCopy(formattedContent, idx)}
                type="button"
                title="复制内容"
              >
                {copiedIndex === idx ? "已复制 ✓" : "复制"}
              </button>
            </div>
            <div className="trace-detail-section-body">
              <pre className={isJson ? "json" : ""}>{formattedContent}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
