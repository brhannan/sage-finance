import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { createTestDb, seedTestData } from '../../../lib/__tests__/test-db';

let db: Database.Database;
vi.mock('@/lib/db', () => ({ getDb: () => db }));

// Import route handlers AFTER vi.mock
import { GET, POST, PUT } from '../categories/route';

describe('/api/categories', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
  });

  describe('GET', () => {
    it('returns all seeded categories', async () => {
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(17);

      const names = data.map((c: { name: string }) => c.name);
      expect(names).toContain('Housing');
      expect(names).toContain('Groceries');
      expect(names).toContain('Dining');
      expect(names).toContain('Other');
    });
  });

  describe('POST', () => {
    it('creates a new category with 201 status', async () => {
      const req = new NextRequest('http://localhost/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Pet Care',
          budget_amount: 200,
          color: '#FF6B6B',
          keywords: 'pet,vet,petco,petsmart',
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.name).toBe('Pet Care');
      expect(data.budget_amount).toBe(200);
      expect(data.color).toBe('#FF6B6B');
      expect(data.keywords).toBe('pet,vet,petco,petsmart');
    });

    it('returns 400 when name is missing', async () => {
      const req = new NextRequest('http://localhost/api/categories', {
        method: 'POST',
        body: JSON.stringify({ budget_amount: 100 }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  describe('PUT', () => {
    it('updates a category budget_amount', async () => {
      // Get Groceries category ID
      const getRes = await GET();
      const categories = await getRes.json();
      const groceries = categories.find((c: { name: string }) => c.name === 'Groceries');

      const req = new NextRequest('http://localhost/api/categories', {
        method: 'PUT',
        body: JSON.stringify({
          id: groceries.id,
          budget_amount: 500,
        }),
      });
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.budget_amount).toBe(500);
      expect(data.name).toBe('Groceries');
    });

    it('returns 404 for non-existent category', async () => {
      const req = new NextRequest('http://localhost/api/categories', {
        method: 'PUT',
        body: JSON.stringify({
          id: 9999,
          budget_amount: 500,
        }),
      });
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe('Category not found');
    });
  });
});
