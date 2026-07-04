import { parseCsv } from './csv-parse.util';

describe('parseCsv', () => {
  it('parses a simple header + rows into keyed objects', () => {
    const rows = parseCsv('companyName,email\nAcme,acme@x.com\nBeta,beta@y.com');
    expect(rows).toEqual([
      { companyname: 'Acme', email: 'acme@x.com' },
      { companyname: 'Beta', email: 'beta@y.com' },
    ]);
  });

  it('lower-cases and trims headers', () => {
    const rows = parseCsv(' Company Name , Email \nAcme,a@x.com');
    expect(Object.keys(rows[0])).toEqual(['company name', 'email']);
  });

  it('handles quoted fields containing commas', () => {
    const rows = parseCsv('name,address\n"Acme, Inc.","1 Main St, KL"');
    expect(rows[0]).toEqual({ name: 'Acme, Inc.', address: '1 Main St, KL' });
  });

  it('handles escaped quotes inside quoted fields', () => {
    const rows = parseCsv('name\n"He said ""hi"""');
    expect(rows[0].name).toBe('He said "hi"');
  });

  it('handles newlines inside quoted fields', () => {
    const rows = parseCsv('name,note\nAcme,"line1\nline2"');
    expect(rows[0].note).toBe('line1\nline2');
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const rows = parseCsv('﻿name\nAcme');
    expect(Object.keys(rows[0])).toEqual(['name']);
  });

  it('skips fully blank lines', () => {
    const rows = parseCsv('name\nAcme\n\nBeta\n');
    expect(rows.map((r) => r.name)).toEqual(['Acme', 'Beta']);
  });

  it('tolerates CRLF line endings', () => {
    const rows = parseCsv('name,email\r\nAcme,a@x.com\r\n');
    expect(rows).toEqual([{ name: 'Acme', email: 'a@x.com' }]);
  });

  it('returns empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
