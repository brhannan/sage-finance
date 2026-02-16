import { NextRequest, NextResponse } from 'next/server';
import { isPlaidConfigured } from '@/lib/plaid';
import { syncAllPlaidItems } from '@/lib/plaid-sync';

/**
 * Cron endpoint for scheduled Plaid syncs.
 * Trigger with an external scheduler:
 *   - System cron: curl -X POST http://localhost:3000/api/plaid/cron
 *   - Vercel Cron: add to vercel.json
 *
 * Optional: pass Authorization header for security:
 *   curl -H "Authorization: Bearer $CRON_SECRET" ...
 */
export async function POST(request: NextRequest) {
  try {
    // Optional bearer token check for security
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = request.headers.get('authorization');
      if (auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    if (!isPlaidConfigured()) {
      return NextResponse.json({ error: 'Plaid is not configured' }, { status: 400 });
    }

    console.log('[Plaid Cron] Starting scheduled sync...');
    const results = await syncAllPlaidItems();

    for (const result of results) {
      if (result.error) {
        console.error(`[Plaid Cron] Sync error for ${result.institutionName}: ${result.error}`);
      } else {
        console.log(`[Plaid Cron] Synced ${result.institutionName}: +${result.added} ~${result.modified} -${result.removed}`);
      }
    }

    console.log('[Plaid Cron] Scheduled sync complete');
    return NextResponse.json({ results });
  } catch (error) {
    console.error('[Plaid Cron] Sync failed:', error);
    return NextResponse.json({ error: 'Cron sync failed' }, { status: 500 });
  }
}
