import { REALTIME_CHANNEL, type RealtimeMessage } from './realtime.contract.js';

/** The minimal Redis surface the publisher needs — satisfied by an ioredis client. */
export interface RealtimePublisherClient {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * The worker end of realtime fan-out: publishes a {@link RealtimeMessage} onto the shared channel
 * for the API's {@link RealtimeBridge} to relay. Framework-free because the worker is a plain Node
 * process, and deliberately fire-and-forget — the durable notification row is already committed,
 * so a missed publish only costs a live ping, not the notification itself.
 */
export class RealtimePublisher {
  constructor(private readonly redis: RealtimePublisherClient) {}

  async publish(message: RealtimeMessage): Promise<void> {
    await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(message));
  }
}
