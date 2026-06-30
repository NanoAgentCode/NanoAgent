import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import MarkdownMessage from "./MarkdownMessage";
import { readChatImageAttachment } from "../api";

interface ImageAttachmentMessageProps {
  content: string;
  projectPath?: string | null;
}

interface ParsedImageAttachment {
  name: string;
  relativePath: string;
}

interface LoadedImageAttachment extends ParsedImageAttachment {
  url: string | null;
  error?: string;
}

const IMAGE_ATTACHMENT_LINE = /^-\s+(.+?):\s+(\.nano-agent\/uploads\/images\/.+)$/;
const IMAGE_ATTACHMENT_HINT = "需要识别图片文字时，请调用 ocr_image 工具。";

function parseImageAttachmentContent(content: string) {
  const displayLines: string[] = [];
  const attachments: ParsedImageAttachment[] = [];
  const lines = content.split(/\r?\n/);
  let inAttachmentBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "图片附件：") {
      inAttachmentBlock = true;
      continue;
    }
    if (inAttachmentBlock && trimmed === IMAGE_ATTACHMENT_HINT) {
      inAttachmentBlock = false;
      continue;
    }
    if (inAttachmentBlock) {
      const match = IMAGE_ATTACHMENT_LINE.exec(trimmed);
      if (match) {
        attachments.push({
          name: match[1],
          relativePath: match[2]
        });
        continue;
      }
      inAttachmentBlock = false;
    }
    displayLines.push(line);
  }

  return {
    displayContent: displayLines.join("\n").trim(),
    attachments
  };
}

export default function ImageAttachmentMessage({ content, projectPath }: ImageAttachmentMessageProps) {
  const [preview, setPreview] = useState<LoadedImageAttachment | null>(null);
  const [loadedAttachments, setLoadedAttachments] = useState<LoadedImageAttachment[]>([]);
  const parsed = useMemo(() => parseImageAttachmentContent(content), [content]);

  useEffect(() => {
    let cancelled = false;
    setLoadedAttachments(parsed.attachments.map((attachment) => ({ ...attachment, url: null })));

    async function loadAttachments() {
      if (!projectPath || parsed.attachments.length === 0) {
        return;
      }

      const nextAttachments = await Promise.all(parsed.attachments.map(async (attachment) => {
        try {
          const previewImage = await readChatImageAttachment(projectPath, attachment.relativePath);
          return { ...attachment, url: previewImage.data_url };
        } catch (error) {
          console.error("Failed to preview image attachment:", error);
          return { ...attachment, url: null, error: String(error) };
        }
      }));
      if (!cancelled) {
        setLoadedAttachments(nextAttachments);
      }
    }

    void loadAttachments();
    return () => {
      cancelled = true;
    };
  }, [parsed.attachments, projectPath]);

  if (parsed.attachments.length === 0) {
    return <MarkdownMessage content={content} />;
  }

  return (
    <>
      {parsed.displayContent && <MarkdownMessage content={parsed.displayContent} />}
      <div className="image-attachment-grid">
        {loadedAttachments.map((attachment) => (
          <button
            key={`${attachment.relativePath}-${attachment.name}`}
            className="image-attachment-thumb"
            type="button"
            onClick={() => attachment.url && setPreview(attachment)}
            disabled={!attachment.url}
            title={attachment.name}
            aria-label={`预览图片 ${attachment.name}`}
          >
            {attachment.url ? (
              <img src={attachment.url} alt={attachment.name} loading="lazy" />
            ) : (
              <span>{attachment.error ? "预览失败" : attachment.name}</span>
            )}
          </button>
        ))}
      </div>
      {preview?.url && (
        <div className="image-preview-backdrop" onClick={() => setPreview(null)} role="presentation">
          <div className="image-preview-dialog" onClick={(event) => event.stopPropagation()}>
            <button
              className="image-preview-close"
              type="button"
              onClick={() => setPreview(null)}
              aria-label="关闭预览"
              title="关闭"
            >
              <X size={18} />
            </button>
            <img src={preview.url} alt={preview.name} />
          </div>
        </div>
      )}
    </>
  );
}
