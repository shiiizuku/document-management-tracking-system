import { createServer, type Server, type ServerResponse } from 'node:http';

export type WorkerCheckState = 'up' | 'down';

export interface WorkerHealthServerOptions {
  port: number;
  host?: string;
  /**
   * Optional readiness probe. When provided, `/ready` returns its checks and answers 503 if any
   * dependency is down; without it, `/ready` is a static "ready" (liveness-equivalent). The
   * worker passes a probe for the dependencies on its own critical path — Postgres and Redis.
   */
  readiness?: () => Promise<Record<string, WorkerCheckState>>;
}

const sendJson = (response: ServerResponse, status: number, body: object): void => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

export const startWorkerHealthServer = async ({
  port,
  host = '0.0.0.0',
  readiness,
}: WorkerHealthServerOptions): Promise<Server> => {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'dts-worker',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/ready') {
      if (readiness === undefined) {
        sendJson(response, 200, { status: 'ready' });
        return;
      }
      readiness()
        .then((checks) => {
          const ready = Object.values(checks).every((state) => state === 'up');
          sendJson(response, ready ? 200 : 503, {
            status: ready ? 'ready' : 'not-ready',
            checks,
          });
        })
        .catch(() => sendJson(response, 503, { status: 'not-ready' }));
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
};
