import { NextRequest, NextResponse } from 'next/server';
import { getPlaidClient, isPlaidConfigured } from '@/lib/plaid';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();

    const items = db.prepare(`
      SELECT pi.*,
        (SELECT COUNT(*) FROM accounts a WHERE a.plaid_item_id = pi.id) as account_count,
        (SELECT GROUP_CONCAT(a.name, ', ') FROM accounts a WHERE a.plaid_item_id = pi.id) as account_names
      FROM plaid_items pi
      ORDER BY pi.created_at DESC
    `).all();

    return NextResponse.json(items);
  } catch (error) {
    console.error('GET /api/plaid/items error:', error);
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json({ error: 'Plaid is not configured' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('id');

    if (!itemId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const db = getDb();
    const item = db.prepare('SELECT * FROM plaid_items WHERE id = ?').get(Number(itemId)) as { id: number; access_token: string; item_id: string } | undefined;

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Remove item from Plaid
    try {
      const client = getPlaidClient();
      await client.itemRemove({ access_token: item.access_token });
    } catch (error) {
      console.error('Failed to remove item from Plaid:', error);
      // Continue with local cleanup even if Plaid removal fails
    }

    // Clean up local data
    db.prepare('UPDATE plaid_items SET status = \'revoked\', updated_at = datetime(\'now\') WHERE id = ?').run(item.id);
    db.prepare('UPDATE accounts SET plaid_account_id = NULL, plaid_item_id = NULL WHERE plaid_item_id = ?').run(item.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/plaid/items error:', error);
    return NextResponse.json({ error: 'Failed to disconnect item' }, { status: 500 });
  }
}
