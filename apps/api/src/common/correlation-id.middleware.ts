import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from './request-context.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Inbound correlation IDs are caller-controlled and end up in log lines, so anything
 * outside a conservative token charset (or longer than 64 chars) is discarded and
 * replaced rather than echoed — otherwise a header containing newlines could forge
 * log records.
 */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,64}$/;

export const normalizeCorrelationId = (value: unknown): string => {
  const candidate: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof candidate === 'string' && SAFE_CORRELATION_ID.test(candidate)
    ? candidate
    : randomUUID();
};

declare module 'express' {
  interface Request {
    correlationId?: string;
  }
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = normalizeCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    request.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    // Everything downstream (guards, handlers, their async continuations) runs inside
    // this store, so the logger can stamp the ID without it being passed explicitly.
    runWithRequestContext({ correlationId }, next);
  }
}
