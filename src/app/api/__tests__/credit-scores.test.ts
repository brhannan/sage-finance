import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST } from '../credit-scores/route';

describe('/api/credit-scores', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns empty array when no scores exist', async () => {
      const req = new NextRequest('http://localhost/api/credit-scores');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual([]);
    });
  });

  describe('POST', () => {
    it('creates a credit score entry with 201 status and verifies defaults', async () => {
      const req = new NextRequest('http://localhost/api/credit-scores', {
        method: 'POST',
        body: JSON.stringify({
          date: '2025-01-15',
          score: 750,
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.date).toBe('2025-01-15');
      expect(data.score).toBe(750);
      expect(data.source).toBe('credit_karma');
      expect(data.score_type).toBe('vantage_3');
      expect(data.details).toBeNull();
      expect(data.id).toBeDefined();
    });

    it('stores and returns parsed JSON details field', async () => {
      const details = {
        accounts: 12,
        utilization: 15,
        hard_inquiries: 2,
        derogatory_marks: 0,
      };

      const postReq = new NextRequest('http://localhost/api/credit-scores', {
        method: 'POST',
        body: JSON.stringify({
          date: '2025-02-01',
          score: 780,
          source: 'experian',
          score_type: 'fico_8',
          details,
        }),
      });
      const postRes = await POST(postReq);
      expect(postRes.status).toBe(201);

      // GET should return parsed details object
      const getReq = new NextRequest('http://localhost/api/credit-scores');
      const getRes = await GET(getReq);
      const data = await getRes.json();

      expect(data).toHaveLength(1);
      expect(data[0].score).toBe(780);
      expect(data[0].source).toBe('experian');
      expect(data[0].score_type).toBe('fico_8');
      expect(data[0].details).toEqual(details);
      expect(data[0].details.utilization).toBe(15);
      expect(data[0].details.accounts).toBe(12);
    });
  });
});
