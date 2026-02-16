import { NextRequest, NextResponse } from 'next/server';
import { getPlaidClient, isPlaidConfigured } from '@/lib/plaid';
import { getDb } from '@/lib/db';
import { syncPlaidItem } from '@/lib/plaid-sync';

function mapAccountType(plaidType: string, plaidSubtype: string | null): string {
  switch (plaidType) {
    case 'depository':
      return plaidSubtype === 'savings' ? 'savings' : 'checking';
    case 'credit':
      return 'credit_card';
    case 'investment':
      return 'investment';
    case 'loan':
      return 'loan';
    default:
      return 'other';
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json({ error: 'Plaid is not configured' }, { status: 400 });
    }

    const { public_token, institution } = await request.json();
    if (!public_token) {
      return NextResponse.json({ error: 'public_token is required' }, { status: 400 });
    }

    const client = getPlaidClient();
    const db = getDb();

    // Exchange public token for access token
    const exchangeResponse = await client.itemPublicTokenExchange({
      public_token,
    });

    const { access_token, item_id } = exchangeResponse.data;
    const institutionName = institution?.name || null;

    // Create plaid_item record
    const plaidItemResult = db.prepare(`
      INSERT INTO plaid_items (item_id, access_token, institution_name)
      VALUES (?, ?, ?)
    `).run(item_id, access_token, institutionName);

    const plaidItemId = plaidItemResult.lastInsertRowid as number;

    // Fetch accounts from Plaid
    const accountsResponse = await client.accountsGet({
      access_token,
    });

    // Create local accounts for each Plaid account
    const insertAccount = db.prepare(`
      INSERT INTO accounts (name, type, institution, last_four, plaid_account_id, plaid_item_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const account of accountsResponse.data.accounts) {
      const accountType = mapAccountType(account.type, account.subtype || null);
      const name = account.official_name || account.name;
      const lastFour = account.mask || null;

      insertAccount.run(name, accountType, institutionName, lastFour, account.account_id, plaidItemId);
    }

    // Trigger initial sync
    const syncResult = await syncPlaidItem(plaidItemId);

    return NextResponse.json({
      item_id: plaidItemId,
      institution_name: institutionName,
      accounts_created: accountsResponse.data.accounts.length,
      sync: syncResult,
    }, { status: 201 });
  } catch (error) {
    console.error('POST /api/plaid/exchange-token error:', error);
    return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 });
  }
}
