import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id');
    const limit = searchParams.get('limit');

    let query = `
      SELECT b.*, a.name as account_name, a.type as account_type
      FROM balances b
      JOIN accounts a ON a.id = b.account_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (accountId) {
      query += ' AND b.account_id = ?';
      params.push(Number(accountId));
    }

    query += ' ORDER BY b.date DESC, b.account_id ASC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(Number(limit));
    }

    const balances = db.prepare(query).all(...params);
    return NextResponse.json(balances);
  } catch (error) {
    console.error('GET /api/balances error:', error);
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { account_id, date, balance, source } = body;

    if (!account_id || !date || balance === undefined) {
      return NextResponse.json({ error: 'account_id, date, and balance are required' }, { status: 400 });
    }

    // Upsert: replace if same account + date exists
    db.prepare(`
      INSERT INTO balances (account_id, date, balance, source)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, date) DO UPDATE SET
        balance = excluded.balance,
        source = excluded.source,
        created_at = datetime('now')
    `).run(account_id, date, balance, source || 'manual');

    const entry = db.prepare(`
      SELECT b.*, a.name as account_name, a.type as account_type
      FROM balances b
      JOIN accounts a ON a.id = b.account_id
      WHERE b.account_id = ? AND b.date = ?
    `).get(account_id, date);

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('POST /api/balances error:', error);
    return NextResponse.json({ error: 'Failed to create balance entry' }, { status: 500 });
  }
}
