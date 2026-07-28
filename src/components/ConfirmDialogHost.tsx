import { Button, Group, Modal, Text, ThemeIcon } from "@mantine/core";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
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

  if (!pending) {
    return null;
  }

  const Icon = dialogIcons[pending.kind];
  const copy = dialogCopy[pending.kind];
  const color = pending.kind === "info" ? "nanoBlue" : pending.kind === "warning" ? "yellow" : "red";

  return (
    <Modal
      opened
      onClose={() => close(false)}
      size="sm"
      title={
        <Group gap="sm">
          <ThemeIcon color={color} variant="light" size="md">
            <Icon size={16} />
          </ThemeIcon>
          <Text fw={650}>{copy.title}</Text>
        </Group>
      }
      closeOnClickOutside
      closeOnEscape
    >
      <Text c="dimmed" size="sm" lh={1.6}>
        {pending.content}
      </Text>
      <Group justify="flex-end" mt="xl">
        <Button variant="default" onClick={() => close(false)}>
          取消
        </Button>
        <Button color={color} leftSection={<Icon size={15} />} onClick={() => close(true)} autoFocus>
          {copy.confirmLabel}
        </Button>
      </Group>
    </Modal>
  );
}
