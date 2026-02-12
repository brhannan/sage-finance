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
    const { message, conversationType, model } = body;

    const ALLOWED_MODELS = [
      'claude-sonnet-4-5-20250929',
      'claude-opus-4-6',
      'claude-haiku-4-5-20251001',
    ];
    const selectedModel = ALLOWED_MODELS.includes(model) ? model : 'claude-sonnet-4-5-20250929';

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const convType = conversationType || 'general';

    // Save user message
    db.prepare(`
      INSERT INTO conversations (role, content, conversation_type)
      VALUES ('user', ?, ?)
    `).run(message, convType);

    // Load conversation summaries for context
    const summaries = db.prepare(`
      SELECT summary_json FROM conversation_summaries
      WHERE conversation_type = ?
      ORDER BY messages_end_id ASC
    `).all(convType) as Array<{ summary_json: string }>;

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

    const systemPrompt = `You are a knowledgeable and supportive personal financial advisor for the Sage Finance app. You help users understand their finances, set and achieve goals, and make smart financial decisions.

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
${summaries.length > 0 ? `
CONVERSATION HISTORY SUMMARY:
${summaries.map(s => s.summary_json).join('\n\n')}
` : ''}
GUIDELINES:
- Be concise but thorough. Use specific numbers from the user's data.
- Offer actionable advice tailored to their situation.
- If asked about something you don't have data for, say so and suggest how they can add that data.
- Be encouraging about progress and honest about areas for improvement.
- When relevant, mention tax implications, compound interest effects, or opportunity costs.
- Do not make up financial data. Only reference what is provided above.`;

    // Get recent conversation history for context (reduced from 20 since summaries cover older history)
    const recentMessages = db.prepare(`
      SELECT role, content FROM conversations
      WHERE conversation_type = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(convType) as Array<{ role: string; content: string }>;

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
      model: selectedModel,
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
    `).run(assistantContent, convType);

    // Auto-compaction: check if there are enough unsummarized messages
    try {
      const lastSummary = db.prepare(`
        SELECT messages_end_id FROM conversation_summaries
        WHERE conversation_type = ?
        ORDER BY messages_end_id DESC LIMIT 1
      `).get(convType) as { messages_end_id: number } | undefined;

      const unsummarizedCount = db.prepare(`
        SELECT COUNT(*) as count FROM conversations
        WHERE conversation_type = ? AND id > ?
      `).get(convType, lastSummary?.messages_end_id ?? 0) as { count: number };

      if (unsummarizedCount.count > 20) {
        // Fire compaction in the background (non-blocking)
        const baseUrl = request.nextUrl.origin;
        fetch(`${baseUrl}/api/advisor/compact`, { method: 'POST' }).catch(() => {});
      }
    } catch (compactErr) {
      console.error('Auto-compaction check failed:', compactErr);
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    // Per-model pricing ($/M tokens): input / output
    const pricing: Record<string, [number, number]> = {
      'claude-sonnet-4-5-20250929': [3, 15],
      'claude-opus-4-6': [15, 75],
      'claude-haiku-4-5-20251001': [0.80, 4],
    };
    const [inPrice, outPrice] = pricing[selectedModel] ?? [3, 15];
    const cost = (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;

    return NextResponse.json({
      role: 'assistant',
      content: assistantContent,
      model: response.model,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      cost,
    });
  } catch (error) {
    console.error('POST /api/advisor error:', error);
    return NextResponse.json({ error: 'Failed to get advisor response' }, { status: 500 });
  }
}
