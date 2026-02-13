import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST } from '../goals/route';
import { PUT, DELETE } from '../goals/[id]/route';

describe('/api/goals', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns seeded goals with progress calculated', async () => {
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(2);

      const emergencyFund = data.find((g: { name: string }) => g.name === 'Emergency Fund');
      expect(emergencyFund).toBeDefined();
      expect(emergencyFund.type).toBe('savings');
      expect(emergencyFund.target_amount).toBe(30000);
      expect(emergencyFund.current_amount).toBe(25000);
      // progress = (25000/30000)*100 = 83.3...
      expect(emergencyFund.progress).toBeCloseTo(83.3, 0);

      const downPayment = data.find((g: { name: string }) => g.name === 'House Down Payment');
      expect(downPayment).toBeDefined();
      expect(downPayment.type).toBe('home_purchase');
      expect(downPayment.target_amount).toBe(100000);
      expect(downPayment.current_amount).toBe(40000);
      // progress = (40000/100000)*100 = 40
      expect(downPayment.progress).toBe(40);
    });
  });

  describe('POST', () => {
    it('creates a new goal with 201 status', async () => {
      const req = new NextRequest('http://localhost/api/goals', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Vacation Fund',
          type: 'savings',
          target_amount: 5000,
          current_amount: 500,
          target_date: '2025-12-31',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.name).toBe('Vacation Fund');
      expect(data.type).toBe('savings');
      expect(data.target_amount).toBe(5000);
      expect(data.current_amount).toBe(500);
      expect(data.target_date).toBe('2025-12-31');
      expect(data.is_active).toBe(1);
    });

    it('returns 400 when missing name or type', async () => {
      // Missing type
      const req1 = new NextRequest('http://localhost/api/goals', {
        method: 'POST',
        body: JSON.stringify({ name: 'No Type Goal' }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.error).toBeDefined();

      // Missing name
      const req2 = new NextRequest('http://localhost/api/goals', {
        method: 'POST',
        body: JSON.stringify({ type: 'savings' }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(400);
      const data2 = await res2.json();
      expect(data2.error).toBeDefined();
    });
  });

  describe('PUT /api/goals/[id]', () => {
    it("updates a goal's current_amount", async () => {
      const req = new NextRequest('http://localhost/api/goals/1', {
        method: 'PUT',
        body: JSON.stringify({ current_amount: 28000 }),
      });
      const res = await PUT(req, { params: Promise.resolve({ id: '1' }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.current_amount).toBe(28000);
      expect(data.name).toBe('Emergency Fund');
    });
  });

  describe('DELETE /api/goals/[id]', () => {
    it('removes a goal', async () => {
      const req = new NextRequest('http://localhost/api/goals/1', {
        method: 'DELETE',
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: '1' }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify it was deleted
      const getRes = await GET();
      const remaining = await getRes.json();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].name).toBe('House Down Payment');
    });
  });
});
