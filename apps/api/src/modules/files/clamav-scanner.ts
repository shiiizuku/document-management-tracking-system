import { Socket } from 'node:net';

export type ScanVerdict = 'CLEAN' | 'INFECTED';

export interface ClamAvOptions {
  host: string;
  port: number;
  /** How long to wait for clamd to accept the stream and reply, in ms. */
  timeoutMs?: number;
  /** Bytes per INSTREAM chunk. Must stay under clamd's `StreamMaxLength`. */
  chunkSize?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CHUNK_SIZE = 64 * 1024;

/**
 * Talks to a clamd daemon over its TCP socket using the INSTREAM command, so the bytes are
 * scanned in memory without ever being written to a path clamd can reach. The wire format is:
 * send `zINSTREAM\0`, then a series of `<uint32 length><chunk>` frames, then a zero-length frame
 * to end the stream; clamd replies with `stream: OK` or `stream: <signature> FOUND`.
 *
 * Framework-free on purpose: the scan worker (`worker.ts`) is a plain Node process, not a Nest
 * app, so this is constructed directly from config rather than injected.
 */
export class ClamAvScanner {
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #chunkSize: number;

  constructor(options: ClamAvOptions) {
    this.#host = options.host;
    this.#port = options.port;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  }

  scan(bytes: Uint8Array): Promise<ScanVerdict> {
    return new Promise<ScanVerdict>((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(this.#timeoutMs, () =>
        fail(new Error(`clamd did not respond within ${this.#timeoutMs}ms`)),
      );
      socket.on('error', fail);
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('end', () => {
        if (settled) return;
        settled = true;
        const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
        // `FOUND` wins over `OK` in case both ever appear; anything else is a clamd-side error
        // (e.g. the stream exceeded StreamMaxLength) and must not be treated as clean.
        if (/\bFOUND\b/.test(reply)) resolve('INFECTED');
        else if (/\bOK\b/.test(reply)) resolve('CLEAN');
        else reject(new Error(`Unexpected clamd reply: ${reply || '(empty)'}`));
      });

      socket.connect(this.#port, this.#host, () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.byteLength; offset += this.#chunkSize) {
          const slice = bytes.subarray(offset, offset + this.#chunkSize);
          const header = Buffer.allocUnsafe(4);
          header.writeUInt32BE(slice.byteLength, 0);
          socket.write(header);
          socket.write(Buffer.from(slice));
        }
        // A zero-length frame tells clamd the stream is complete.
        const terminator = Buffer.allocUnsafe(4);
        terminator.writeUInt32BE(0, 0);
        socket.write(terminator);
      });
    });
  }
}
