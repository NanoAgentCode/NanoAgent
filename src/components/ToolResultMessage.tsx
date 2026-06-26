import MarkdownMessage from "../MarkdownMessage";
import type { ParsedToolResult } from "../lib/messageHelpers";

export default function ToolResultMessage({ result }: { result: ParsedToolResult }) {
  return (
    <details className={`tool-result-panel ${result.status}`}>
      <summary className="tool-result-summary">
        <span className="tool-result-title">工具执行结果</span>
        <code>{result.name}</code>
        <span className="tool-result-status">{result.summary}</span>
      </summary>
      <div className="tool-result-detail">
        <MarkdownMessage content={result.detail || "无输出"} />
      </div>
    </details>
  );
}
