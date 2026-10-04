import { defineConfig } from '@playwright/test';

// Journeys run against the real server (make run) and the real survey (PID, default "plot").
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.MERA_URL ?? 'http://127.0.0.1:8765',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
  },
});
