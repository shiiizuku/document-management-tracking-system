import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import {
  NotificationsGateway,
  sessionTokenFromHandshake,
} from '../src/modules/realtime/notifications.gateway.js';
import { realtimeMessageForEvent } from '../src/modules/realtime/realtime.events.js';
import {
  NOTIFICATION_EVENT,
  parseRealtimeMessage,
  roomForUser,
} from '../src/modules/realtime/realtime.contract.js';
import { RealtimePublisher } from '../src/modules/realtime/realtime.publisher.js';
import type { SessionService } from '../src/modules/auth/session.service.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';

describe('sessionTokenFromHandshake', () => {
  it('reads the session cookie out of the cookie header', () => {
    const token = sessionTokenFromHandshake({
      headers: { cookie: 'dts_csrf=abc; dts_session=the-jwt; other=x' },
    });
    expect(token).toBe('the-jwt');
  });

  it('url-decodes the cookie value', () => {
    const token = sessionTokenFromHandshake({ headers: { cookie: 'dts_session=a%2Bb%3D' } });
    expect(token).toBe('a+b=');
  });

  it('falls back to the explicit auth token for non-browser clients', () => {
    const token = sessionTokenFromHandshake({ headers: {}, auth: { token: 'via-auth' } });
    expect(token).toBe('via-auth');
  });

  it('returns null when no session is present', () => {
    expect(sessionTokenFromHandshake({ headers: { cookie: 'other=1' } })).toBeNull();
    expect(sessionTokenFromHandshake({ headers: {} })).toBeNull();
  });
});

describe('realtimeMessageForEvent', () => {
  it('maps an assignment to a notification for the recipient', () => {
    const message = realtimeMessageForEvent('document.assigned', {
      documentId: 'doc-1',
      recipientUserId: 'user-9',
    });
    expect(message).toEqual({
      userId: 'user-9',
      event: NOTIFICATION_EVENT,
      payload: { documentId: 'doc-1' },
    });
  });

  it('ignores events with no recipient and other event types', () => {
    expect(realtimeMessageForEvent('document.assigned', { documentId: 'doc-1' })).toBeNull();
    expect(realtimeMessageForEvent('document.routed', { documentId: 'doc-1' })).toBeNull();
  });
});

describe('parseRealtimeMessage', () => {
  it('accepts a well-formed message', () => {
    const raw = JSON.stringify({
      userId: 'u1',
      event: 'notification',
      payload: { documentId: 'd' },
    });
    expect(parseRealtimeMessage(raw)).toEqual({
      userId: 'u1',
      event: 'notification',
      payload: { documentId: 'd' },
    });
  });

  it('rejects non-JSON and structurally invalid payloads', () => {
    expect(parseRealtimeMessage('not json')).toBeNull();
    expect(parseRealtimeMessage(JSON.stringify({ userId: 'u1' }))).toBeNull();
    expect(parseRealtimeMessage(JSON.stringify({ userId: 1, event: 'e', payload: {} }))).toBeNull();
  });
});

describe('RealtimePublisher', () => {
  it('publishes the serialized message onto the shared channel', async () => {
    const publish = vi.fn(() => Promise.resolve(1));
    await new RealtimePublisher({ publish }).publish({
      userId: 'u1',
      event: 'notification',
      payload: { documentId: 'd' },
    });
    expect(publish).toHaveBeenCalledWith(
      'dts:realtime',
      JSON.stringify({ userId: 'u1', event: 'notification', payload: { documentId: 'd' } }),
    );
  });
});

describe('NotificationsGateway', () => {
  const buildGateway = (getUser: AuthService['getUser'], verify: SessionService['verify']) => {
    const sessions = { verify } as unknown as SessionService;
    const auth = { getUser } as unknown as AuthService;
    return new NotificationsGateway(sessions, auth);
  };

  const fakeSocket = (handshake: unknown) => {
    const join = vi.fn(() => Promise.resolve());
    const disconnect = vi.fn();
    return { socket: { handshake, join, disconnect } as unknown as Socket, join, disconnect };
  };

  it('joins the user room when the handshake carries a valid session', async () => {
    const gateway = buildGateway(
      vi.fn(() =>
        Promise.resolve({ id: 'user-42' } as Awaited<ReturnType<AuthService['getUser']>>),
      ),
      vi.fn(() => ({ sub: 'user-42', csrf: 'c', sst: 0, exp: 0 })),
    );
    const { socket, join, disconnect } = fakeSocket({ headers: { cookie: 'dts_session=jwt' } });

    await gateway.handleConnection(socket);

    expect(join).toHaveBeenCalledWith(roomForUser('user-42'));
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a socket with no session', async () => {
    const verify = vi.fn(() => ({ sub: 'x', csrf: 'c', sst: 0, exp: 0 }));
    const gateway = buildGateway(vi.fn(), verify);
    const { socket, join, disconnect } = fakeSocket({ headers: {} });

    await gateway.handleConnection(socket);

    expect(verify).not.toHaveBeenCalled();
    expect(join).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects when the session fails verification', async () => {
    const gateway = buildGateway(
      vi.fn(),
      vi.fn(() => {
        throw new Error('invalid');
      }),
    );
    const { socket, join, disconnect } = fakeSocket({ headers: { cookie: 'dts_session=bad' } });

    await gateway.handleConnection(socket);

    expect(join).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('emits to a user room through the socket server', () => {
    const gateway = buildGateway(vi.fn(), vi.fn());
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    // @ts-expect-error assigning the decorated server field for the test
    gateway.server = { to };

    gateway.emitToUser('user-7', 'notification', { documentId: 'd' });

    expect(to).toHaveBeenCalledWith(roomForUser('user-7'));
    expect(emit).toHaveBeenCalledWith('notification', { documentId: 'd' });
  });
});
