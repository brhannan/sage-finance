import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getImportHash, normalizeDate } from '../categorize';

interface Category {
  id: number;
  name: string;
  keywords: string | null;
}

/** Mirrors autoCategorize() but uses the provided test DB instead of the global singleton. */
function categorize(db: Database.Database, description: string): number | null {
  const categories = db.prepare(
    "SELECT id, name, keywords FROM categories WHERE keywords IS NOT NULL AND keywords != ''"
  ).all() as Category[];
  const descLower = description.toLowerCase();
  for (const cat of categories) {
    if (!cat.keywords) continue;
    const keywords = cat.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    for (const kw of keywords) {
      if (descLower.includes(kw)) return cat.id;
    }
  }
  return null;
}

/**
 * Simulates the transaction import pipeline used by both
 * /api/import and /api/advisor/upload — parsing rows, normalizing
 * dates/amounts, auto-categorizing, hashing for dedup, and inserting.
 */
function importTransactions(
  db: Database.Database,
  rows: Array<{ date: string; amount: string; description: string }>,
  accountId: number
) {
  const insertStmt = db.prepare(`
    INSERT INTO transactions (date, amount, description, category_id, account_id, type, import_hash, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'import')
  `);
  const checkHash = db.prepare('SELECT id FROM transactions WHERE import_hash = ?');
  const checkDateAmount = db.prepare(
    'SELECT id FROM transactions WHERE date = ? AND amount = ? AND account_id = ?'
  );

  let imported = 0;
  let duplicates = 0;
  const errors: string[] = [];

  const insertMany = db.transaction(() => {
    for (const row of rows) {
      const date = normalizeDate(row.date);
      if (!date) {
        errors.push(`could not parse date "${row.date}"`);
        continue;
      }

      const amount = parseFloat(row.amount.replace(/[,$]/g, ''));
      if (isNaN(amount)) {
        errors.push(`invalid amount "${row.amount}"`);
        continue;
      }

      const description = row.description.trim();
      const type = amount > 0 ? 'income' : 'expense';
      const categoryId = categorize(db, description);
      const importHash = getImportHash(date, amount, description, accountId);

      const existing = checkHash.get(importHash);
      if (existing) {
        duplicates++;
        continue;
      }

      const existingByDateAmount = checkDateAmount.get(date, amount, accountId);
      if (existingByDateAmount) {
        duplicates++;
        continue;
      }

      insertStmt.run(date, amount, description, categoryId, accountId, type, importHash);
      imported++;
    }
  });

  insertMany();
  return { imported, duplicates, errors };
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      institution TEXT,
      last_four TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER,
      budget_amount REAL,
      color TEXT,
      icon TEXT,
      keywords TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      category_id INTEGER,
      account_id INTEGER,
      type TEXT NOT NULL DEFAULT 'expense',
      notes TEXT,
      import_hash TEXT UNIQUE,
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO categories (name, keywords) VALUES
      ('Groceries', 'grocery,whole foods,trader joe'),
      ('Dining', 'restaurant,starbucks,coffee,chipotle'),
      ('Shopping', 'amazon,target,walmart');

    INSERT INTO accounts (name, type, institution) VALUES
      ('Chase Sapphire', 'credit_card', 'Chase');
  `);
  return db;
}

const SAMPLE_STATEMENT = [
  { date: '01/15/2025', amount: '-45.23', description: 'WHOLE FOODS MARKET #123' },
  { date: '01/16/2025', amount: '-12.50', description: 'STARBUCKS STORE 456' },
  { date: '01/17/2025', amount: '-89.99', description: 'AMAZON.COM*AB1CD2EF3' },
  { date: '01/18/2025', amount: '-33.00', description: 'CHIPOTLE ONLINE 789' },
  { date: '01/20/2025', amount: '500.00', description: 'PAYMENT THANK YOU' },
];

describe('Import deduplication', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('imports all transactions on first import', () => {
    const result = importTransactions(db, SAMPLE_STATEMENT, 1);

    expect(result.imported).toBe(5);
    expect(result.duplicates).toBe(0);
    expect(result.errors).toHaveLength(0);

    const count = db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number };
    expect(count.c).toBe(5);
  });

  it('reports all as duplicates when the same CSV is imported twice', () => {
    const first = importTransactions(db, SAMPLE_STATEMENT, 1);
    expect(first.imported).toBe(5);

    const second = importTransactions(db, SAMPLE_STATEMENT, 1);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(5);

    // DB still has exactly 5 rows — no doubles
    const count = db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number };
    expect(count.c).toBe(5);
  });

  it('imports new transactions while skipping duplicates from a partial overlap', () => {
    importTransactions(db, SAMPLE_STATEMENT, 1);

    const overlappingStatement = [
      // 2 rows from the original statement (duplicates)
      { date: '01/15/2025', amount: '-45.23', description: 'WHOLE FOODS MARKET #123' },
      { date: '01/16/2025', amount: '-12.50', description: 'STARBUCKS STORE 456' },
      // 2 genuinely new rows
      { date: '01/21/2025', amount: '-22.00', description: 'TARGET STORE 101' },
      { date: '01/22/2025', amount: '-15.75', description: 'TRADER JOE STORE 202' },
    ];

    const result = importTransactions(db, overlappingStatement, 1);
    expect(result.imported).toBe(2);
    expect(result.duplicates).toBe(2);

    const count = db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number };
    expect(count.c).toBe(7); // 5 original + 2 new
  });

  it('treats same transaction on different accounts as distinct', () => {
    // Add a second account
    db.prepare("INSERT INTO accounts (name, type, institution) VALUES ('Amex Gold', 'credit_card', 'Amex')").run();

    const row = [{ date: '01/15/2025', amount: '-45.23', description: 'WHOLE FOODS MARKET #123' }];

    const result1 = importTransactions(db, row, 1); // Chase account
    const result2 = importTransactions(db, row, 2); // Amex account

    expect(result1.imported).toBe(1);
    expect(result2.imported).toBe(1); // Different account → not a duplicate

    const count = db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('auto-categorizes transactions based on description keywords', () => {
    importTransactions(db, SAMPLE_STATEMENT, 1);

    const txns = db.prepare(`
      SELECT t.description, c.name as category
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      ORDER BY t.date
    `).all() as Array<{ description: string; category: string | null }>;

    const byDesc = Object.fromEntries(txns.map(t => [t.description, t.category]));

    expect(byDesc['WHOLE FOODS MARKET #123']).toBe('Groceries');
    expect(byDesc['STARBUCKS STORE 456']).toBe('Dining');
    expect(byDesc['AMAZON.COM*AB1CD2EF3']).toBe('Shopping');
    expect(byDesc['CHIPOTLE ONLINE 789']).toBe('Dining');
  });

  it('deduplicates cross-format imports with different descriptions (CSV vs PDF)', () => {
    // CSV import: shorter descriptions
    const csvRows = [
      { date: '02/06/2026', amount: '-94.50', description: 'SUGAR BOWL - TICKETS' },
      { date: '02/06/2026', amount: '-29.88', description: 'Uber Trip' },
      { date: '02/06/2026', amount: '-37.06', description: 'TAHOE DAVES STORE #6' },
    ];
    const csvResult = importTransactions(db, csvRows, 1);
    expect(csvResult.imported).toBe(3);

    // PDF import: same transactions with longer, different descriptions
    const pdfRows = [
      { date: '02/06/2026', amount: '-94.50', description: 'AplPay SUGAR BOWL - NORDEN CA' },
      { date: '02/06/2026', amount: '-29.88', description: 'UBER' },
      { date: '02/06/2026', amount: '-37.06', description: 'AplPay TAHOE DAVES STRUCKEE CA' },
    ];
    const pdfResult = importTransactions(db, pdfRows, 1);
    expect(pdfResult.imported).toBe(0);
    expect(pdfResult.duplicates).toBe(3); // All caught by date+amount+account check

    const count = db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number };
    expect(count.c).toBe(3); // Only the original 3
  });

  it('normalizes various date formats consistently', () => {
    const mixedDates = [
      { date: '2025-01-15', amount: '-10.00', description: 'ISO format' },
      { date: '1/5/2025', amount: '-20.00', description: 'Short slash format' },
      { date: '01/05/25', amount: '-30.00', description: 'Two-digit year' },
    ];

    importTransactions(db, mixedDates, 1);

    const dates = db.prepare('SELECT date FROM transactions ORDER BY date').all() as Array<{ date: string }>;
    expect(dates.map(d => d.date)).toEqual([
      '2025-01-05', // both slash formats normalize to same date
      '2025-01-05',
      '2025-01-15',
    ]);
  });
});
