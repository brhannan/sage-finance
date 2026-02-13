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
import { getDb, isDemoMode } from '@/lib/db';

const anthropic = new Anthropic();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET() {
  try {
    const db = getDb();
    const cacheKey = isDemoMode() ? 'demo' : 'real';

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

    // Compute lightweight data fingerprint for change detection
    const transactionCount = (db.prepare('SELECT COUNT(*) as cnt FROM transactions').get() as { cnt: number }).cnt;
    const totalAmount = (db.prepare('SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions').get() as { total: number }).total;
    const accountCount = accounts.length;
    const dataHash = `${transactionCount}-${totalAmount}-${accountCount}-${netWorth.total}`;

    // Check SQLite cache
    const cached = db.prepare(
      'SELECT data, generated_at, data_hash FROM insights_cache WHERE cache_key = ?'
    ).get(cacheKey) as { data: string; generated_at: number; data_hash: string } | undefined;

    if (cached) {
      const age = Date.now() - cached.generated_at;
      if (age < CACHE_TTL_MS && cached.data_hash === dataHash) {
        return NextResponse.json(JSON.parse(cached.data));
      }
    }

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

    // Query previously explained spending events so Claude doesn't re-ask
    const spendingEvents = db.prepare(`
      SELECT name, category, date_start, date_end, total_amount, description
      FROM spending_events
      ORDER BY created_at DESC
      LIMIT 10
    `).all() as Array<{ name: string; category: string; date_start: string; date_end: string; total_amount: number; description: string }>;

    const spendingEventsContext = spendingEvents.length > 0
      ? spendingEvents.map(e =>
          `  - "${e.name}" (${e.category || 'unknown category'}, ${e.date_start || '?'}–${e.date_end || '?'}, $${e.total_amount?.toFixed(2) || '?'}): ${e.description || 'no description'}`
        ).join('\n')
      : '';

    const prompt = `You are a financial trends engine. Analyze this person's recent financial data and return a JSON response with exactly this structure:

{
  "summary": "1 concise sentence about recent trends",
  "going_well": ["short bullet", "short bullet"],
  "to_improve": ["short bullet", "short bullet"],
  "detailed_report": "A thorough multi-paragraph financial report in markdown format.",
  "proactive_questions": [
    {"question": "conversational question text", "category": "CategoryName", "reasoning": "internal note explaining why this is unusual"}
  ]
}

Rules:
- FOCUS ON RECENT TRENDS: Your summary and bullets must focus on what has CHANGED in the last 1-2 months compared to prior months. Examples: "Dining up 30% vs last month", "New Recreation spending appeared", "Income stable at $X/month".
- Do NOT restate net worth, total savings, or savings rate numbers — those are already visible on the dashboard. Instead highlight CHANGES and SHIFTS.
- "summary": 1 sentence max, highlight the most notable recent trend or change
- "going_well": exactly 2 bullets, each under 10 words, about positive recent changes
- "to_improve": exactly 2 bullets, each under 10 words, about concerning recent changes, actionable
- "detailed_report": thorough markdown report (3-5 sections with ## headers) covering:
  - Recent spending shifts and notable category changes (explain WHY if you can infer, e.g. Travel spike = a trip)
  - Income trends and any month-over-month variation
  - Retirement & investment account trajectory
  - Specific recommendations (numbered, actionable)
- Do NOT mention incomplete monthly data in the short bullets—save detail for the report
- IMPORTANT: Paychecks are typically recorded mid-month (around the 15th). If the current date is before the 16th, $0 income for the current month is COMPLETELY NORMAL—do NOT flag it as a concern, warning, or action item anywhere (summary, bullets, or report). Simply note the month is in progress if relevant, then move on. Focus on trailing 12-month metrics for current financial health.

PROACTIVE QUESTIONS:
- "proactive_questions": 0 to 3 questions about genuinely unusual or notable spending patterns you'd like to understand better.
- Only ask about patterns that are TRULY unusual — significant spikes, new categories, or dramatic shifts compared to the prior month. Do NOT ask about normal/expected patterns.
- Each question should be conversational and friendly, like a financial advisor checking in. Example: "I noticed your Recreation spending jumped to $841 this month — was there a fun trip or event?"
- "category" should match the spending category name exactly.
- "reasoning" is your internal note (not shown to user) explaining why this is unusual.
- Do NOT ask about categories or patterns already explained in the PREVIOUSLY EXPLAINED EVENTS section below.
- Return an empty array if nothing is genuinely unusual.
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
${spendingEventsContext ? `
PREVIOUSLY EXPLAINED EVENTS (do NOT ask about these — the user already explained them):
${spendingEventsContext}
` : ''}
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

    // Process proactive questions before caching
    const proactiveQuestions: Array<{ question: string; category: string; reasoning: string }> =
      Array.isArray(insights.proactive_questions) ? insights.proactive_questions : [];

    if (proactiveQuestions.length > 0) {
      // Dismiss any stale pending questions
      db.prepare(`UPDATE advisor_questions SET status = 'dismissed' WHERE status = 'pending'`).run();

      const currentMonthStr = new Date().toISOString().slice(0, 7);

      const insertConversation = db.prepare(`
        INSERT INTO conversations (role, content, conversation_type)
        VALUES ('assistant', ?, 'proactive')
      `);
      const insertQuestion = db.prepare(`
        INSERT INTO advisor_questions (question, context_json, conversation_id, status)
        VALUES (?, ?, ?, 'pending')
      `);

      for (const pq of proactiveQuestions.slice(0, 3)) {
        // Find the category ID for this question
        const cat = db.prepare(`SELECT id FROM categories WHERE name = ?`).get(pq.category) as { id: number } | undefined;

        // Get transaction IDs for this category in the current month
        let transactionIds: number[] = [];
        let thisMonthAmount = 0;
        let lastMonthAmount = 0;

        if (cat) {
          const txns = db.prepare(`
            SELECT id, amount FROM transactions
            WHERE category_id = ? AND strftime('%Y-%m', date) = ? AND type = 'expense'
            ORDER BY ABS(amount) DESC
            LIMIT 10
          `).all(cat.id, currentMonthStr) as Array<{ id: number; amount: number }>;
          transactionIds = txns.map(t => t.id);
          thisMonthAmount = txns.reduce((sum, t) => sum + Math.abs(t.amount), 0);

          const lastMonthTxns = db.prepare(`
            SELECT amount FROM transactions
            WHERE category_id = ? AND strftime('%Y-%m', date) = ? AND type = 'expense'
          `).all(cat.id, lastMonthStr) as Array<{ amount: number }>;
          lastMonthAmount = lastMonthTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        }

        const contextJson = JSON.stringify({
          category: pq.category,
          reasoning: pq.reasoning,
          this_month_amount: thisMonthAmount,
          last_month_amount: lastMonthAmount,
          transaction_ids: transactionIds,
        });

        // Insert as a conversation message
        const convResult = insertConversation.run(pq.question);
        const conversationId = convResult.lastInsertRowid;

        // Insert the advisor question
        insertQuestion.run(pq.question, contextJson, conversationId);
      }
    }

    // Strip proactive_questions from cached/returned data (dashboard doesn't need it)
    delete insights.proactive_questions;

    // Persist to SQLite cache
    db.prepare(`
      INSERT INTO insights_cache (id, cache_key, data, generated_at, data_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cache_key = excluded.cache_key,
        data = excluded.data,
        generated_at = excluded.generated_at,
        data_hash = excluded.data_hash
    `).run(
      cacheKey === 'demo' ? 2 : 1,
      cacheKey,
      JSON.stringify(insights),
      Date.now(),
      dataHash
    );

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
