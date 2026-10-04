import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isDatabaseBusyError } from '../database/database-errors.js';
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from './correlation-id.middleware.js';

/** Seconds a client is asked to wait when the database is saturated. */
export const BUSY_RETRY_AFTER_SECONDS = 2;

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    // The middleware already assigned (and sanitized) the ID; the fallback only matters
    // for errors thrown before it ran, so the envelope always carries a traceable value.
    const correlationId =
      request.correlationId ?? normalizeCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    // A saturated database is "busy, retry", not "unexpected error": it is the expected shape of
    // overload (docs/d2-performance-fixes.md F4), and a client can do something useful with it.
    if (isDatabaseBusyError(exception)) {
      this.logger.warn(
        `Database busy ${request.method} ${request.originalUrl} correlationId=${correlationId}`,
      );
      response.setHeader(CORRELATION_ID_HEADER, correlationId);
      response.setHeader('Retry-After', String(BUSY_RETRY_AFTER_SECONDS));
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        error: {
          code: 'SERVICE_BUSY',
          message: 'The service is busy. Please try again in a moment.',
          details: undefined,
          correlationId,
        },
      });
      return;
    }
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;
    if (status >= 500) {
      this.logger.error(
        `Unhandled request error ${request.method} ${request.originalUrl} correlationId=${correlationId}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    const objectPayload = typeof payload === 'object' && payload !== null ? payload : {};
    const payloadMessage = 'message' in objectPayload ? objectPayload.message : undefined;
    const message =
      status >= 500
        ? 'An unexpected error occurred'
        : typeof payload === 'string'
          ? payload
          : Array.isArray(payloadMessage)
            ? payloadMessage.join(', ')
            : typeof payloadMessage === 'string'
              ? payloadMessage
              : exception instanceof Error
                ? exception.message
                : 'Request failed';
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.status(status).json({
      error: {
        code:
          'code' in objectPayload && typeof objectPayload.code === 'string'
            ? objectPayload.code
            : `HTTP_${status}`,
        message,
        details: 'details' in objectPayload ? objectPayload.details : undefined,
        correlationId,
      },
    });
  }
}
