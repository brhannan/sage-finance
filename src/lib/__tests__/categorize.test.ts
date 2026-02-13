import { describe, it, expect } from 'vitest';
import { normalizeDate, getImportHash } from '../categorize';

describe('normalizeDate', () => {
  it('passes through YYYY-MM-DD unchanged', () => {
    expect(normalizeDate('2025-01-15')).toBe('2025-01-15');
  });

  it('converts MM/DD/YYYY to YYYY-MM-DD', () => {
    expect(normalizeDate('01/15/2025')).toBe('2025-01-15');
  });

  it('handles single-digit month and day (M/D/YYYY)', () => {
    expect(normalizeDate('1/5/2025')).toBe('2025-01-05');
  });

  it('converts two-digit year (20xx for <=50)', () => {
    expect(normalizeDate('01/15/25')).toBe('2025-01-15');
  });

  it('converts two-digit year (19xx for >50)', () => {
    expect(normalizeDate('01/15/99')).toBe('1999-01-15');
  });

  it('handles MM/DD (no year) using current year', () => {
    const result = normalizeDate('03/15');
    const year = new Date().getFullYear();
    expect(result).toBe(`${year}-03-15`);
  });

  it('converts MM-DD-YYYY dash format', () => {
    expect(normalizeDate('01-15-2025')).toBe('2025-01-15');
  });

  it('converts MM.DD.YYYY dot format', () => {
    expect(normalizeDate('01.15.2025')).toBe('2025-01-15');
  });

  it('handles natural language dates via Date constructor fallback', () => {
    const result = normalizeDate('Jan 15, 2025');
    expect(result).toBe('2025-01-15');
  });

  it('returns null for unparseable dates', () => {
    expect(normalizeDate('not-a-date')).toBeNull();
  });

  it('trims whitespace before parsing', () => {
    expect(normalizeDate('  01/15/2025  ')).toBe('2025-01-15');
  });
});

describe('getImportHash', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = getImportHash('2025-01-15', -45.23, 'WHOLE FOODS');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic — same inputs produce same hash', () => {
    const hash1 = getImportHash('2025-01-15', -45.23, 'WHOLE FOODS', 1);
    const hash2 = getImportHash('2025-01-15', -45.23, 'WHOLE FOODS', 1);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different amounts', () => {
    const hash1 = getImportHash('2025-01-15', -45.23, 'WHOLE FOODS', 1);
    const hash2 = getImportHash('2025-01-15', -99.99, 'WHOLE FOODS', 1);
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different accounts', () => {
    const hash1 = getImportHash('2025-01-15', -45.23, 'WHOLE FOODS', 1);
    const hash2 = getImportHash('2025-01-15', -45.23, 'WHOLE FOODS', 2);
    expect(hash1).not.toBe(hash2);
  });

  it('handles missing accountId gracefully', () => {
    const hash = getImportHash('2025-01-15', -45.23, 'WHOLE FOODS');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
