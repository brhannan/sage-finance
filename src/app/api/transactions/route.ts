import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { autoCategorize } from '@/lib/categorize';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);

    const month = searchParams.get('month');
    const category = searchParams.get('category');
    const account = searchParams.get('account');
    const type = searchParams.get('type');
    const search = searchParams.get('search');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');

    let query = `
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (month) {
      query += ` AND strftime('%Y-%m', t.date) = ?`;
      params.push(month);
    }
    if (category) {
      query += ` AND t.category_id = ?`;
      params.push(Number(category));
    }
    if (account) {
      query += ` AND t.account_id = ?`;
      params.push(Number(account));
    }
    if (type) {
      query += ` AND t.type = ?`;
      params.push(type);
    }
    if (search) {
      query += ` AND (t.description LIKE ? OR t.notes LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY t.date DESC, t.id DESC`;

    if (limit) {
      query += ` LIMIT ?`;
      params.push(Number(limit));
      if (offset) {
        query += ` OFFSET ?`;
        params.push(Number(offset));
      }
    }

    const transactions = db.prepare(query).all(...params);
    return NextResponse.json(transactions);
  } catch (error) {
    console.error('GET /api/transactions error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { date, amount, description, category_id, account_id, type, notes } = body;

    if (!date || amount === undefined || !description) {
      return NextResponse.json({ error: 'date, amount, and description are required' }, { status: 400 });
    }

    const finalCategoryId = category_id ?? autoCategorize(description);

    const result = db.prepare(`
      INSERT INTO transactions (date, amount, description, category_id, account_id, type, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'manual')
    `).run(date, amount, description, finalCategoryId, account_id || null, type || 'expense', notes || null);

    const transaction = db.prepare(`
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    console.error('POST /api/transactions error:', error);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
