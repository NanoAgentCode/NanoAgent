import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openProjectFileLocation } from "../api";

interface MarkdownMessageProps {
  content: string;
  projectPath?: string | null;
}

const LOCAL_FILE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|pdf|html?|css|js|mjs|ts|tsx|json|md|txt|csv|xlsx?|docx?|pptx?|zip)$/i;

function isProjectRelativeFileHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  const pathOnly = trimmed.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  if (!pathOnly || pathOnly.startsWith("/") || pathOnly.includes(":")) return false;
  return LOCAL_FILE_EXTENSION.test(pathOnly);
}

function decodeProjectHref(href: string) {
  const pathOnly = href.trim().split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    return pathOnly;
  }
}

function MarkdownMessage({ content, projectPath }: MarkdownMessageProps) {
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
        a({ href, children, ...props }) {
          const isLocalFile = href ? isProjectRelativeFileHref(href) : false;
          if (href && isLocalFile && projectPath) {
            const relativePath = decodeProjectHref(href);
            return (
              <button
                className="local-file-link"
                type="button"
                title={`打开所在文件夹: ${relativePath}`}
                onClick={() => {
                  void openProjectFileLocation(projectPath, relativePath).catch((error) => {
                    console.error("Failed to open local file location:", error);
                  });
                }}
              >
                {children}
              </button>
            );
          }

          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        },
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
