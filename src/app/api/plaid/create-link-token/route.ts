import { NextResponse } from 'next/server';
import { getPlaidClient, isPlaidConfigured, getPlaidEnv } from '@/lib/plaid';
import { CountryCode, Products } from 'plaid';

export async function POST() {
  try {
    if (!isPlaidConfigured()) {
      return NextResponse.json({ error: 'Plaid is not configured' }, { status: 400 });
    }

    const client = getPlaidClient();
    const response = await client.linkTokenCreate({
      user: { client_user_id: 'sage-finance-user' },
      client_name: 'Sage Finance',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      redirect_uri: getPlaidEnv() !== 'sandbox' ? process.env.PLAID_REDIRECT_URI : undefined,
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('POST /api/plaid/create-link-token error:', error);
    return NextResponse.json({ error: 'Failed to create link token' }, { status: 500 });
  }
}
