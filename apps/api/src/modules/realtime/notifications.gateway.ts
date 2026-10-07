import { Injectable, Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { parseWebOrigins } from '../../config/environment.js';
import { AuthService } from '../auth/auth.service.js';
import { SessionService, SESSION_COOKIE } from '../auth/session.service.js';
import { roomForUser } from './realtime.contract.js';

// Read at decoration time, before ConfigModule has run, so it parses the raw variable with the
// same function the validated environment uses: the socket and the REST API share one allowlist.
const webOrigins = parseWebOrigins(process.env.WEB_ORIGIN, process.env.NODE_ENV === 'production');

/**
 * Pulls the session token out of a Socket.IO handshake. It prefers the `dts_session` cookie the
 * browser sends automatically, and falls back to an explicit `auth.token` for non-browser
 * clients. Exported so the extraction rules can be unit-tested without a live socket.
 */
export const sessionTokenFromHandshake = (handshake: {
  headers: { cookie?: string | undefined };
  auth?: { token?: unknown } | undefined;
}): string | null => {
  const cookieHeader = handshake.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      if (part.slice(0, separator).trim() === SESSION_COOKIE)
        return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  const authToken = handshake.auth?.token;
  return typeof authToken === 'string' && authToken.length > 0 ? authToken : null;
};

/**
 * Realtime delivery to the browser. Sockets authenticate with the same stateless session as the
 * REST API — the handshake carries the `dts_session` cookie, which is verified and resolved to a
 * user exactly as {@link AuthGuard} does — and then join a per-user room so a message fans out
 * only to that user's own connections. Cross-process fan-out (the worker → Redis → here) is the
 * bridge's job; this gateway only owns the socket lifecycle and the per-user emit.
 */
@Injectable()
@WebSocketGateway({
  namespace: 'realtime',
  cors: { origin: webOrigins, credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  readonly #logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = sessionTokenFromHandshake(client.handshake);
      if (token === null) throw new Error('no session token');
      const claims = this.sessions.verify(token);
      // Re-read the user so a deactivated account cannot hold a live socket, matching the
      // REST guard's "trust the database, not the token copy" rule.
      const user = await this.auth.getUser(claims.sub, claims.sv);
      await client.join(roomForUser(user.id));
    } catch {
      // Never leak why: an unauthenticated socket is simply closed.
      client.disconnect(true);
    }
  }

  /** Emits an event to every socket the given user currently has open. */
  emitToUser(userId: string, event: string, payload: Record<string, unknown>): void {
    if (this.server === undefined) {
      this.#logger.warn('emitToUser called before the gateway server was ready');
      return;
    }
    this.server.to(roomForUser(userId)).emit(event, payload);
  }
}
