import { NextRequest, NextResponse } from 'next/server';
import {
  getSavingsRate,
  getTrailingSavingsRate,
  getNetWorth,
  getSpendingByCategory,
  getMonthlySpendingTrend,
  getGoalProgress,
} from '@/lib/metrics';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || undefined;

    const savingsRate = getSavingsRate(month);
    const trailingSavingsRate = getTrailingSavingsRate();
    const netWorth = getNetWorth();
    const spendingByCategory = getSpendingByCategory(month);
    const monthlyTrend = getMonthlySpendingTrend();
    const goalProgress = getGoalProgress();

    return NextResponse.json({
      savingsRate,
      trailingSavingsRate,
      netWorth,
      spendingByCategory,
      monthlyTrend,
      goalProgress,
    });
  } catch (error) {
    console.error('GET /api/metrics error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
