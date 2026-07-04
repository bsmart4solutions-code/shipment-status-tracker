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
  JOBS_READ: 'jobs.read',
  JOBS_WRITE: 'jobs.write',
  INVOICES_READ: 'invoices.read',
  INVOICES_WRITE: 'invoices.write',
  RATINGS_READ: 'ratings.read',
  RATINGS_WRITE: 'ratings.write',
  REPORTS_READ: 'reports.read',
  NOTIFICATIONS_READ: 'notifications.read',
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
} as const;

export type PermissionCode = (typeof PERM)[keyof typeof PERM];
