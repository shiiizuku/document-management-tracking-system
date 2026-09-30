import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClamAvScanner } from '../src/modules/files/clamav-scanner.js';

/**
 * A stand-in clamd that speaks just enough of the INSTREAM protocol to test the client: it reads
 * the command + length-prefixed frames until the zero-length terminator, then replies with a line
 * the test picked. This exercises the real wire framing without needing a ClamAV daemon.
 */
const fakeClamd = (
  reply: string | ((received: Buffer) => string | null),
): Promise<{ server: Server; port: number }> =>
  new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      const frames: Buffer[] = [];
      let sawCommand = false;
      let payload = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        if (!sawCommand) {
          const nul = chunk.indexOf(0);
          sawCommand = true;
          payload = Buffer.concat([payload, chunk.subarray(nul + 1)]);
        } else {
          payload = Buffer.concat([payload, chunk]);
        }
        // Parse complete frames; a zero-length frame ends the stream.
        while (payload.byteLength >= 4) {
          const size = payload.readUInt32BE(0);
          if (size === 0) {
            const received = Buffer.concat(frames);
            const line = typeof reply === 'function' ? reply(received) : reply;
            // A `null` reply models an unresponsive clamd: hold the socket open so the client's
            // own timeout has to fire. Otherwise send the reply and close.
            if (line !== null) socket.end(`${line}\0`);
            return;
          }
          if (payload.byteLength < 4 + size) break;
          frames.push(payload.subarray(4, 4 + size));
          payload = payload.subarray(4 + size);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('fake clamd did not bind a TCP port');
      resolve({ server, port: address.port });
    });
  });

describe('ClamAvScanner', () => {
  let server: Server | undefined;

  const start = async (reply: string | ((received: Buffer) => string | null)): Promise<number> => {
    const started = await fakeClamd(reply);
    server = started.server;
    return started.port;
  };

  beforeEach(() => {
    server = undefined;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('returns CLEAN on a "stream: OK" reply', async () => {
    const port = await start('stream: OK');
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port });
    expect(await scanner.scan(new Uint8Array([1, 2, 3, 4]))).toBe('CLEAN');
  });

  it('returns INFECTED when clamd reports a signature FOUND', async () => {
    const port = await start('stream: Eicar-Test-Signature FOUND');
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port });
    expect(await scanner.scan(new Uint8Array([5, 6, 7]))).toBe('INFECTED');
  });

  it('reassembles multi-frame streams (chunked payloads)', async () => {
    // Echo the total bytes clamd received so we can assert the framing round-trips.
    const original = new Uint8Array(200_000).fill(7);
    let receivedLength = -1;
    const port = await start((received) => {
      receivedLength = received.byteLength;
      return 'stream: OK';
    });
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port, chunkSize: 64 * 1024 });
    expect(await scanner.scan(original)).toBe('CLEAN');
    expect(receivedLength).toBe(original.byteLength);
  });

  it('rejects an unexpected reply rather than assuming clean', async () => {
    const port = await start('stream: size limit exceeded ERROR');
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port });
    await expect(scanner.scan(new Uint8Array([1]))).rejects.toThrow(/Unexpected clamd reply/);
  });

  it('times out when clamd never replies', async () => {
    const port = await start(() => null);
    const scanner = new ClamAvScanner({ host: '127.0.0.1', port, timeoutMs: 200 });
    await expect(scanner.scan(new Uint8Array([1]))).rejects.toThrow(/did not respond/);
  });
});
