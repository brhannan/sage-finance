import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = searchParams.get('limit') || '20';

    let query = 'SELECT * FROM action_items';
    const params: (string | number)[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit));

    const items = db.prepare(query).all(...params);
    return NextResponse.json(items);
  } catch (error) {
    console.error('GET /api/action-items error:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { title, description, source } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const result = db.prepare(
      'INSERT INTO action_items (title, description, source) VALUES (?, ?, ?)'
    ).run(title, description || null, source || 'manual');

    const item = db.prepare('SELECT * FROM action_items WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('POST /api/action-items error:', error);
    return NextResponse.json({ error: 'Failed to create action item' }, { status: 500 });
  }
}
