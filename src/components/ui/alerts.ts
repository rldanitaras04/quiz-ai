'use client';

import Swal from 'sweetalert2';

/**
 * Single entry point for dialogs and transient feedback.
 *
 * Everything goes through SweetAlert2, which is themed from the app's design
 * tokens in `globals.css` (`theme: 'light'` keeps SweetAlert's own dark palette
 * from overriding ours — our tokens already switch for dark mode).
 *
 * Two deliberate rules:
 *   - confirmations are the only blocking UI here, and they are reserved for
 *     destructive or irreversible actions;
 *   - persistent, actionable notifications stay in the notification centre
 *     (`/notifications`); these helpers are for immediate feedback only.
 */

const toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3500,
  timerProgressBar: true,
  theme: 'light',
  didOpen: (element) => {
    // Pause the countdown while the pointer rests on the toast.
    element.addEventListener('mouseenter', Swal.stopTimer);
    element.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

export function notifySuccess(title: string, text?: string): void {
  void toast.fire({ icon: 'success', title, text });
}

export function notifyError(title: string, text?: string): void {
  // Errors stay long enough to be read.
  void toast.fire({ icon: 'error', title, text, timer: 6000 });
}

export function notifyInfo(title: string, text?: string): void {
  void toast.fire({ icon: 'info', title, text });
}

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  /** Styles the confirm button as destructive and focuses Cancel by default. */
  destructive?: boolean;
}

/** Resolves true only when the user explicitly confirms. */
export async function confirmAction({
  title,
  text,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  const result = await Swal.fire({
    title,
    text,
    icon: destructive ? 'warning' : 'question',
    theme: 'light',
    showCancelButton: true,
    reverseButtons: true,
    focusCancel: destructive,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    customClass: destructive ? { confirmButton: 'swal-destructive' } : undefined,
  });

  return result.isConfirmed;
}
