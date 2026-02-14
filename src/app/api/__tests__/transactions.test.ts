import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST } from '../transactions/route';
import { PUT, DELETE } from '../transactions/[id]/route';

describe('/api/transactions', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns all seeded transactions', async () => {
      const req = new NextRequest('http://localhost/api/transactions');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(5);
    });

    it('filters by month with ?month=2025-01', async () => {
      const req = new NextRequest('http://localhost/api/transactions?month=2025-01');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(5);
      for (const t of data) {
        expect(t.date).toMatch(/^2025-01/);
      }
    });

    it('returns empty array for month with no transactions', async () => {
      const req = new NextRequest('http://localhost/api/transactions?month=2024-06');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(0);
    });

    it('filters by search term matching description', async () => {
      const req = new NextRequest('http://localhost/api/transactions?search=Starbucks');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].description).toBe('Starbucks');
    });
  });

  describe('POST', () => {
    it('creates a new transaction with 201 status', async () => {
      const req = new NextRequest('http://localhost/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          date: '2025-02-01',
          amount: -75.50,
          description: 'Test purchase',
          account_id: 1,
          type: 'expense',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.description).toBe('Test purchase');
      expect(data.amount).toBe(-75.50);
      expect(data.date).toBe('2025-02-01');
      expect(data.account_name).toBe('Chase Checking');
    });

    it('auto-categorizes based on description', async () => {
      const req = new NextRequest('http://localhost/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          date: '2025-02-05',
          amount: -120,
          description: 'Whole Foods trip',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.category_name).toBe('Groceries');
    });

    it('returns 400 when missing required fields', async () => {
      const req = new NextRequest('http://localhost/api/transactions', {
        method: 'POST',
        body: JSON.stringify({ date: '2025-02-01' }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  describe('PUT /api/transactions/[id]', () => {
    it('updates a transaction', async () => {
      const req = new NextRequest('http://localhost/api/transactions/1', {
        method: 'PUT',
        body: JSON.stringify({
          description: 'Updated Rent Payment',
          amount: -2100,
        }),
      });
      const res = await PUT(req, { params: Promise.resolve({ id: '1' }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.description).toBe('Updated Rent Payment');
      expect(data.amount).toBe(-2100);
    });
  });

  describe('DELETE /api/transactions/[id]', () => {
    it('removes a transaction', async () => {
      const req = new NextRequest('http://localhost/api/transactions/1', {
        method: 'DELETE',
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: '1' }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify it was deleted
      const getReq = new NextRequest('http://localhost/api/transactions');
      const getRes = await GET(getReq);
      const remaining = await getRes.json();
      expect(remaining).toHaveLength(4);
    });
  });
});
