import { beforeEach, describe, expect, it } from 'vitest';
import { hasPermission } from './api';

const setUser = (user: unknown) => localStorage.setItem('erp_user', JSON.stringify(user));

describe('hasPermission', () => {
  beforeEach(() => localStorage.clear());

  it('is false with no session', () => {
    expect(hasPermission('customers.read')).toBe(false);
  });

  it('grants everything to Administrator regardless of permission list', () => {
    setUser({ id: '1', email: 'a@x', fullName: 'A', role: 'Administrator', permissions: [] });
    expect(hasPermission('anything.at.all')).toBe(true);
  });

  it('checks the permission list for other roles', () => {
    setUser({ id: '2', email: 's@x', fullName: 'S', role: 'Sales', permissions: ['quotations.read', 'quotations.write'] });
    expect(hasPermission('quotations.write')).toBe(true);
    expect(hasPermission('invoices.write')).toBe(false);
  });
});
