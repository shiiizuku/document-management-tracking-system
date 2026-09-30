import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { NotificationsGateway } from './notifications.gateway.js';
import { REALTIME_CHANNEL, parseRealtimeMessage } from './realtime.contract.js';

/**
 * The API end of realtime fan-out. Notifications are created in the worker process (the outbox
 * consumer), which publishes a {@link RealtimeMessage} onto {@link REALTIME_CHANNEL}; this bridge —
 * a dedicated Redis subscriber on every API instance — turns each message into a per-user socket
 * emit. Going through Redis rather than an in-process call is what lets any API instance deliver
 * an event raised on another process.
 */
@Injectable()
export class RealtimeBridge implements OnModuleInit, OnModuleDestroy {
  readonly #logger = new Logger(RealtimeBridge.name);
  readonly #subscriber: Redis;

  constructor(
    config: ConfigService,
    private readonly gateway: NotificationsGateway,
  ) {
    // A subscriber connection can issue nothing but (un)subscribe, so it is separate from any
    // other Redis use. `lazyConnect` defers the socket until `onModuleInit` opts in.
    this.#subscriber = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    this.#subscriber.on('message', (_channel, raw: string) => this.#dispatch(raw));
    // Realtime is best-effort: a Redis outage must not take the API down, and the subscription
    // is (re)established on every (re)connect so it survives a Redis restart transparently.
    this.#subscriber.on('ready', () => {
      this.#subscriber
        .subscribe(REALTIME_CHANNEL)
        .catch((error: unknown) =>
          this.#logger.warn(`realtime subscribe failed: ${String(error)}`),
        );
    });
    this.#subscriber.on('error', (error: Error) =>
      this.#logger.warn(`realtime subscriber error: ${error.message}`),
    );
  }

  onModuleInit(): void {
    // Fire-and-forget: the connection retries in the background, so the app boots even when
    // Redis is momentarily unavailable. The `ready` handler above subscribes once it connects.
    this.#subscriber.connect().catch(() => {
      /* logged by the 'error' handler; reconnection is automatic */
    });
  }

  onModuleDestroy(): void {
    this.#subscriber.disconnect();
  }

  #dispatch(raw: string): void {
    const message = parseRealtimeMessage(raw);
    if (message === null) {
      this.#logger.warn('Discarded a malformed realtime message');
      return;
    }
    this.gateway.emitToUser(message.userId, message.event, message.payload);
  }
}
