import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST } from '../income/route';

describe('/api/income', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns all seeded income records', async () => {
      const req = new NextRequest('http://localhost/api/income');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);

      for (const record of data) {
        expect(record.gross_pay).toBe(6000);
        expect(record.net_pay).toBe(4500);
        expect(record.employer).toBe('Acme Corp');
      }
    });

    it('filters by month with ?month=2025-01', async () => {
      const req = new NextRequest('http://localhost/api/income?month=2025-01');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);
      for (const record of data) {
        expect(record.date).toMatch(/^2025-01/);
      }
    });

    it('returns empty array for month with no income', async () => {
      const req = new NextRequest('http://localhost/api/income?month=2024-06');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(0);
    });
  });

  describe('POST', () => {
    it('creates a new income record with all fields and returns 201', async () => {
      const req = new NextRequest('http://localhost/api/income', {
        method: 'POST',
        body: JSON.stringify({
          date: '2025-02-15',
          pay_period_start: '2025-02-01',
          pay_period_end: '2025-02-15',
          gross_pay: 6500,
          net_pay: 4800,
          federal_tax: 975,
          state_tax: 325,
          social_security: 403,
          medicare: 94.25,
          retirement_401k: 500,
          health_insurance: 200,
          employer: 'Acme Corp',
          source: 'manual',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.date).toBe('2025-02-15');
      expect(data.gross_pay).toBe(6500);
      expect(data.net_pay).toBe(4800);
      expect(data.federal_tax).toBe(975);
      expect(data.state_tax).toBe(325);
      expect(data.retirement_401k).toBe(500);
      expect(data.employer).toBe('Acme Corp');
    });

    it('returns 400 when missing required fields', async () => {
      const req = new NextRequest('http://localhost/api/income', {
        method: 'POST',
        body: JSON.stringify({
          employer: 'Acme Corp',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });
});
