import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/db';
import {
  getSavingsRate,
  getTrailingSavingsRate,
  getNetWorth,
  getSpendingByCategory,
  getGoalProgress,
  getAccountBreakdown,
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
        AND created_at >= datetime('now', '-24 hours')
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
    const accounts = getAccountBreakdown();

    // Compute average monthly income from trailing data for context
    const avgMonthlyIncome = trailingSavingsRate.income / 12;

    const topSpending = spending.slice(0, 10).map(s =>
      `  ${s.name}: $${s.amount.toFixed(2)}${s.budget ? ` (budget: $${s.budget.toFixed(2)})` : ''}`
    ).join('\n');

    // Recent transactions (last 30 days) for detailed context
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentTxns = db.prepare(`
      SELECT t.date, t.amount, t.description, t.type, COALESCE(c.name, 'Uncategorized') as category, a.name as account
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.date >= ? AND t.type = 'expense'
      ORDER BY t.date DESC
      LIMIT 40
    `).all(thirtyDaysAgo.toISOString().slice(0, 10)) as Array<{
      date: string; amount: number; description: string; type: string; category: string; account: string;
    }>;
    const recentTxnContext = recentTxns.map(t =>
      `  ${t.date} | $${Math.abs(t.amount).toFixed(2)} | ${t.description.slice(0, 40)} | ${t.category} | ${t.account}`
    ).join('\n');

    const goalsContext = goals.map(g =>
      `  ${g.name} (${g.type}): $${g.current_amount.toLocaleString()} / $${g.target_amount.toLocaleString()} (${g.progress.toFixed(1)}%)`
    ).join('\n');

    const accountsContext = accounts.map(a => {
      const bal = a.balance != null ? `$${a.balance.toLocaleString()}` : 'no balance';
      const inst = a.institution ? ` (${a.institution})` : '';
      return `  [${a.type}] ${a.name}${inst}: ${bal}`;
    }).join('\n');

    const systemPrompt = `You are a knowledgeable and supportive personal financial advisor for the Sage Finance app. You help users understand their finances, set and achieve goals, and make smart financial decisions.

USER PROFILE:
${profileContext || 'No profile information set yet.'}

CURRENT FINANCIAL SNAPSHOT:
- This month so far (PARTIAL — may not include all paychecks yet): income recorded: $${savingsRate.income.toLocaleString()}, expenses: $${savingsRate.expenses.toLocaleString()}
- Average monthly net income (trailing 12 months): $${Math.round(avgMonthlyIncome).toLocaleString()}
- Trailing 12-month totals: income $${trailingSavingsRate.income.toLocaleString()}, expenses $${trailingSavingsRate.expenses.toLocaleString()}, savings rate ${trailingSavingsRate.rate}%
- Net worth: $${netWorth.total.toLocaleString()} (assets: $${netWorth.assets.toLocaleString()}, liabilities: $${netWorth.liabilities.toLocaleString()})

ACCOUNT BREAKDOWN:
${accountsContext || '  No accounts set up yet.'}

TOP SPENDING CATEGORIES THIS MONTH:
${topSpending || '  No spending data available.'}

RECENT TRANSACTIONS (last 30 days):
${recentTxnContext || '  No recent transactions.'}

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
- Do not make up financial data. Only reference what is provided above.
- CRITICAL INCOME NOTE: The "this month so far" income figure is PARTIAL — it only reflects paychecks recorded so far this month, NOT full monthly income. The user is typically paid twice per month. NEVER treat a single paycheck as the user's monthly income. Always use the "average monthly net income (trailing 12 months)" figure when discussing monthly take-home pay, budgeting, or savings potential. If current month income is $0 or seems low, that's normal — paychecks may not have been recorded yet.

PROFILE MANAGEMENT:
- You have a save_profile tool. Use it to save any personal or financial details the user shares.
- Important profile fields: name, age, location, occupation, total_comp (total annual compensation), expected_bonus, filing_status, risk_tolerance, financial_goals
- If KEY profile fields are missing (especially age, location, total_comp), naturally ask about 1-2 missing fields when relevant to the conversation — don't rapid-fire all questions at once.
- When the user shares info like "I'm 32" or "I make 180k", immediately save it via save_profile.
- For total_comp, ask about base salary + equity/RSU + bonus breakdown if the user mentions compensation.`;

    // Get recent conversation history for context (reduced from 20 since summaries cover older history)
    const recentMessages = db.prepare(`
      SELECT role, content FROM conversations
      WHERE conversation_type = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(convType) as Array<{ role: string; content: string }>;

    // Build messages array (chronological order)
    const conversationMessages: Anthropic.MessageParam[] = recentMessages
      .reverse()
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Define tools for Claude
    const tools: Anthropic.Tool[] = [{
      name: 'save_profile',
      description: 'Save or update user profile information. Call this whenever the user shares personal or financial details like age, location, income, job title, etc.',
      input_schema: {
        type: 'object' as const,
        properties: {
          entries: {
            type: 'object',
            description: 'Key-value pairs to save. Keys should be snake_case (e.g., age, location, total_comp, expected_bonus, occupation, filing_status, risk_tolerance, financial_goals)',
            additionalProperties: { type: 'string' },
          }
        },
        required: ['entries'],
      },
    }];

    // Call Claude with tool use loop
    let currentResponse = await anthropic.messages.create({
      model: selectedModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationMessages,
      tools,
    });

    let totalInputTokens = currentResponse.usage.input_tokens;
    let totalOutputTokens = currentResponse.usage.output_tokens;

    // Process tool calls until Claude stops using tools
    while (currentResponse.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of currentResponse.content) {
        if (block.type === 'tool_use' && block.name === 'save_profile') {
          const { entries } = block.input as { entries: Record<string, string> };
          const upsert = db.prepare(`
            INSERT INTO advisor_profile (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
          `);
          for (const [key, value] of Object.entries(entries)) {
            upsert.run(key, String(value));
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Profile updated.' });
        }
      }

      // Add assistant message + tool results, then call again
      conversationMessages.push({ role: 'assistant', content: currentResponse.content });
      conversationMessages.push({ role: 'user', content: toolResults });
      currentResponse = await anthropic.messages.create({
        model: selectedModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages: conversationMessages,
        tools,
      });

      totalInputTokens += currentResponse.usage.input_tokens;
      totalOutputTokens += currentResponse.usage.output_tokens;
    }

    const assistantContent = currentResponse.content
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

    const inputTokens = totalInputTokens;
    const outputTokens = totalOutputTokens;
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
      model: currentResponse.model,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      cost,
    });
  } catch (error) {
    console.error('POST /api/advisor error:', error);
    return NextResponse.json({ error: 'Failed to get advisor response' }, { status: 500 });
  }
}
