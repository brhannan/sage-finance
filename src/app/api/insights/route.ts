import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  getSavingsRate,
  getTrailingSavingsRate,
  getNetWorth,
  getSpendingByCategory,
  getGoalProgress,
  getAccountBreakdown,
  getMonthlyIncomeExpenseTrend,
} from '@/lib/metrics';
import { getDb } from '@/lib/db';

const anthropic = new Anthropic();

// Simple in-memory cache: regenerate at most once per hour
let cachedInsights: { data: unknown; generatedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET() {
  try {
    // Return cached if fresh
    if (cachedInsights && Date.now() - cachedInsights.generatedAt < CACHE_TTL_MS) {
      return NextResponse.json(cachedInsights.data);
    }

    const db = getDb();

    // Gather all financial context
    const savingsRate = getSavingsRate();
    const trailingSavingsRate = getTrailingSavingsRate();
    const netWorth = getNetWorth();
    const spending = getSpendingByCategory();
    const goals = getGoalProgress();
    const accounts = getAccountBreakdown();
    const trend = getMonthlyIncomeExpenseTrend(6);

    // Get last month's spending for comparison
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const lastMonthStr = lastMonth.toISOString().slice(0, 7);
    const lastMonthSpending = getSpendingByCategory(lastMonthStr);

    // Get advisor profile
    const profile = db.prepare('SELECT key, value FROM advisor_profile').all() as Array<{ key: string; value: string }>;
    const profileContext = profile.map(p => `${p.key}: ${p.value}`).join('\n');

    const accountsContext = accounts.map(a => {
      const bal = a.balance != null ? `$${a.balance.toLocaleString()}` : 'no balance';
      const inst = a.institution ? ` (${a.institution})` : '';
      return `  [${a.type}] ${a.name}${inst}: ${bal}`;
    }).join('\n');

    const topSpending = spending.slice(0, 8).map(s =>
      `  ${s.name}: $${s.amount.toFixed(2)}${s.budget ? ` (budget: $${s.budget.toFixed(2)})` : ''}`
    ).join('\n');

    const lastMonthTopSpending = lastMonthSpending.slice(0, 8).map(s =>
      `  ${s.name}: $${s.amount.toFixed(2)}`
    ).join('\n');

    const trendContext = trend.map(t =>
      `  ${t.month}: income=$${t.income.toLocaleString()}, expenses=$${t.expenses.toLocaleString()}, savings=$${t.savings.toLocaleString()} (${t.savingsRate}%)`
    ).join('\n');

    const goalsContext = goals.map(g =>
      `  ${g.name} (${g.type}): $${g.current_amount.toLocaleString()} / $${g.target_amount.toLocaleString()} (${g.progress.toFixed(1)}%)`
    ).join('\n');

    const prompt = `You are a financial insights engine. Analyze this person's financial data and return a JSON response with exactly this structure:

{
  "summary": "1 concise sentence overview",
  "going_well": ["short bullet", "short bullet"],
  "to_improve": ["short bullet", "short bullet"],
  "detailed_report": "A thorough multi-paragraph financial report in markdown format."
}

Rules:
- "summary": 1 sentence max, highlight the most important takeaway
- "going_well": exactly 2 bullets, each under 10 words, specific numbers preferred
- "to_improve": exactly 2 bullets, each under 10 words, actionable
- "detailed_report": thorough markdown report (3-5 sections with ## headers) covering:
  - Net worth breakdown and trajectory
  - Income & savings analysis with month-over-month trends
  - Spending patterns and notable changes (explain WHY if you can infer, e.g. Travel spike = a trip)
  - Retirement & investment account analysis
  - Specific recommendations (numbered, actionable)
- Do NOT mention incomplete monthly data in the short bullets—save detail for the report
- Return ONLY valid JSON, no markdown code fences

USER PROFILE:
${profileContext || 'No profile set.'}

ACCOUNTS:
${accountsContext}

NET WORTH: $${netWorth.total.toLocaleString()} (assets: $${netWorth.assets.toLocaleString()}, liabilities: $${netWorth.liabilities.toLocaleString()})

SAVINGS RATE:
- This month: ${savingsRate.rate}% (income: $${savingsRate.income.toLocaleString()}, expenses: $${savingsRate.expenses.toLocaleString()})
- Trailing 12-month: ${trailingSavingsRate.rate}%

THIS MONTH'S SPENDING:
${topSpending || '  No spending data yet.'}

LAST MONTH'S SPENDING:
${lastMonthTopSpending || '  No data.'}

6-MONTH INCOME/EXPENSE TREND:
${trendContext}

GOALS:
${goalsContext || '  No goals set.'}

Today's date: ${new Date().toISOString().slice(0, 10)}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    let text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.type === 'text' ? b.text : '')
      .join('')
      .trim();

    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');

    // Find the JSON object boundaries in case there's extra text
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      text = text.slice(jsonStart, jsonEnd + 1);
    }

    const insights = JSON.parse(text);

    cachedInsights = { data: insights, generatedAt: Date.now() };

    return NextResponse.json(insights);
  } catch (error) {
    console.error('GET /api/insights error:', error instanceof Error ? error.message : error);
    return NextResponse.json({
      summary: 'Unable to generate insights right now.',
      going_well: [],
      to_improve: [],
      detailed_report: null,
    }, { status: 500 });
  }
}
