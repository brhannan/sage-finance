import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from './test-db';

let db: Database.Database;

vi.mock('@/lib/db', () => ({
  getDb: () => db,
}));

// Import AFTER vi.mock so the mock is in place when the modules load
import {
  getSavingsRate,
  getNetWorth,
  getSpendingByCategory,
  getGoalProgress,
  getMonthlyIncomeExpenseTrend,
  getAccountBreakdown,
} from '../metrics';

describe('metrics (database-backed)', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  // --- getSavingsRate ---
  describe('getSavingsRate', () => {
    it('returns correct income for January 2025', () => {
      const result = getSavingsRate('2025-01');
      expect(result.income).toBe(9000);
    });

    it('returns correct expenses for January 2025', () => {
      const result = getSavingsRate('2025-01');
      expect(result.expenses).toBe(2495);
    });

    it('calculates savings rate as (income - expenses) / income * 100', () => {
      const result = getSavingsRate('2025-01');
      const expected = Math.round(((9000 - 2495) / 9000) * 1000) / 10;
      expect(result.rate).toBe(expected);
    });

    it('returns zero income and expenses for a month with no data', () => {
      const result = getSavingsRate('2024-06');
      expect(result.income).toBe(0);
      expect(result.expenses).toBe(0);
      expect(result.rate).toBe(0);
    });
  });

  // --- getNetWorth ---
  describe('getNetWorth', () => {
    it('calculates total assets correctly', () => {
      const result = getNetWorth();
      // checking(5000) + savings(25000) + investment(150000)
      expect(result.assets).toBe(180000);
    });

    it('calculates total liabilities correctly', () => {
      const result = getNetWorth();
      // credit_card(1500)
      expect(result.liabilities).toBe(1500);
    });

    it('calculates net worth as assets minus liabilities', () => {
      const result = getNetWorth();
      expect(result.total).toBe(178500);
    });

    it('returns a history array with at least one entry', () => {
      const result = getNetWorth();
      expect(result.history).toBeInstanceOf(Array);
      expect(result.history.length).toBeGreaterThanOrEqual(1);
    });

    it('history entries have assets, liabilities, and netWorth fields', () => {
      const result = getNetWorth();
      for (const entry of result.history) {
        expect(entry).toHaveProperty('date');
        expect(entry).toHaveProperty('assets');
        expect(entry).toHaveProperty('liabilities');
        expect(entry).toHaveProperty('netWorth');
        expect(typeof entry.assets).toBe('number');
        expect(typeof entry.liabilities).toBe('number');
        expect(typeof entry.netWorth).toBe('number');
      }
    });

    it('netWorth equals assets minus liabilities for each history entry', () => {
      const result = getNetWorth();
      for (const entry of result.history) {
        expect(entry.netWorth).toBe(entry.assets - entry.liabilities);
      }
    });
  });

  // --- getSpendingByCategory ---
  describe('getSpendingByCategory', () => {
    it('returns Housing spending of 2000 for January 2025', () => {
      const result = getSpendingByCategory('2025-01');
      const housing = result.find(r => r.name === 'Housing');
      expect(housing).toBeDefined();
      expect(housing!.amount).toBe(2000);
    });

    it('returns Groceries spending of 250 for January 2025', () => {
      const result = getSpendingByCategory('2025-01');
      const groceries = result.find(r => r.name === 'Groceries');
      expect(groceries).toBeDefined();
      expect(groceries!.amount).toBe(250);
    });

    it('returns Shopping spending of 200 for January 2025', () => {
      const result = getSpendingByCategory('2025-01');
      const shopping = result.find(r => r.name === 'Shopping');
      expect(shopping).toBeDefined();
      expect(shopping!.amount).toBe(200);
    });

    it('returns Dining spending of 45 for January 2025', () => {
      const result = getSpendingByCategory('2025-01');
      const dining = result.find(r => r.name === 'Dining');
      expect(dining).toBeDefined();
      expect(dining!.amount).toBe(45);
    });

    it('returns an empty array for a month with no spending', () => {
      const result = getSpendingByCategory('2024-06');
      expect(result).toEqual([]);
    });
  });

  // --- getGoalProgress ---
  describe('getGoalProgress', () => {
    it('returns two active goals', () => {
      const result = getGoalProgress();
      expect(result).toHaveLength(2);
    });

    it('calculates Emergency Fund progress as ~83.3%', () => {
      const result = getGoalProgress();
      const emergencyFund = result.find(g => g.name === 'Emergency Fund');
      expect(emergencyFund).toBeDefined();
      // (25000 / 30000) * 100 = 83.333...
      expect(emergencyFund!.progress).toBeCloseTo(83.33, 0);
    });

    it('calculates House Down Payment progress as 40%', () => {
      const result = getGoalProgress();
      const houseFund = result.find(g => g.name === 'House Down Payment');
      expect(houseFund).toBeDefined();
      expect(houseFund!.progress).toBe(40);
    });
  });

  // --- getMonthlyIncomeExpenseTrend ---
  describe('getMonthlyIncomeExpenseTrend', () => {
    it('returns an array of the expected length', () => {
      const result = getMonthlyIncomeExpenseTrend(1);
      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1);
    });

    it('each entry has the expected shape', () => {
      const result = getMonthlyIncomeExpenseTrend(3);
      for (const entry of result) {
        expect(entry).toHaveProperty('month');
        expect(entry).toHaveProperty('income');
        expect(entry).toHaveProperty('expenses');
        expect(entry).toHaveProperty('savings');
        expect(entry).toHaveProperty('savingsRate');
        expect(typeof entry.month).toBe('string');
        expect(typeof entry.income).toBe('number');
        expect(typeof entry.expenses).toBe('number');
      }
    });
  });

  // --- getAccountBreakdown ---
  describe('getAccountBreakdown', () => {
    it('returns all 4 active accounts', () => {
      const result = getAccountBreakdown();
      expect(result).toHaveLength(4);
    });

    it('includes the Vanguard 401k investment account with correct balance', () => {
      const result = getAccountBreakdown();
      const vanguard = result.find(a => a.name === 'Vanguard 401k');
      expect(vanguard).toBeDefined();
      expect(vanguard!.type).toBe('investment');
      expect(vanguard!.balance).toBe(150000);
    });

    it('orders investment accounts before checking accounts', () => {
      const result = getAccountBreakdown();
      const investmentIdx = result.findIndex(a => a.type === 'investment');
      const checkingIdx = result.findIndex(a => a.type === 'checking');
      expect(investmentIdx).toBeLessThan(checkingIdx);
    });
  });
});
