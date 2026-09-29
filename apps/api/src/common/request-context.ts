import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `callback` with a request-scoped context every async continuation inherits,
 * so the logger can stamp a correlation ID without threading it through signatures.
 */
export const runWithRequestContext = <T>(context: RequestContext, callback: () => T): T =>
  storage.run(context, callback);

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const getCorrelationId = (): string | undefined => storage.getStore()?.correlationId;
