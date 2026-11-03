import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const databaseName = process.env.E2E_DB_NAME ?? 'vocabup_test';
const databaseHost = process.env.E2E_DB_HOST ?? '127.0.0.1';
const databasePassword = process.env.E2E_DB_PASSWORD;

if (databaseName !== 'vocabup_test') {
  throw new Error('Playwright E2E is restricted to DB_NAME=vocabup_test.');
}
if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)) {
  throw new Error('Playwright E2E requires a loopback MySQL host; remote databases are refused.');
}
if (!databasePassword) {
  throw new Error('Set E2E_DB_PASSWORD for the isolated MySQL test database.');
}

const childEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  FRONTEND_URL: baseURL,
  DB_HOST: databaseHost,
  DB_PORT: process.env.E2E_DB_PORT ?? '3307',
  DB_NAME: databaseName,
  DB_USER: process.env.E2E_DB_USER ?? 'root',
  DB_PASSWORD: databasePassword,
  JWT_SECRET: process.env.E2E_JWT_SECRET ?? randomBytes(32).toString('hex'),
  TRUST_PROXY: '0',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright/report', open: 'never' }]],
  outputDir: 'artifacts/playwright/results',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: childEnv,
  },
});
