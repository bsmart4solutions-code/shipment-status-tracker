import { assertApprovalAllows, requiredApprovalStatus } from './approval.logic';

describe('Quotation approval — threshold decision', () => {
  it('is disabled when no threshold is configured (0 / negative / NaN)', () => {
    expect(requiredApprovalStatus(1_000_000, 0)).toBe('NOT_REQUIRED');
    expect(requiredApprovalStatus(1_000_000, -5)).toBe('NOT_REQUIRED');
    expect(requiredApprovalStatus(1_000_000, NaN)).toBe('NOT_REQUIRED');
  });

  it('requires approval at or above the threshold', () => {
    expect(requiredApprovalStatus(50_000, 50_000)).toBe('PENDING');
    expect(requiredApprovalStatus(50_001, 50_000)).toBe('PENDING');
  });

  it('does not require approval below the threshold', () => {
    expect(requiredApprovalStatus(49_999.99, 50_000)).toBe('NOT_REQUIRED');
  });
});

describe('Quotation approval — action gate', () => {
  it('allows commercial actions when approval is not required or granted', () => {
    expect(() => assertApprovalAllows('SENT', 'NOT_REQUIRED')).not.toThrow();
    expect(() => assertApprovalAllows('WON', 'APPROVED')).not.toThrow();
  });

  it('blocks sending and winning while approval is pending', () => {
    expect(() => assertApprovalAllows('SENT', 'PENDING')).toThrow(/awaiting approval/);
    expect(() => assertApprovalAllows('WON', 'PENDING')).toThrow(/awaiting approval/);
  });

  it('blocks a rejected quotation until it is revised', () => {
    expect(() => assertApprovalAllows('SENT', 'REJECTED')).toThrow(/rejected/);
    expect(() => assertApprovalAllows('WON', 'REJECTED')).toThrow(/rejected/);
  });
});
