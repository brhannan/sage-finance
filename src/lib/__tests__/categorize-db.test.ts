import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './test-db';

let db: Database.Database;

vi.mock('@/lib/db', () => ({
  getDb: () => db,
}));

// Import AFTER vi.mock so the mock is in place when the module loads
import { autoCategorize } from '../categorize';

describe('autoCategorize (database-backed)', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  it('matches "WHOLE FOODS MARKET #123" to Groceries category', () => {
    const groceriesId = (db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").get() as { id: number }).id;
    const result = autoCategorize('WHOLE FOODS MARKET #123');
    expect(result).toBe(groceriesId);
  });

  it('matches "STARBUCKS STORE 456" to Dining category', () => {
    const diningId = (db.prepare("SELECT id FROM categories WHERE name = 'Dining'").get() as { id: number }).id;
    const result = autoCategorize('STARBUCKS STORE 456');
    expect(result).toBe(diningId);
  });

  it('matches "AMAZON.COM*123" to Shopping category', () => {
    const shoppingId = (db.prepare("SELECT id FROM categories WHERE name = 'Shopping'").get() as { id: number }).id;
    const result = autoCategorize('AMAZON.COM*123');
    expect(result).toBe(shoppingId);
  });

  it('matches "NETFLIX subscription" to Entertainment category', () => {
    const entertainmentId = (db.prepare("SELECT id FROM categories WHERE name = 'Entertainment'").get() as { id: number }).id;
    const result = autoCategorize('NETFLIX subscription');
    expect(result).toBe(entertainmentId);
  });

  it('returns null for an unrecognizable description', () => {
    const result = autoCategorize('RANDOM STORE XYZ');
    expect(result).toBeNull();
  });

  it('performs case-insensitive matching', () => {
    const groceriesId = (db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").get() as { id: number }).id;
    const result = autoCategorize('whole foods market');
    expect(result).toBe(groceriesId);
  });
});
