"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function Modal({ open, onClose, title, description, children, className = "", busy = false, hideTitle = false }: {
  open: boolean; onClose: () => void; title: string; description: string; children: ReactNode;
  className?: string; busy?: boolean; hideTitle?: boolean;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className={`observatory-modal ${className}`}
        onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement; }}
        onCloseAutoFocus={event => { event.preventDefault(); previousFocus.current?.focus(); }}
        onInteractOutside={event => { if (busy) event.preventDefault(); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <div className={hideTitle ? "sr-only" : "modal-heading"}>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
        </div>
        <Dialog.Close className="icon-button modal-close" aria-label="Close dialog" disabled={busy}><X size={18} /></Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
