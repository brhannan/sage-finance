import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST } from '../action-items/route';

describe('/api/action-items', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns empty array when no action items exist', async () => {
      const req = new NextRequest('http://localhost/api/action-items');
      const res = await GET(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual([]);
    });
  });

  describe('POST', () => {
    it('creates an action item with 201 status', async () => {
      const req = new NextRequest('http://localhost/api/action-items', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Review monthly budget',
          description: 'Check spending vs budget for all categories',
          source: 'manual',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.title).toBe('Review monthly budget');
      expect(data.description).toBe('Check spending vs budget for all categories');
      expect(data.source).toBe('manual');
      expect(data.status).toBe('pending');
      expect(data.id).toBeDefined();
      expect(data.completed_at).toBeNull();
    });
  });

  describe('GET with ?status filter', () => {
    it('filters action items by status', async () => {
      // Create two action items
      const req1 = new NextRequest('http://localhost/api/action-items', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Pending task',
          description: 'This task is pending',
        }),
      });
      await POST(req1);

      const req2 = new NextRequest('http://localhost/api/action-items', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Another pending task',
          description: 'Also pending',
        }),
      });
      await POST(req2);

      // Mark the first one as completed directly in the DB
      db.prepare("UPDATE action_items SET status = 'completed', completed_at = datetime('now') WHERE id = 1").run();

      // GET all -- should be 2
      const allReq = new NextRequest('http://localhost/api/action-items');
      const allRes = await GET(allReq);
      const allData = await allRes.json();
      expect(allData).toHaveLength(2);

      // GET ?status=pending -- should be 1
      const pendingReq = new NextRequest('http://localhost/api/action-items?status=pending');
      const pendingRes = await GET(pendingReq);
      const pendingData = await pendingRes.json();
      expect(pendingData).toHaveLength(1);
      expect(pendingData[0].title).toBe('Another pending task');
      expect(pendingData[0].status).toBe('pending');

      // GET ?status=completed -- should be 1
      const completedReq = new NextRequest('http://localhost/api/action-items?status=completed');
      const completedRes = await GET(completedReq);
      const completedData = await completedRes.json();
      expect(completedData).toHaveLength(1);
      expect(completedData[0].title).toBe('Pending task');
      expect(completedData[0].status).toBe('completed');
    });
  });
});
