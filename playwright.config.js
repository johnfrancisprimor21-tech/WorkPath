import { defineConfig, devices } from '@playwright/test';
import { loadE2EEnvironment } from './tests/e2e/environment.js';

loadE2EEnvironment();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
  globalSetup: './tests/e2e/global-setup.js',
  globalTeardown: './tests/e2e/global-teardown.js',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    timezoneId: 'Asia/Manila',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      grepInvert: /@phone|@account/
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      grep: /@phone/,
      grepInvert: /@account/
    },
    {
      name: 'account-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        trace: 'off',
        screenshot: 'off',
        video: 'off'
      },
      grep: /@account/
    }
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
