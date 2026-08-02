/**
 * Single source of truth for permission codes. The values must match the
 * `Permission.code` rows seeded in prisma/seed.ts — the union type below
 * makes any typo in a @RequirePermission() call a compile error instead of
 * a silently-unreachable route.
 */
export const PERM = {
  DASHBOARD_READ: 'dashboard.read',
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_WRITE: 'customers.write',
  VENDORS_READ: 'vendors.read',
  VENDORS_WRITE: 'vendors.write',
  SERVICES_READ: 'services.read',
  SERVICES_WRITE: 'services.write',
  RATES_READ: 'rates.read',
  RATES_WRITE: 'rates.write',
  QUOTATIONS_READ: 'quotations.read',
  QUOTATIONS_WRITE: 'quotations.write',
  BOOKINGS_READ: 'bookings.read',
  BOOKINGS_WRITE: 'bookings.write',
  JOBS_READ: 'jobs.read',
  JOBS_WRITE: 'jobs.write',
  INVOICES_READ: 'invoices.read',
  INVOICES_WRITE: 'invoices.write',
  // Accounts Payable — deliberately separate from invoices.*: billing a
  // customer and paying a vendor are different duties.
  PAYABLES_READ: 'payables.read',
  PAYABLES_WRITE: 'payables.write',
  // Credit control (Sprint 04). Deliberately its own code, not folded into
  // customers.write: viewing credit standing, changing a limit and overriding
  // a block are three distinct rights. Administrator and Manager only.
  CREDIT_OVERRIDE: 'credit.override',
  RATINGS_READ: 'ratings.read',
  RATINGS_WRITE: 'ratings.write',
  REPORTS_READ: 'reports.read',
  NOTIFICATIONS_READ: 'notifications.read',
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
  RECYCLE_READ: 'recycle.read',
  RECYCLE_WRITE: 'recycle.write',
  APPROVALS_READ: 'approvals.read',
  APPROVALS_WRITE: 'approvals.write',
} as const;

export type PermissionCode = (typeof PERM)[keyof typeof PERM];
