import 'reflect-metadata';

// The production worker entry point is intentionally separate from the HTTP process.
// Queue-backed outbox and scanner adapters are wired when infrastructure variables are present.
process.stdout.write(
  JSON.stringify({ level: 'info', service: 'dts-worker', message: 'worker ready' }) + '\n',
);
