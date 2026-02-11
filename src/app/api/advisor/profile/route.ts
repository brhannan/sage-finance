import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value, updated_at FROM advisor_profile ORDER BY key ASC').all() as Array<{
      key: string; value: string; updated_at: string;
    }>;

    // Return as both array and object for convenience
    const profileMap: Record<string, string> = {};
    for (const row of rows) {
      profileMap[row.key] = row.value;
    }

    return NextResponse.json({ entries: rows, profile: profileMap });
  } catch (error) {
    console.error('GET /api/advisor/profile error:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    // Accept either { key, value } or { entries: { key: value, ... } }
    if (body.key && body.value !== undefined) {
      db.prepare(`
        INSERT INTO advisor_profile (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `).run(body.key, String(body.value));
    } else if (body.entries && typeof body.entries === 'object') {
      const upsert = db.prepare(`
        INSERT INTO advisor_profile (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `);

      const insertMany = db.transaction((entries: Record<string, string>) => {
        for (const [key, value] of Object.entries(entries)) {
          upsert.run(key, String(value));
        }
      });

      insertMany(body.entries);
    } else {
      return NextResponse.json({ error: 'Provide { key, value } or { entries: { key: value } }' }, { status: 400 });
    }

    // Return updated profile
    const rows = db.prepare('SELECT key, value FROM advisor_profile ORDER BY key ASC').all() as Array<{
      key: string; value: string;
    }>;
    const profileMap: Record<string, string> = {};
    for (const row of rows) {
      profileMap[row.key] = row.value;
    }

    return NextResponse.json({ profile: profileMap });
  } catch (error) {
    console.error('POST /api/advisor/profile error:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
