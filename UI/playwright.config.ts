import { defineConfig } from '@playwright/test';

// Browser tests (e2e/*.e2e.ts) against a production build, using the built-in simulator instead of a USB device.
// Run with: pnpm test:e2e
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.e2e.ts',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173',
    // Playwright's bundled Chromium does not support macOS 13, so locally use the installed Chrome.
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: 'vite build && vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
