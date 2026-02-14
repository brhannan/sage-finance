import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST } from '../balances/route';

describe('/api/balances', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns seeded balances with account metadata', async () => {
      const req = new NextRequest('http://localhost/api/balances');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(4);

      // Verify account metadata is joined
      const checking = data.find((b: { account_name: string }) => b.account_name === 'Chase Checking');
      expect(checking).toBeDefined();
      expect(checking.balance).toBe(5000);
      expect(checking.account_type).toBe('checking');
      expect(checking.date).toBe('2025-01-31');

      const savings = data.find((b: { account_name: string }) => b.account_name === 'Ally Savings');
      expect(savings).toBeDefined();
      expect(savings.balance).toBe(25000);
      expect(savings.account_type).toBe('savings');
    });
  });

  describe('POST', () => {
    it('creates a balance entry with 201 status', async () => {
      const req = new NextRequest('http://localhost/api/balances', {
        method: 'POST',
        body: JSON.stringify({
          account_id: 1,
          date: '2025-02-28',
          balance: 5500,
          source: 'manual',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.balance).toBe(5500);
      expect(data.date).toBe('2025-02-28');
      expect(data.account_name).toBe('Chase Checking');
      expect(data.account_type).toBe('checking');
    });

    it('upserts when same account_id and date exists', async () => {
      // First, insert a balance for account 1 on 2025-01-31 (already exists from seed)
      const req = new NextRequest('http://localhost/api/balances', {
        method: 'POST',
        body: JSON.stringify({
          account_id: 1,
          date: '2025-01-31',
          balance: 6000,
          source: 'updated',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.balance).toBe(6000);
      expect(data.source).toBe('updated');

      // Verify only one balance record for this account+date
      const getReq = new NextRequest('http://localhost/api/balances?account_id=1');
      const getRes = await GET(getReq);
      const allBalances = await getRes.json();

      const jan31Entries = allBalances.filter(
        (b: { date: string; account_name: string }) =>
          b.date === '2025-01-31' && b.account_name === 'Chase Checking'
      );
      expect(jan31Entries).toHaveLength(1);
      expect(jan31Entries[0].balance).toBe(6000);
    });
  });
});
