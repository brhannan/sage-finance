import { NextResponse } from 'next/server';
import { resetDemoDb } from '@/lib/db';

export async function POST() {
  resetDemoDb();
  return NextResponse.json({ status: 'reset' });
}
