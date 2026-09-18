'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface ExamTimerProps {
  expiresAt: string;
  onTimeUp: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function ExamTimer({ expiresAt, onTimeUp }: ExamTimerProps) {
  const [remaining, setRemaining] = useState<number>(() => {
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });
  const onTimeUpRef = useRef(onTimeUp);
  const hasCalledTimeUp = useRef(false);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  useEffect(() => {
    if (remaining <= 0 && !hasCalledTimeUp.current) {
      hasCalledTimeUp.current = true;
      onTimeUpRef.current();
      return;
    }

    const interval = setInterval(() => {
      const newRemaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(newRemaining);

      if (newRemaining <= 0 && !hasCalledTimeUp.current) {
        hasCalledTimeUp.current = true;
        onTimeUpRef.current();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const getColor = (): string => {
    if (remaining <= 60) return 'text-red-600 dark:text-red-400';
    if (remaining <= 300) return 'text-orange-500 dark:text-orange-400';
    if (remaining <= 600) return 'text-yellow-500 dark:text-yellow-400';
    return 'text-foreground';
  };

  const getBgColor = (): string => {
    if (remaining <= 60) return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    if (remaining <= 300) return 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800';
    if (remaining <= 600) return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    return 'bg-surface border-border';
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-mono text-sm font-semibold transition-colors ${getBgColor()} ${getColor()}`}
      role="timer"
      aria-live="polite"
      aria-label={`Time remaining: ${formatTime(remaining)}`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{formatTime(remaining)}</span>
      {remaining <= 300 && (
        <span className="text-xs font-normal opacity-75">
          {remaining <= 60 ? 'Submit now!' : 'Remaining'}
        </span>
      )}
    </div>
  );
}
