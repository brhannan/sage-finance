import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();

    const goals = db.prepare(`
      SELECT g.*,
        CASE
          WHEN g.account_id IS NOT NULL THEN (
            SELECT b.balance FROM balances b
            WHERE b.account_id = g.account_id
            ORDER BY b.date DESC LIMIT 1
          )
          ELSE g.current_amount
        END as resolved_amount,
        a.name as account_name
      FROM goals g
      LEFT JOIN accounts a ON a.id = g.account_id
      ORDER BY g.is_active DESC, g.created_at DESC
    `).all() as Array<{
      id: number; name: string; type: string; target_amount: number;
      current_amount: number; resolved_amount: number;
      target_date: string | null; is_active: number;
      description: string | null; config: string | null;
      account_id: number | null; account_name: string | null;
    }>;

    const withProgress = goals.map(({ resolved_amount, ...g }) => ({
      ...g,
      current_amount: resolved_amount ?? g.current_amount,
      config: g.config ? JSON.parse(g.config) : null,
      progress: g.target_amount > 0
        ? Math.min(100, Math.round(((resolved_amount ?? g.current_amount) / g.target_amount) * 1000) / 10)
        : 0,
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
    const { name, type, target_amount, current_amount, target_date, description, config, account_id } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO goals (name, type, target_amount, current_amount, target_date, description, config, account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, type, target_amount || null, current_amount || 0,
      target_date || null, description || null,
      config ? JSON.stringify(config) : null,
      account_id || null,
    );

    const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error('POST /api/goals error:', error);
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
  }
}
