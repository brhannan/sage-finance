import { NextRequest, NextResponse } from 'next/server';
import { isPlaidConfigured } from '@/lib/plaid';
import { getDb } from '@/lib/db';
import { syncPlaidItem, syncAllPlaidItems } from '@/lib/plaid-sync';

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json({ error: 'Plaid is not configured' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { item_id } = body;

    if (item_id) {
      const result = await syncPlaidItem(item_id);
      return NextResponse.json(result);
    }

    // Sync all items
    const results = await syncAllPlaidItems();
    return NextResponse.json({ results });
  } catch (error) {
    console.error('POST /api/plaid/sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = getDb();

    const logs = db.prepare(`
      SELECT sl.*, pi.institution_name
      FROM plaid_sync_log sl
      LEFT JOIN plaid_items pi ON pi.id = sl.plaid_item_id
      ORDER BY sl.created_at DESC
      LIMIT 50
    `).all();

    return NextResponse.json(logs);
  } catch (error) {
    console.error('GET /api/plaid/sync error:', error);
    return NextResponse.json({ error: 'Failed to fetch sync logs' }, { status: 500 });
  }
}
