import 'dotenv/config';
import { validateAuthConfig } from './auth.js';
import { validateProductionConfig } from './config.js';

try {
  validateProductionConfig();
  validateAuthConfig();
} catch (error) {
  console.error(`[vocabup] ${(error as Error).message}`);
  process.exit(1);
}

const { default: app } = await import('./app.js');
const { pool } = await import('./db.js');
const { REQUEST_TIMEOUT_MS } = await import('./config.js');
const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => {
  console.log(`VocabUp API listening on http://localhost:${port}`);
});
// Large APKG/CSV uploads need a longer request window than Node's 5 minute default.
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = Math.min(60_000, REQUEST_TIMEOUT_MS);
server.keepAliveTimeout = 65_000;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[vocabup] ${signal} received; closing HTTP server and MySQL pool.`);
  const forceCloseTimer = setTimeout(() => server.closeAllConnections(), 10_000);
  forceCloseTimer.unref();
  server.close(error => {
    clearTimeout(forceCloseTimer);
    if (error) {
      console.error('[vocabup] HTTP server shutdown failed.', error);
      process.exitCode = 1;
    }
    void pool.end().catch(poolError => {
      console.error('[vocabup] MySQL pool shutdown failed.', poolError);
      process.exitCode = 1;
    });
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
