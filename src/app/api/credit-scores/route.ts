import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit');

    let query = 'SELECT * FROM credit_scores ORDER BY date DESC';
    const params: unknown[] = [];

    if (limit) {
      query += ' LIMIT ?';
      params.push(Number(limit));
    }

    const scores = db.prepare(query).all(...params);

    // Parse JSON details field
    const parsed = (scores as Array<Record<string, unknown>>).map(s => ({
      ...s,
      details: typeof s.details === 'string' ? JSON.parse(s.details as string) : s.details,
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('GET /api/credit-scores error:', error);
    return NextResponse.json({ error: 'Failed to fetch credit scores' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { date, score, source, score_type, details } = body;

    if (!date || score === undefined) {
      return NextResponse.json({ error: 'date and score are required' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO credit_scores (date, score, source, score_type, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      date, score, source || 'credit_karma', score_type || 'vantage_3',
      details ? JSON.stringify(details) : null,
    );

    const entry = db.prepare('SELECT * FROM credit_scores WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('POST /api/credit-scores error:', error);
    return NextResponse.json({ error: 'Failed to add credit score' }, { status: 500 });
  }
}
