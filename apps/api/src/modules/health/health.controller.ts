import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.constants.js';
import type { Database } from '../../database/client.js';
import { StoragePort } from '../files/storage.port.js';

type CheckState = 'up' | 'down';

const PROBE_TIMEOUT_MS = 2_000;

// A key that is never written. `get` returning `null` still proves the object store answered;
// only a backend that is unreachable makes the call throw, which is what flips storage to down.
const STORAGE_PROBE_KEY = '.health/readiness-probe';

/**
 * Liveness answers "is the process running"; readiness answers "can it serve traffic".
 * Conflating them makes an orchestrator restart a healthy API whenever a dependency blips,
 * so `/health` stays dependency-free and only `/ready` probes downstream services.
 *
 * The API probes what sits on its own request path: Postgres (every read/write) and the object
 * store (attachment upload/download). Redis is not probed here — the API never touches it
 * directly; that dependency belongs to the worker's readiness (`worker.ts`).
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly storage: StoragePort,
  ) {}

  @Get('health')
  health(): { status: 'ok'; service: string; timestamp: string } {
    return { status: 'ok', service: 'dts-api', timestamp: new Date().toISOString() };
  }

  @Get('health/ready')
  async healthReady(): Promise<{ status: 'ready'; checks: Record<string, CheckState> }> {
    return this.ready();
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready'; checks: Record<string, CheckState> }> {
    const [database, storage] = await Promise.all([
      this.#probe(() => this.database.execute(sql`select 1`)),
      this.#probe(() => this.storage.get(STORAGE_PROBE_KEY)),
    ]);
    const checks: Record<string, CheckState> = { database, storage };
    if (Object.values(checks).some((state) => state === 'down'))
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'One or more dependencies are unavailable',
        details: { checks },
      });
    return { status: 'ready', checks };
  }

  /** Runs one dependency probe under a timeout; any throw or timeout reports the dependency down. */
  async #probe(check: () => Promise<unknown>): Promise<CheckState> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS);
        }),
      ]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
