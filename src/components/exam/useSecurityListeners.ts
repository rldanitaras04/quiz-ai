'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { EffectiveSecurityPolicy, SecurityEventType } from '@/lib/exam-security';

/**
 * Browser-observable examination session listeners.
 *
 * Honest scope: these observe what a browser can observe (full-screen state,
 * tab visibility, window focus, clipboard/menu gestures). They CANNOT prevent
 * Alt+Tab, another application, another browser, or another device — no PWA
 * can, and nothing here pretends otherwise.
 *
 * Noise control: `tab_hidden` / `window_blurred` are reported only after a
 * short quiet period, so an instantaneous switch that resolves immediately
 * does not create a storm of paired events. Restores are reported immediately.
 */
const QUIET_PERIOD_MS = 600;

// Fullscreen state is external system state: subscribe to the browser event
// instead of mirroring it into React state from an effect.
const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};
const getFullscreenSnapshot = () => Boolean(document.fullscreenElement);
const getFullscreenServerSnapshot = () => false;

export interface SecurityListenersOptions {
  enabled: boolean;
  policy: EffectiveSecurityPolicy;
  report: (type: SecurityEventType, metadata?: Record<string, unknown>) => void;
  /** Called when full-screen is exited while it is required by policy. */
  onFullscreenRequiredExit?: () => void;
}

export function useSecurityListeners(options: SecurityListenersOptions): {
  isFullscreen: boolean;
} {
  const { enabled, policy, report, onFullscreenRequiredExit } = options;
  const isFullscreen = useSyncExternalStore(
    subscribeFullscreen,
    getFullscreenSnapshot,
    getFullscreenServerSnapshot
  );

  const policyRef = useRef(policy);
  const reportRef = useRef(report);
  const onExitRef = useRef(onFullscreenRequiredExit);

  useEffect(() => {
    policyRef.current = policy;
  }, [policy]);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);
  useEffect(() => {
    onExitRef.current = onFullscreenRequiredExit;
  }, [onFullscreenRequiredExit]);

  useEffect(() => {
    if (!enabled) return;

    const p = () => policyRef.current;
    const emit = (type: SecurityEventType, metadata?: Record<string, unknown>) =>
      reportRef.current(type, metadata);

    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenSince: number | null = null;
    let blurredSince: number | null = null;

    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      if (active) {
        emit('fullscreen_entered');
      } else if (p().detectFullscreenExit) {
        emit('fullscreen_exited');
        if (p().requireFullscreen) onExitRef.current?.();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (!p().detectTabVisibility || hiddenTimer) return;
        hiddenTimer = setTimeout(() => {
          hiddenTimer = null;
          hiddenSince = Date.now();
          emit('tab_hidden');
        }, QUIET_PERIOD_MS);
      } else {
        if (hiddenTimer) {
          clearTimeout(hiddenTimer);
          hiddenTimer = null;
        }
        if (hiddenSince !== null) {
          emit('tab_visible', { duration_ms: Date.now() - hiddenSince });
          hiddenSince = null;
        }
      }
    };

    const onBlur = () => {
      if (!p().detectFocusLoss || blurTimer) return;
      blurTimer = setTimeout(() => {
        blurTimer = null;
        blurredSince = Date.now();
        emit('window_blurred');
      }, QUIET_PERIOD_MS);
    };

    const onFocus = () => {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      if (blurredSince !== null) {
        emit('window_focused', { duration_ms: Date.now() - blurredSince });
        blurredSince = null;
      }
    };

    const onCopy = (event: Event) => {
      if (!p().detectCopyAttempts) return;
      emit('copy_attempt');
      // Detection only — clipboard blocking would hurt accessibility without
      // providing real security; the recorded event is the friction.
      void event;
    };

    const onPaste = (event: Event) => {
      if (!p().detectPasteAttempts) return;
      emit('paste_attempt');
      void event;
    };

    const onContextMenu = (event: Event) => {
      if (!p().detectContextMenu) return;
      event.preventDefault();
      emit('context_menu_attempt');
    };

    const onBeforeUnload = () => {
      // Best-effort: a normal tab close/refresh without a clean submit leaves
      // the durable session record open, which the next load reports as a
      // reload/recovery. Nothing here can block a hard power-off — that is
      // exactly what IndexedDB durability is for.
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      if (hiddenTimer) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [enabled]);

  return { isFullscreen };
}
