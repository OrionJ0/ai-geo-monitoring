import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/marketing/browser',
  outputDir: '../output/playwright/marketing',
  reporter: [
    ['list'],
    ['html', {
      outputFolder: '../output/playwright/marketing-report',
      open: 'never',
    }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3001',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3001/geo/marketing',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
