import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.constants.js';
import type { Database } from '../../database/client.js';

type CheckState = 'up' | 'down';

const PROBE_TIMEOUT_MS = 2_000;

/**
 * Liveness answers "is the process running"; readiness answers "can it serve traffic".
 * Conflating them makes an orchestrator restart a healthy API whenever Postgres blips,
 * so `/health` stays dependency-free and only `/ready` probes downstream services.
 */
@Controller()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

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
    const database = await this.#probeDatabase();
    const checks: Record<string, CheckState> = { database };
    if (Object.values(checks).some((state) => state === 'down'))
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: 'One or more dependencies are unavailable',
        details: { checks },
      });
    return { status: 'ready', checks };
  }

  async #probeDatabase(): Promise<CheckState> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.database.execute(sql`select 1`),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('database probe timed out')), PROBE_TIMEOUT_MS);
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
