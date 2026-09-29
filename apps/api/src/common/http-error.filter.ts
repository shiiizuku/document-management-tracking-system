import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from './correlation-id.middleware.js';

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
