import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react";

interface NotificationToastProps {
  notice: string;
  onClose: () => void;
}

interface NoticeData {
  content: string;
  type: "info" | "success" | "warning" | "error";
}

function getNoticeData(content: string): NoticeData {
  let type: "info" | "success" | "warning" | "error" = "info";
  const c = content.toLowerCase();
  
  if (
    c.includes("成功") || 
    c.includes("success") || 
    c.includes("已保存") || 
    c.includes("已删除") || 
    c.includes("已恢复") || 
    c.includes("已清空") ||
    c.includes("已同步")
  ) {
    type = "success";
  } else if (
    c.includes("失败") || 
    c.includes("错误") || 
    c.includes("error") || 
    c.includes("failed") || 
    c.includes("invalid") || 
    c.includes("exception") ||
    c.includes("无法") ||
    c.includes("未检测到")
  ) {
    type = "error";
  } else if (
    c.includes("警告") || 
    c.includes("warning") || 
    c.includes("请先") || 
    c.includes("不能为空") || 
    c.includes("限制") || 
    c.includes("注意") ||
    c.includes("缺少")
  ) {
    type = "warning";
  }
  
  return { content, type };
}

const icons = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle
};

export default function NotificationToast({ notice, onClose }: NotificationToastProps) {
  if (!notice) return null;

  const { content, type } = getNoticeData(notice);
  const Icon = icons[type];

  return (
    <div className="notification-toast-container">
      <div className={`notification-toast notification-toast--${type}`} role="status" aria-live="polite">
        <span className="notification-toast-icon">
          <Icon size={16} />
        </span>
        <div className="notification-toast-content">{content}</div>
        <button
          className="notification-toast-close"
          type="button"
          onClick={onClose}
          aria-label="关闭提示"
          title="关闭提示"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
