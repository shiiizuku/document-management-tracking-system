import { describe, expect, it } from 'vitest';
import { securityHeaders } from '@/lib/security-headers';

const header = (apiUrl: string, key: string): string | undefined =>
  securityHeaders(apiUrl).find((entry) => entry.key === key)?.value;

describe('web security headers', () => {
  it('forbids framing by any other site', () => {
    expect(header('http://localhost:4001/api/v1', 'X-Frame-Options')).toBe('DENY');
    expect(header('http://localhost:4001/api/v1', 'Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
  });

  it('limits outbound requests to this origin and the API, including its socket', () => {
    const policy = header('https://dts.example/api/v1', 'Content-Security-Policy');
    expect(policy).toContain("connect-src 'self' https://dts.example wss://dts.example");
    expect(header('http://localhost:4001/api/v1', 'Content-Security-Policy')).toContain(
      "connect-src 'self' http://localhost:4001 ws://localhost:4001",
    );
  });

  it('lets the preview frames load blob: content and nothing is embeddable as an object', () => {
    const policy = header('http://localhost:4001/api/v1', 'Content-Security-Policy');
    expect(policy).toContain("frame-src 'self' blob:");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain('object-src blob:');
  });

  it('sends the remaining baseline headers', () => {
    const keys = securityHeaders('http://localhost:4001/api/v1').map((entry) => entry.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'X-Content-Type-Options',
        'Referrer-Policy',
        'Permissions-Policy',
        'Strict-Transport-Security',
      ]),
    );
  });
});

describe('development connect-src', () => {
  it('allows the API port on any host so the app works at localhost and a LAN address', () => {
    const policy = securityHeaders('http://localhost:4001/api/v1', { development: true }).find(
      (entry) => entry.key === 'Content-Security-Policy',
    )?.value;
    expect(policy).toContain('http://*:4001');
    expect(policy).toContain('ws://*:4001');
  });

  it('never widens it in production', () => {
    const policy = securityHeaders('https://dts.example/api/v1').find(
      (entry) => entry.key === 'Content-Security-Policy',
    )?.value;
    expect(policy).not.toContain('*');
  });
});
