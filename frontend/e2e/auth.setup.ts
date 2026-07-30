import { expect, test as setup } from '@playwright/test';
import path from 'path';

/**
 * Log in ONCE for the whole suite and persist the session.
 *
 * Logging in per test hammers the auth endpoint, which is deliberately
 * rate-limited (stricter throttle + account lockout), so a per-test login is
 * both slower and self-defeating — the throttle starts rejecting and every
 * test fails at the login step for a reason that has nothing to do with what
 * it was testing.
 */
export const STORAGE_STATE = path.join(__dirname, '.auth', 'user.json');

const EMAIL = process.env.E2E_EMAIL || 'admin@erp.local';
const PASSWORD = process.env.E2E_PASSWORD || process.env.SEED_ADMIN_PASSWORD || 'Admin@123';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  // The login form labels its inputs rather than using placeholders.
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  // The session lives in localStorage, which storageState captures.
  await page.context().storageState({ path: STORAGE_STATE });
});
