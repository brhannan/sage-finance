import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();

    const goals = db.prepare('SELECT * FROM goals ORDER BY is_active DESC, created_at DESC').all() as Array<{
      id: number; name: string; type: string; target_amount: number;
      current_amount: number; target_date: string | null; is_active: number;
      description: string | null; config: string | null;
    }>;

    const withProgress = goals.map(g => ({
      ...g,
      config: g.config ? JSON.parse(g.config) : null,
      progress: g.target_amount > 0 ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 1000) / 10) : 0,
    }));

    return NextResponse.json(withProgress);
  } catch (error) {
    console.error('GET /api/goals error:', error);
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, type, target_amount, current_amount, target_date, description, config } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO goals (name, type, target_amount, current_amount, target_date, description, config)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, type, target_amount || null, current_amount || 0,
      target_date || null, description || null,
      config ? JSON.stringify(config) : null,
    );

    const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error('POST /api/goals error:', error);
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
  }
}
