import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { registerConfirmActionHandler } from "../lib/dialogs";
import type { DialogKind } from "../lib/dialogs";

interface PendingConfirm {
  content: string;
  kind: DialogKind;
  resolve: (confirmed: boolean) => void;
}

const dialogCopy: Record<DialogKind, { title: string; confirmLabel: string }> = {
  info: { title: "确认操作", confirmLabel: "确定" },
  warning: { title: "确认危险操作", confirmLabel: "确认" },
  error: { title: "确认高风险操作", confirmLabel: "仍然执行" }
};

const dialogIcons = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle
};

export default function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(confirmed);
  }, []);

  useEffect(() => {
    registerConfirmActionHandler((content, kind) => {
      return new Promise<boolean>((resolve) => {
        if (pendingRef.current) {
          pendingRef.current.resolve(false);
        }
        const nextPending = { content, kind, resolve };
        pendingRef.current = nextPending;
        setPending(nextPending);
      });
    });

    return () => {
      registerConfirmActionHandler(null);
      if (pendingRef.current) {
        pendingRef.current.resolve(false);
        pendingRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pending) return;

    const focusTimer = window.setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, pending]);

  if (!pending) {
    return null;
  }

  const Icon = dialogIcons[pending.kind];
  const copy = dialogCopy[pending.kind];

  return (
    <div className="confirm-backdrop" onClick={() => close(false)}>
      <section
        className={`confirm-dialog confirm-dialog--${pending.kind}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-content"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <Icon size={18} />
            <strong id="confirm-dialog-title">{copy.title}</strong>
          </div>
          <button className="confirm-dialog-close" type="button" onClick={() => close(false)} aria-label="关闭" title="关闭">
            <X size={16} />
          </button>
        </header>
        <p id="confirm-dialog-content">{pending.content}</p>
        <footer>
          <button className="ghost" type="button" onClick={() => close(false)}>
            取消
          </button>
          <button ref={confirmButtonRef} className="danger" type="button" onClick={() => close(true)}>
            {copy.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
