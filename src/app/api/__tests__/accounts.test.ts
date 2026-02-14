import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST } from '../accounts/route';

describe('/api/accounts', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns all seeded accounts', async () => {
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(4);

      const names = data.map((a: { name: string }) => a.name);
      expect(names).toContain('Chase Checking');
      expect(names).toContain('Ally Savings');
      expect(names).toContain('Chase Sapphire');
      expect(names).toContain('Vanguard 401k');
    });

    it('includes latest balance in response', async () => {
      const res = await GET();
      const data = await res.json();

      const checking = data.find((a: { name: string }) => a.name === 'Chase Checking');
      expect(checking.latest_balance).toBe(5000);
      expect(checking.balance_date).toBe('2025-01-31');

      const savings = data.find((a: { name: string }) => a.name === 'Ally Savings');
      expect(savings.latest_balance).toBe(25000);
    });
  });

  describe('POST', () => {
    it('creates a new account with 201 status', async () => {
      const req = new NextRequest('http://localhost/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Capital One Venture',
          type: 'credit_card',
          institution: 'Capital One',
          last_four: '9876',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.name).toBe('Capital One Venture');
      expect(data.type).toBe('credit_card');
      expect(data.institution).toBe('Capital One');
      expect(data.last_four).toBe('9876');
      expect(data.is_active).toBe(1);
    });

    it('returns 400 when missing required fields', async () => {
      const req = new NextRequest('http://localhost/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ institution: 'Some Bank' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });
});
