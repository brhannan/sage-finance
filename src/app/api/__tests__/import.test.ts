import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { POST } from '../import/route';

describe('/api/import', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  const rows = [
    { Date: '01/15/2025', Amount: '-45.23', Description: 'WHOLE FOODS MARKET' },
    { Date: '01/16/2025', Amount: '-12.50', Description: 'STARBUCKS STORE' },
  ];
  const mapping = { date: 'Date', amount: 'Amount', description: 'Description' };

  it('imports transactions from mapped CSV rows successfully', async () => {
    const req = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows, mapping, accountId: 1 }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.imported).toBe(2);
    expect(data.duplicates).toBe(0);
    expect(data.errors).toHaveLength(0);

    // Verify transactions exist in the database
    const txns = db.prepare('SELECT * FROM transactions WHERE source = ?').all('import');
    expect(txns).toHaveLength(2);
  });

  it('deduplicates when same rows imported twice', async () => {
    // First import
    const req1 = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows, mapping, accountId: 1 }),
    });
    const res1 = await POST(req1);
    const data1 = await res1.json();
    expect(data1.imported).toBe(2);
    expect(data1.duplicates).toBe(0);

    // Second import of same rows
    const req2 = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows, mapping, accountId: 1 }),
    });
    const res2 = await POST(req2);
    const data2 = await res2.json();

    expect(data2.imported).toBe(0);
    expect(data2.duplicates).toBe(2);
  });

  it('returns errors for rows with invalid dates', async () => {
    const badRows = [
      { Date: 'not-a-date', Amount: '-20.00', Description: 'Test item' },
      { Date: '01/17/2025', Amount: '-15.00', Description: 'Valid item' },
    ];

    const req = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows: badRows, mapping, accountId: 1 }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.imported).toBe(1);
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0]).toContain('Row 1');
    expect(data.errors[0]).toContain('date');
  });

  it('returns errors for rows with invalid amounts', async () => {
    const badRows = [
      { Date: '01/18/2025', Amount: 'abc', Description: 'Bad amount' },
      { Date: '01/19/2025', Amount: '-30.00', Description: 'Good amount' },
    ];

    const req = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows: badRows, mapping, accountId: 1 }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.imported).toBe(1);
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0]).toContain('Row 1');
    expect(data.errors[0]).toContain('amount');
  });

  it('returns 400 when missing required fields', async () => {
    // Missing accountId
    const req1 = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows, mapping }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(400);

    // Missing mapping
    const req2 = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows, accountId: 1 }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(400);

    // Missing rows
    const req3 = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ mapping, accountId: 1 }),
    });
    const res3 = await POST(req3);
    expect(res3.status).toBe(400);
  });

  it('auto-categorizes imported transactions based on description keywords', async () => {
    const req = new NextRequest('http://localhost/api/import', {
      method: 'POST',
      body: JSON.stringify({ rows, mapping, accountId: 1 }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(data.imported).toBe(2);

    // WHOLE FOODS MARKET should match Groceries (keyword: "whole foods")
    const wholeFoods = db.prepare(
      "SELECT t.*, c.name as category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.description = 'WHOLE FOODS MARKET' AND t.source = 'import'"
    ).get() as { category_name: string };
    expect(wholeFoods.category_name).toBe('Groceries');

    // STARBUCKS STORE should match Dining (keyword: "starbucks")
    const starbucks = db.prepare(
      "SELECT t.*, c.name as category_name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.description = 'STARBUCKS STORE' AND t.source = 'import'"
    ).get() as { category_name: string };
    expect(starbucks.category_name).toBe('Dining');
  });
});
