import type { LoggerService } from '@nestjs/common';
import { getCorrelationId } from './request-context.js';

export type LogLevel = 'debug' | 'verbose' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  verbose: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Keys whose values must never reach a log sink. Matched case-insensitively against
 * object keys and against `key=value` / `key: value` pairs inside string messages.
 */
const SENSITIVE_KEY =
  /(pass(word|phrase)?|secret|token|authorization|auth|cookie|session|api[-_]?key|credential|private[-_]?key|otp|pin)/i;

export const REDACTED = '[REDACTED]';

const redactString = (value: string): string =>
  value.replace(
    /([A-Za-z0-9_.-]*(?:pass(?:word|phrase)?|secret|token|authorization|auth|cookie|session|api[-_]?key|credential|private[-_]?key|otp|pin)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
  );

export const redact = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  if (value instanceof Error)
    return { name: value.name, message: redactString(value.message), stack: value.stack };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(entry, seen),
    ]),
  );
};

export interface StructuredLoggerOptions {
  service?: string;
  level?: LogLevel;
  write?: (line: string) => void;
  now?: () => Date;
}

const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && value in LEVEL_SEVERITY;

/**
 * Nest logger that emits one JSON object per line. Structured output is what makes
 * logs queryable by `correlationId` once they land in a collector; the correlation ID
 * is read from the request-scoped AsyncLocalStorage rather than passed in.
 */
export class StructuredLogger implements LoggerService {
  readonly #service: string;
  readonly #threshold: number;
  readonly #write: (line: string) => void;
  readonly #now: () => Date;

  constructor({ service, level, write, now }: StructuredLoggerOptions = {}) {
    this.#service = service ?? 'dts-api';
    const configured = isLogLevel(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : undefined;
    this.#threshold = LEVEL_SEVERITY[level ?? configured ?? 'info'];
    this.#write = write ?? ((line) => process.stdout.write(`${line}\n`));
    this.#now = now ?? (() => new Date());
  }

  log(message: unknown, ...optional: unknown[]): void {
    this.#emit('info', message, optional);
  }
  warn(message: unknown, ...optional: unknown[]): void {
    this.#emit('warn', message, optional);
  }
  error(message: unknown, ...optional: unknown[]): void {
    this.#emit('error', message, optional);
  }
  debug(message: unknown, ...optional: unknown[]): void {
    this.#emit('debug', message, optional);
  }
  verbose(message: unknown, ...optional: unknown[]): void {
    this.#emit('verbose', message, optional);
  }
  fatal(message: unknown, ...optional: unknown[]): void {
    this.#emit('fatal', message, optional);
  }

  #emit(level: LogLevel, message: unknown, optional: unknown[]): void {
    if (LEVEL_SEVERITY[level] < this.#threshold) return;
    // Nest passes the emitting class name as the trailing argument.
    const context = typeof optional.at(-1) === 'string' ? (optional.at(-1) as string) : undefined;
    const details = context === undefined ? optional : optional.slice(0, -1);
    const correlationId = getCorrelationId();
    this.#write(
      JSON.stringify({
        timestamp: this.#now().toISOString(),
        level,
        service: this.#service,
        context,
        message: typeof message === 'string' ? redactString(message) : redact(message),
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(details.length === 0 ? {} : { details: details.map((entry) => redact(entry)) }),
      }),
    );
  }
}
