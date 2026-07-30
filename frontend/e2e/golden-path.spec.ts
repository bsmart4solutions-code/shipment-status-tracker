import { expect, test } from '@playwright/test';

/**
 * Golden path: login → quotations → jobs → invoices, plus the two Sprint 04
 * credit surfaces.
 *
 * Scope is deliberately shallow. Business rules are proven by the backend
 * integration suite; this exists to catch the failures only a browser sees —
 * a page that does not render, a route that 404s, a table that never loads,
 * a dialog that cannot open.
 */

// Session comes from auth.setup.ts via storageState — no per-test login, so
// the rate-limited auth endpoint is hit exactly once per run.
test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
});

test('reaches the dashboard with a restored session', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  // The sidebar is the app shell — if it renders, permissions resolved.
  await expect(page.getByRole('link', { name: 'Invoices' })).toBeVisible();
});

test('walks the commercial golden path: quotations → jobs → invoices', async ({ page }) => {
  for (const [link, heading] of [
    ['Quotations', /quotations/i],
    ['Jobs / Shipments', /jobs/i],
    ['Invoices', /invoices/i],
  ] as const) {
    await page.getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    // Every list page must reach a settled state, not hang on "Loading…".
    await expect(page.locator('table')).toBeVisible();
  }
});

test('reaches payables and opens the AP aging report', async ({ page }) => {
  await page.getByRole('link', { name: 'Payables' }).click();
  await expect(page.getByRole('heading', { name: /payables/i })).toBeVisible();
  await page.getByRole('button', { name: /AP Aging/i }).click();
  await expect(page.getByText(/what we owe/i)).toBeVisible();
});

test('shows customer credit standing (Sprint 04)', async ({ page }) => {
  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page.getByRole('heading', { name: /customers/i })).toBeVisible();

  // The credit column added in Phase B.
  await expect(page.getByRole('columnheader', { name: 'Credit', exact: true })).toBeVisible();

  // The credit panel opens and reports the base-currency exposure.
  await page.getByRole('button', { name: 'Credit' }).first().click();
  await expect(page.getByText(/Outstanding \(exposure\)/i)).toBeVisible();
  await expect(page.getByText(/Effective limit/i)).toBeVisible();
});

test('invoice Issue opens the credit check before committing', async ({ page }) => {
  await page.getByRole('link', { name: 'Invoices' }).click();
  // The table element renders before its rows arrive, so waiting on the table
  // alone would count buttons that do not exist yet.
  await expect(page.locator('tbody tr').first()).toBeVisible();

  const issue = page.getByRole('button', { name: 'Issue' }).first();
  // Only DRAFT invoices offer Issue; skip cleanly when the dataset has none
  // rather than asserting on data this test does not own.
  test.skip(await issue.count() === 0, 'no DRAFT invoice available in this dataset');

  await issue.click();
  await expect(page.getByText(/Credit check (passed|failed)/i)).toBeVisible();
});
