import { defineConfig } from '@playwright/test';

const externalBaseURL = process.env.MARKETING_E2E_BASE_URL;
const baseURL = externalBaseURL || 'http://127.0.0.1:3011';
const runId = process.env.MARKETING_E2E_RUN_ID || String(process.pid);

export default defineConfig({
  testDir: './tests/marketing/browser',
  outputDir: `../output/playwright/marketing-${runId}`,
  reporter: [
    ['list'],
    ['html', {
      outputFolder: `../output/playwright/marketing-report-${runId}`,
      open: 'never',
    }],
  ],
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: externalBaseURL ? undefined : {
    command: 'node_modules/.bin/next start -H 127.0.0.1 -p 3011',
    url: 'http://127.0.0.1:3011/geo/market-overview',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
