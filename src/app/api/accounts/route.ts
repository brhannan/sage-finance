import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();

    const accounts = db.prepare(`
      SELECT a.*,
        b.balance as latest_balance,
        b.date as balance_date
      FROM accounts a
      LEFT JOIN balances b ON b.account_id = a.id
        AND b.date = (SELECT MAX(b2.date) FROM balances b2 WHERE b2.account_id = a.id)
      ORDER BY a.is_active DESC, a.name ASC
    `).all();

    return NextResponse.json(accounts);
  } catch (error) {
    console.error('GET /api/accounts error:', error);
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, type, institution, last_four } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO accounts (name, type, institution, last_four)
      VALUES (?, ?, ?, ?)
    `).run(name, type, institution || null, last_four || null);

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    console.error('POST /api/accounts error:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
