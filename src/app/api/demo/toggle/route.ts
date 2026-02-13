import { NextResponse } from 'next/server';
import { isDemoMode, setDemoMode } from '@/lib/db';

export async function GET() {
  return NextResponse.json({ mode: isDemoMode() ? 'demo' : 'real' });
}

export async function POST(request: Request) {
  const body = await request.json();
  const demo = Boolean(body.demo);
  setDemoMode(demo);
  return NextResponse.json({ mode: demo ? 'demo' : 'real' });
}
