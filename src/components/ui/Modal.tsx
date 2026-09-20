'use client';

import { useEffect, useRef, type JSX, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  actions,
}: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[85vh] rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-[var(--shadow-lg)] backdrop:bg-black/50"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex flex-col max-h-[85vh]">
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
            <h2 className="text-lg font-semibold text-[var(--color-foreground)]">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-[var(--radius-sm)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Close dialog"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        )}

        <div className="px-6 py-4 overflow-y-auto">{children}</div>

        {actions && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
            {actions}
          </div>
        )}
      </div>
    </dialog>
  );
}
