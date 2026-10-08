// Central application logger.
//
// Every server and client log goes through this module so that level, and
// destination can be changed in one place. Before it existed, call sites used
// `console.error`/`console.warn` directly, which made it impossible to quiet
// noisy paths in production or to route logs to a collector later.
//
// Dependency-free and browser-safe: it imports nothing and only reads
// `process.env.LOG_LEVEL` when `process` exists (in the browser `process.env`
// is replaced at build time and LOG_LEVEL is simply undefined).
//
// Default level is `info`, so `logger.debug` is silent unless LOG_LEVEL=debug.
// Error and warning paths keep their existing behaviour and output.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw =
    typeof process !== 'undefined' && process.env ? process.env.LOG_LEVEL : undefined;
  const value = raw?.toLowerCase();
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}

const threshold = ORDER[configuredLevel()];

function emit(level: LogLevel, args: unknown[]): void {
  if (ORDER[level] < threshold) return;
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else if (level === 'info') console.info(...args);
  else console.debug(...args);
}

export const logger = {
  debug: (...args: unknown[]): void => emit('debug', args),
  info: (...args: unknown[]): void => emit('info', args),
  warn: (...args: unknown[]): void => emit('warn', args),
  error: (...args: unknown[]): void => emit('error', args),
};
