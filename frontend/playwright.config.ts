import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Golden-path smoke test (Sprint 04 Phase B / T-6 remainder).
 *
 * Deliberately narrow: the backend integration suite already covers business
 * rules, status codes, row locking and money maths. What only a browser can
 * prove is that the shipped pages actually render and the primary journey is
 * clickable end to end.
 *
 * Assumes the dev servers are already running (backend :4000, frontend :3000);
 * this config does not start them, so the same command works locally and in CI
 * without racing two build systems.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Authenticate once; the auth endpoint is rate-limited by design, so a
    // per-test login would trip the throttle and fail unrelated assertions.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], storageState: path.join(__dirname, 'e2e', '.auth', 'user.json') },
      dependencies: ['setup'],
    },
  ],
});
