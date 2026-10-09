import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient, S3Error } from 'minio';
import type { Readable } from 'node:stream';
import { StoragePort } from './storage.port.js';

/**
 * The real object-storage binding: attachment bytes in a private MinIO/S3 bucket. It honours the
 * same contract as {@link StoragePort} — server-generated keys, and `put` refuses to overwrite —
 * so swapping it in for the in-memory adapter changes where the bytes live, not how the
 * upload/download use cases behave.
 *
 * `MINIO_ENDPOINT` is a full URL (validated at boot); the MinIO client instead wants host/port/TLS
 * split out, which is what the constructor derives. The bucket is created on first write rather
 * than at boot, so the app starts even if MinIO is briefly unreachable, and tests that override
 * this provider never touch the network.
 */
@Injectable()
export class MinioStorageAdapter extends StoragePort {
  readonly #client: MinioClient;
  readonly #bucket: string;
  /** Memoised bucket-existence check so concurrent writes don't race `makeBucket`. */
  #bucketReady: Promise<void> | undefined;

  constructor(config: ConfigService) {
    super();
    const endpoint = new URL(config.getOrThrow<string>('MINIO_ENDPOINT'));
    const useSSL = endpoint.protocol === 'https:';
    this.#client = new MinioClient({
      endPoint: endpoint.hostname,
      port: endpoint.port ? Number(endpoint.port) : useSSL ? 443 : 80,
      useSSL,
      accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
    this.#bucket = config.getOrThrow<string>('MINIO_BUCKET');
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await this.#ensureBucket();
    if (await this.#exists(key)) throw new Error(`Refusing to overwrite existing object at ${key}`);
    const buffer = Buffer.from(bytes);
    await this.#client.putObject(this.#bucket, key, buffer, buffer.byteLength);
  }

  async get(key: string): Promise<Uint8Array | null> {
    let stream: Readable;
    try {
      stream = await this.#client.getObject(this.#bucket, key);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    return new Uint8Array(Buffer.concat(chunks));
  }

  async delete(key: string): Promise<void> {
    await this.#ensureBucket();
    await this.#client.removeObject(this.#bucket, key);
  }

  #ensureBucket(): Promise<void> {
    // Cache the promise, not just its result: if the first write fails to create the bucket, the
    // next write retries instead of assuming a bucket that isn't there.
    this.#bucketReady ??= (async () => {
      try {
        if (!(await this.#client.bucketExists(this.#bucket)))
          await this.#client.makeBucket(this.#bucket);
      } catch (error) {
        this.#bucketReady = undefined;
        throw error;
      }
    })();
    return this.#bucketReady;
  }

  async #exists(key: string): Promise<boolean> {
    try {
      await this.#client.statObject(this.#bucket, key);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

/** MinIO reports a missing bucket/object as an S3 error with one of these codes. */
const isNotFound = (error: unknown): boolean =>
  error instanceof S3Error &&
  (error.code === 'NotFound' || error.code === 'NoSuchKey' || error.code === 'NoSuchBucket');
