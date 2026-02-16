import { NextResponse } from 'next/server';
import { isPlaidConfigured, getPlaidEnv } from '@/lib/plaid';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const configured = isPlaidConfigured();
    const env = getPlaidEnv();

    let itemCount = 0;
    let activeItemCount = 0;

    if (configured) {
      const db = getDb();
      const counts = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
        FROM plaid_items
      `).get() as { total: number; active: number };
      itemCount = counts.total;
      activeItemCount = counts.active;
    }

    return NextResponse.json({
      configured,
      environment: env,
      item_count: itemCount,
      active_item_count: activeItemCount,
    });
  } catch (error) {
    console.error('GET /api/plaid/status error:', error);
    return NextResponse.json({ error: 'Failed to fetch Plaid status' }, { status: 500 });
  }
}
