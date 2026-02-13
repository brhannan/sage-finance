import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handler AFTER vi.mock so metrics functions also use the test DB
import { GET } from '../metrics/route';

describe('/api/metrics', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  it('returns all metric fields', async () => {
    const req = new NextRequest('http://localhost/api/metrics');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);

    // Verify all expected top-level fields exist
    expect(data).toHaveProperty('savingsRate');
    expect(data).toHaveProperty('trailingSavingsRate');
    expect(data).toHaveProperty('netWorth');
    expect(data).toHaveProperty('spendingByCategory');
    expect(data).toHaveProperty('monthlyTrend');
    expect(data).toHaveProperty('goalProgress');
    expect(data).toHaveProperty('incomeExpenseTrend');

    // savingsRate should have rate, income, expenses
    expect(data.savingsRate).toHaveProperty('rate');
    expect(data.savingsRate).toHaveProperty('income');
    expect(data.savingsRate).toHaveProperty('expenses');

    // trailingSavingsRate should have rate, income, expenses
    expect(data.trailingSavingsRate).toHaveProperty('rate');
    expect(data.trailingSavingsRate).toHaveProperty('income');
    expect(data.trailingSavingsRate).toHaveProperty('expenses');

    // netWorth should have total, assets, liabilities, history
    expect(data.netWorth).toHaveProperty('total');
    expect(data.netWorth).toHaveProperty('assets');
    expect(data.netWorth).toHaveProperty('liabilities');
    expect(data.netWorth).toHaveProperty('history');

    // spendingByCategory should be an array
    expect(Array.isArray(data.spendingByCategory)).toBe(true);

    // monthlyTrend should be an array
    expect(Array.isArray(data.monthlyTrend)).toBe(true);

    // goalProgress should include seeded goals
    expect(Array.isArray(data.goalProgress)).toBe(true);
    expect(data.goalProgress).toHaveLength(2);

    // incomeExpenseTrend should be an array
    expect(Array.isArray(data.incomeExpenseTrend)).toBe(true);
  });

  it('returns month-specific metrics with ?month=2025-01', async () => {
    const req = new NextRequest('http://localhost/api/metrics?month=2025-01');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);

    // Savings rate for 2025-01: income=9000 (two paychecks at 4500 net), expenses=2495
    // Rate = ((9000 - 2495) / 9000) * 100 = 72.3%
    expect(data.savingsRate.income).toBe(9000);
    expect(data.savingsRate.expenses).toBe(2495);
    expect(data.savingsRate.rate).toBeCloseTo(72.3, 0);

    // spendingByCategory for 2025-01 should contain the seeded categories
    expect(data.spendingByCategory.length).toBeGreaterThan(0);
    const categoryNames = data.spendingByCategory.map((c: { name: string }) => c.name);
    expect(categoryNames).toContain('Housing');
    expect(categoryNames).toContain('Groceries');
  });
});
