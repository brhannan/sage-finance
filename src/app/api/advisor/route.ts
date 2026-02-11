import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/db';
import {
  getSavingsRate,
  getTrailingSavingsRate,
  getNetWorth,
  getSpendingByCategory,
  getGoalProgress,
} from '@/lib/metrics';

const anthropic = new Anthropic();

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '50';
    const conversationType = searchParams.get('type') || 'general';

    const messages = db.prepare(`
      SELECT * FROM conversations
      WHERE conversation_type = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(conversationType, Number(limit));

    // Return in chronological order
    return NextResponse.json((messages as Array<Record<string, unknown>>).reverse());
  } catch (error) {
    console.error('GET /api/advisor error:', error);
    return NextResponse.json({ error: 'Failed to fetch conversation history' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { message, conversationType } = body;

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Save user message
    db.prepare(`
      INSERT INTO conversations (role, content, conversation_type)
      VALUES ('user', ?, ?)
    `).run(message, conversationType || 'general');

    // Build financial context
    const profile = db.prepare('SELECT key, value FROM advisor_profile').all() as Array<{ key: string; value: string }>;
    const profileContext = profile.map(p => `${p.key}: ${p.value}`).join('\n');

    const savingsRate = getSavingsRate();
    const trailingSavingsRate = getTrailingSavingsRate();
    const netWorth = getNetWorth();
    const spending = getSpendingByCategory();
    const goals = getGoalProgress();

    const topSpending = spending.slice(0, 8).map(s =>
      `  ${s.name}: $${s.amount.toFixed(2)}${s.budget ? ` (budget: $${s.budget.toFixed(2)})` : ''}`
    ).join('\n');

    const goalsContext = goals.map(g =>
      `  ${g.name} (${g.type}): $${g.current_amount.toLocaleString()} / $${g.target_amount.toLocaleString()} (${g.progress.toFixed(1)}%)`
    ).join('\n');

    const systemPrompt = `You are a knowledgeable and supportive personal financial advisor for the MyBudget app. You help users understand their finances, set and achieve goals, and make smart financial decisions.

USER PROFILE:
${profileContext || 'No profile information set yet.'}

CURRENT FINANCIAL SNAPSHOT:
- This month's savings rate: ${savingsRate.rate}% (income: $${savingsRate.income.toLocaleString()}, expenses: $${savingsRate.expenses.toLocaleString()})
- Trailing 12-month savings rate: ${trailingSavingsRate.rate}%
- Net worth: $${netWorth.total.toLocaleString()} (assets: $${netWorth.assets.toLocaleString()}, liabilities: $${netWorth.liabilities.toLocaleString()})

TOP SPENDING CATEGORIES THIS MONTH:
${topSpending || '  No spending data available.'}

FINANCIAL GOALS:
${goalsContext || '  No goals set yet.'}

GUIDELINES:
- Be concise but thorough. Use specific numbers from the user's data.
- Offer actionable advice tailored to their situation.
- If asked about something you don't have data for, say so and suggest how they can add that data.
- Be encouraging about progress and honest about areas for improvement.
- When relevant, mention tax implications, compound interest effects, or opportunity costs.
- Do not make up financial data. Only reference what is provided above.`;

    // Get recent conversation history for context
    const recentMessages = db.prepare(`
      SELECT role, content FROM conversations
      WHERE conversation_type = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(conversationType || 'general') as Array<{ role: string; content: string }>;

    // Build messages array (chronological order)
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = recentMessages
      .reverse()
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationMessages,
    });

    const assistantContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.type === 'text' ? block.text : '')
      .join('\n');

    // Save assistant response
    db.prepare(`
      INSERT INTO conversations (role, content, conversation_type)
      VALUES ('assistant', ?, ?)
    `).run(assistantContent, conversationType || 'general');

    return NextResponse.json({
      role: 'assistant',
      content: assistantContent,
    });
  } catch (error) {
    console.error('POST /api/advisor error:', error);
    return NextResponse.json({ error: 'Failed to get advisor response' }, { status: 500 });
  }
}
