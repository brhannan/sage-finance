import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const institution = searchParams.get('institution');

    let query = 'SELECT * FROM column_mappings';
    const params: unknown[] = [];

    if (institution) {
      query += ' WHERE institution = ?';
      params.push(institution);
    }

    query += ' ORDER BY updated_at DESC';

    const mappings = db.prepare(query).all(...params);

    // Parse the JSON mapping field
    const parsed = (mappings as Array<Record<string, unknown>>).map(m => ({
      ...m,
      mapping: typeof m.mapping === 'string' ? JSON.parse(m.mapping as string) : m.mapping,
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('GET /api/import/mappings error:', error);
    return NextResponse.json({ error: 'Failed to fetch mappings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { institution, account_id, mapping, file_type } = body;

    if (!institution || !mapping) {
      return NextResponse.json({ error: 'institution and mapping are required' }, { status: 400 });
    }

    const mappingJson = typeof mapping === 'string' ? mapping : JSON.stringify(mapping);

    // Upsert: update if same institution + account exists
    const existing = db.prepare(
      'SELECT id FROM column_mappings WHERE institution = ? AND (account_id = ? OR (account_id IS NULL AND ? IS NULL))'
    ).get(institution, account_id || null, account_id || null) as { id: number } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE column_mappings SET mapping = ?, file_type = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(mappingJson, file_type || 'csv', existing.id);

      const updated = db.prepare('SELECT * FROM column_mappings WHERE id = ?').get(existing.id);
      return NextResponse.json(updated);
    }

    const result = db.prepare(`
      INSERT INTO column_mappings (institution, account_id, mapping, file_type)
      VALUES (?, ?, ?, ?)
    `).run(institution, account_id || null, mappingJson, file_type || 'csv');

    const saved = db.prepare('SELECT * FROM column_mappings WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    console.error('POST /api/import/mappings error:', error);
    return NextResponse.json({ error: 'Failed to save mapping' }, { status: 500 });
  }
}
