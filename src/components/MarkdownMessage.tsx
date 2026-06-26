import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  content: string;
}

function MarkdownMessage({ content }: MarkdownMessageProps) {
  // Pre-process content to convert single newlines to soft line breaks (two spaces followed by a newline)
  // in non-code blocks. This preserves natural line breaks during markdown rendering.
  const processedContent = useMemo(() => {
    if (!content) return "";
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts
      .map((part) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          return part;
        }
        return part.replace(/(?<!\n)\n(?!\n)/g, "  \n");
      })
      .join("");
  }, [content]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match?.[1];

          if (className) {
            return (
              <div className="code-block">
                <div className="code-block-header">
                  <span>{language || "code"}</span>
                </div>
                <pre>
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          }

          return (
            <code className="inline-code" {...props}>
              {children}
            </code>
          );
        }
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
}

export default MarkdownMessage;
