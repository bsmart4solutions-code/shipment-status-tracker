import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Pagination, StatusBadge } from './ui';

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="PAID" />);
    expect(screen.getByText('PAID')).toBeTruthy();
  });
});

describe('Pagination', () => {
  it('shows the current page and total', () => {
    render(<Pagination page={2} pageCount={5} onChange={() => undefined} />);
    expect(screen.getByText(/2/)).toBeTruthy();
    expect(screen.getByText(/5/)).toBeTruthy();
  });

  it('disables Prev on the first page', () => {
    render(<Pagination page={1} pageCount={3} onChange={() => undefined} />);
    const buttons = screen.getAllByRole('button');
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
