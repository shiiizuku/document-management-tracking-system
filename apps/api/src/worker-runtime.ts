import { createServer, type Server, type ServerResponse } from 'node:http';

export interface WorkerHealthServerOptions {
  port: number;
  host?: string;
}

const sendJson = (response: ServerResponse, body: object): void => {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

export const startWorkerHealthServer = async ({
  port,
  host = '0.0.0.0',
}: WorkerHealthServerOptions): Promise<Server> => {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, {
        status: 'ok',
        service: 'dts-worker',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/ready') {
      sendJson(response, { status: 'ready' });
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
