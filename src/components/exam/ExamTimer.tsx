'use client';

import { useState, useEffect, useRef } from 'react';
import { Clock } from '@phosphor-icons/react';

interface ExamTimerProps {
  expiresAt: string;
  onTimeUp: () => void;
  /**
   * `serverNow - clientNow` in milliseconds. The deadline is an absolute
   * server timestamp; this offset only corrects the *display* when the device
   * clock is wrong. The browser is never the source of truth for exam time —
   * refreshes, reopens and power loss recompute from the same `expires_at`.
   */
  clockOffsetMs?: number;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function ExamTimer({ expiresAt, onTimeUp, clockOffsetMs = 0 }: ExamTimerProps) {
  const [remaining, setRemaining] = useState<number>(() => {
    const diff = Math.floor((new Date(expiresAt).getTime() - (Date.now() + clockOffsetMs)) / 1000);
    return Math.max(0, diff);
  });
  const onTimeUpRef = useRef(onTimeUp);
  const hasCalledTimeUp = useRef(false);
  const offsetRef = useRef(clockOffsetMs);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  useEffect(() => {
    offsetRef.current = clockOffsetMs;
  }, [clockOffsetMs]);

  useEffect(() => {
    // Read the clock again rather than closing over `remaining`, so the effect
    // only depends on the authoritative expiry timestamp.
    const compute = () =>
      Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - (Date.now() + offsetRef.current)) / 1000)
      );

    const initiallyRemaining = compute();

    if (initiallyRemaining <= 0) {
      if (!hasCalledTimeUp.current) {
        hasCalledTimeUp.current = true;
        onTimeUpRef.current();
      }
      return;
    }

    const interval = setInterval(() => {
      const newRemaining = compute();
      setRemaining(newRemaining);

      if (newRemaining <= 0 && !hasCalledTimeUp.current) {
        hasCalledTimeUp.current = true;
        onTimeUpRef.current();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const getColor = (): string => {
    if (remaining <= 60) return 'text-[var(--color-danger)]';
    if (remaining <= 300) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-foreground)]';
  };

  const getBgColor = (): string => {
    if (remaining <= 60)
      return 'bg-[var(--color-danger-light)] border-[var(--color-danger)]/30';
    if (remaining <= 300)
      return 'bg-[var(--color-warning-light)] border-[var(--color-warning)]/30';
    return 'bg-[var(--color-surface)] border-[var(--color-border)]';
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-md)] border font-mono text-sm font-semibold transition-colors ${getBgColor()} ${getColor()}`}
      role="timer"
      aria-live="polite"
      aria-label={`Time remaining: ${formatTime(remaining)}`}
    >
      <Clock className="h-4 w-4" weight="regular" aria-hidden="true" />
      <span>{formatTime(remaining)}</span>
      {remaining <= 60 && (
        <span className="hidden text-xs font-normal opacity-75 sm:inline">
          Submit now
        </span>
      )}
    </div>
  );
}
