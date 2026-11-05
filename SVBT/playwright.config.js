import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  workers: 1,
  use: { baseURL: 'http://localhost:3005', headless: true, browserName: 'chromium', channel: 'msedge' },
  webServer: { command: 'node server/index.js --dev', url: 'http://localhost:3005/api/health', reuseExistingServer: false, env: { NODE_ENV: 'test', PORT: '3005', APP_ORIGIN: 'http://localhost:3005', DB_PATH: '.tools/ui-test.sqlite', STATEMENT_DIR: '.tools/ui-statements', DEMO_SEED: 'true' }, timeout: 120000 }
});
