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
  getMonthlyIncomeExpenseTrend,
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
      WHERE conversation_type IN (?, 'proactive')
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

    // Auto-mark pending proactive questions as answered (user engagement clears badge)
    db.prepare(`
      UPDATE advisor_questions SET status = 'answered', answered_at = datetime('now')
      WHERE status = 'pending'
    `).run();

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
    // Use actual months with income data, not a flat 12, to avoid underestimating when data < 12 months
    const incomeMonths = trailingSavingsRate.monthsWithIncome || 1;
    const avgMonthlyIncome = trailingSavingsRate.income / incomeMonths;

    // Recent paycheck details (deductions, taxes, retirement contributions)
    const recentPaychecks = db.prepare(`
      SELECT date, gross_pay, net_pay, federal_tax, state_tax, social_security, medicare,
             retirement_401k, health_insurance, dental_insurance, vision_insurance, hsa,
             other_deductions, other_deductions_detail, employer, pay_period_start, pay_period_end
      FROM income_records
      ORDER BY date DESC
      LIMIT 6
    `).all() as Array<{
      date: string; gross_pay: number; net_pay: number;
      federal_tax: number | null; state_tax: number | null;
      social_security: number | null; medicare: number | null;
      retirement_401k: number | null; health_insurance: number | null;
      dental_insurance: number | null; vision_insurance: number | null;
      hsa: number | null; other_deductions: number | null;
      other_deductions_detail: string | null; employer: string | null;
      pay_period_start: string | null; pay_period_end: string | null;
    }>;

    const paycheckContext = recentPaychecks.map(p => {
      const deductions: string[] = [];
      if (p.federal_tax) deductions.push(`federal tax: $${p.federal_tax.toFixed(2)}`);
      if (p.state_tax) deductions.push(`state tax: $${p.state_tax.toFixed(2)}`);
      if (p.social_security) deductions.push(`social security: $${p.social_security.toFixed(2)}`);
      if (p.medicare) deductions.push(`medicare: $${p.medicare.toFixed(2)}`);
      if (p.retirement_401k) deductions.push(`401k: $${p.retirement_401k.toFixed(2)}`);
      if (p.health_insurance) deductions.push(`health ins: $${p.health_insurance.toFixed(2)}`);
      if (p.dental_insurance) deductions.push(`dental: $${p.dental_insurance.toFixed(2)}`);
      if (p.vision_insurance) deductions.push(`vision: $${p.vision_insurance.toFixed(2)}`);
      if (p.hsa) deductions.push(`HSA: $${p.hsa.toFixed(2)}`);
      if (p.other_deductions) {
        let detail = '';
        if (p.other_deductions_detail) {
          try { detail = ` (${Object.entries(JSON.parse(p.other_deductions_detail)).map(([k,v]) => `${k}: $${Number(v).toFixed(2)}`).join(', ')})`; } catch {}
        }
        deductions.push(`other: $${p.other_deductions.toFixed(2)}${detail}`);
      }
      const period = p.pay_period_start && p.pay_period_end ? ` (${p.pay_period_start} to ${p.pay_period_end})` : '';
      const emp = p.employer ? ` [${p.employer}]` : '';
      return `  ${p.date}${period}${emp}: gross $${p.gross_pay.toFixed(2)} → net $${p.net_pay.toFixed(2)}${deductions.length > 0 ? `\n    Deductions: ${deductions.join(', ')}` : ''}`;
    }).join('\n');

    // 12-month income/expense trend for historical context
    const trend = getMonthlyIncomeExpenseTrend(12);
    const trendContext = trend.map(t =>
      `  ${t.month}: income=$${t.income.toLocaleString()}, expenses=$${t.expenses.toLocaleString()}, savings=$${t.savings.toLocaleString()} (${t.savingsRate}%)`
    ).join('\n');

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

    const goalsContext = goals.map(g => {
      const acct = g.account_id
        ? accounts.find(a => a.id === g.account_id)
        : null;
      const acctLabel = acct ? ` [tracking: ${acct.name}]` : '';
      return `  ${g.name} (${g.type}): $${g.current_amount.toLocaleString()} / $${g.target_amount.toLocaleString()} (${g.progress.toFixed(1)}%)${acctLabel}`;
    }).join('\n');

    const accountsContext = accounts.map(a => {
      const bal = a.balance != null ? `$${a.balance.toLocaleString()}` : 'no balance';
      const inst = a.institution ? ` (${a.institution})` : '';
      return `  [${a.type}] ${a.name}${inst}: ${bal}`;
    }).join('\n');

    // Query known spending events for context
    const spendingEvents = db.prepare(`
      SELECT se.id, se.name, se.description, se.category, se.date_start, se.date_end,
             se.total_amount, se.tags,
             GROUP_CONCAT(te.transaction_id) as linked_txn_ids
      FROM spending_events se
      LEFT JOIN transaction_events te ON te.event_id = se.id
      GROUP BY se.id
      ORDER BY se.created_at DESC
      LIMIT 15
    `).all() as Array<{
      id: number; name: string; description: string; category: string;
      date_start: string; date_end: string; total_amount: number;
      tags: string; linked_txn_ids: string | null;
    }>;

    const spendingEventsContext = spendingEvents.length > 0
      ? spendingEvents.map(e => {
          const txnIds = e.linked_txn_ids ? ` [txn IDs: ${e.linked_txn_ids}]` : '';
          return `  - "${e.name}" (${e.category || '?'}, ${e.date_start || '?'}–${e.date_end || '?'}, $${e.total_amount?.toFixed(2) || '?'})${txnIds}: ${e.description || 'no description'}`;
        }).join('\n')
      : '';

    // Query pending proactive questions for context
    const pendingQuestions = db.prepare(`
      SELECT question, context_json FROM advisor_questions WHERE status = 'pending'
    `).all() as Array<{ question: string; context_json: string }>;

    const pendingQuestionsContext = pendingQuestions.length > 0
      ? pendingQuestions.map(q => {
          const ctx = JSON.parse(q.context_json || '{}');
          return `  - Question: "${q.question}" (Category: ${ctx.category || '?'}, This month: $${ctx.this_month_amount?.toFixed(2) || '?'}, Last month: $${ctx.last_month_amount?.toFixed(2) || '?'}, Transaction IDs: ${(ctx.transaction_ids || []).join(', ') || 'none'})`;
        }).join('\n')
      : '';

    const systemPrompt = `You are a knowledgeable and supportive personal financial advisor for the Sage Finance app. You help users understand their finances, set and achieve goals, and make smart financial decisions.

USER PROFILE:
${profileContext || 'No profile information set yet.'}

CURRENT FINANCIAL SNAPSHOT:
- This month so far (PARTIAL — may not include all paychecks yet): income recorded: $${savingsRate.income.toLocaleString()}, expenses: $${savingsRate.expenses.toLocaleString()}
- Average monthly net income (based on ${incomeMonths} month${incomeMonths !== 1 ? 's' : ''} of data): $${Math.round(avgMonthlyIncome).toLocaleString()}
- Trailing 12-month totals: income $${trailingSavingsRate.income.toLocaleString()}, expenses $${trailingSavingsRate.expenses.toLocaleString()}, savings rate ${trailingSavingsRate.rate}%
- Net worth: $${netWorth.total.toLocaleString()} (assets: $${netWorth.assets.toLocaleString()}, liabilities: $${netWorth.liabilities.toLocaleString()})

RECENT PAYCHECKS & DEDUCTIONS:
${paycheckContext || '  No paycheck records available.'}

12-MONTH INCOME/EXPENSE TREND:
${trendContext}

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
- TRANSACTION LOOKUP: You have a search_transactions tool. When the user asks about specific charges, past months, or transactions outside your recent 30-day window, USE IT to look them up. Never say you don't have access to older data — search for it instead. You can search by date range, amount, description, category, or account.
- CRITICAL INCOME NOTE: The "this month so far" income figure is PARTIAL — it only reflects paychecks recorded so far this month, NOT full monthly income. The user is typically paid twice per month. NEVER treat a single paycheck as the user's monthly income. Always use the "average monthly net income (trailing 12 months)" figure when discussing monthly take-home pay, budgeting, or savings potential. If current month income is $0 or seems low, that's normal — paychecks may not have been recorded yet.

GOAL MANAGEMENT:
- You have a manage_goals tool. Use it when the user wants to set financial goals, savings targets, or track progress toward any financial milestone.
- When creating goals, link them to accounts when possible (using account_id) so progress updates automatically from balance snapshots.
- Available account IDs are shown in the ACCOUNTS section above — match goals to the most relevant account.
- Goal types: fi (financial independence), home_purchase, savings, debt_payoff, custom.

PROFILE MANAGEMENT:
- You have a save_profile tool. Use it to save any personal or financial details the user shares.
- Important profile fields: name, age, location, occupation, total_comp (total annual compensation), expected_bonus, filing_status, risk_tolerance, financial_goals
- If KEY profile fields are missing (especially age, location, total_comp), naturally ask about 1-2 missing fields when relevant to the conversation — don't rapid-fire all questions at once.
- When the user shares info like "I'm 32" or "I make 180k", immediately save it via save_profile.
- For total_comp, ask about base salary + equity/RSU + bonus breakdown if the user mentions compensation.

FOLLOW-UP QUESTIONS:
- You have a save_followup tool. Use it whenever you ask the user an important question they haven't answered yet.
- Examples: HSA contribution details, employer 401k match, insurance coverage, tax filing specifics, benefit elections.
- This saves the question so you'll see it in future conversations and can circle back to it.
- Do NOT save trivial or rhetorical questions — only ones where the answer would meaningfully improve your financial advice.

SPENDING EVENT TRACKING:
- You have a save_spending_event tool. Use it when the user explains unusual spending (e.g., "that was a ski trip" or "I bought furniture for the new apartment").
- Capture the event with a descriptive name, category, date range, estimated total amount, and link relevant transaction IDs if available.
- This helps avoid re-asking about spending the user has already explained.
${spendingEventsContext ? `
KNOWN SPENDING EVENTS (reference these naturally when discussing the user's spending history):
${spendingEventsContext}
` : ''}${pendingQuestionsContext ? `
PROACTIVE QUESTIONS YOU ASKED (the user may be responding to one of these — use the transaction IDs when calling save_spending_event):
${pendingQuestionsContext}
` : ''}`;

    // Get recent conversation history for context (reduced from 20 since summaries cover older history)
    // Include proactive messages so the advisor knows what it previously asked
    const recentMessages = db.prepare(`
      SELECT role, content FROM conversations
      WHERE conversation_type IN (?, 'proactive')
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
    const tools: Anthropic.Tool[] = [
      {
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
      },
      {
        name: 'search_transactions',
        description: 'Search the user\'s full transaction history. Use this to look up specific charges, find transactions in past months, investigate unusual spending, or answer questions about historical transactions. Returns up to 20 matching transactions.',
        input_schema: {
          type: 'object' as const,
          properties: {
            date_from: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to 1 year ago if not specified.' },
            date_to: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today if not specified.' },
            min_amount: { type: 'number', description: 'Minimum absolute amount to filter by' },
            max_amount: { type: 'number', description: 'Maximum absolute amount to filter by' },
            description: { type: 'string', description: 'Search term to match against transaction descriptions (partial match, case-insensitive)' },
            category: { type: 'string', description: 'Category name to filter by (exact match)' },
            account: { type: 'string', description: 'Account name to filter by (partial match)' },
            type: { type: 'string', enum: ['expense', 'income'], description: 'Transaction type filter' },
          },
          required: [],
        },
      },
      {
        name: 'save_spending_event',
        description: 'Save a named spending event when the user explains unusual spending. This stores the explanation so the system won\'t ask about it again.',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Short descriptive name for the event (e.g., "Ski trip to Vail", "New apartment furniture")' },
            category: { type: 'string', description: 'Spending category this event falls under' },
            description: { type: 'string', description: 'Brief description of the event' },
            date_start: { type: 'string', description: 'Start date (YYYY-MM-DD format)' },
            date_end: { type: 'string', description: 'End date (YYYY-MM-DD format)' },
            total_amount: { type: 'number', description: 'Total amount spent on this event' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for categorization' },
            transaction_ids: { type: 'array', items: { type: 'number' }, description: 'IDs of related transactions to link' },
          },
          required: ['name', 'category'],
        },
      },
      {
        name: 'save_followup',
        description: 'Save an important follow-up question to ask the user later. Use this when you ask the user a question about their finances that they haven\'t answered yet — especially about account details, contribution amounts, employer benefits, insurance, or other information that would improve your advice. The question will appear in your context in future conversations so you can circle back to it.',
        input_schema: {
          type: 'object' as const,
          properties: {
            question: { type: 'string', description: 'The follow-up question you want to ask later' },
            context: { type: 'string', description: 'Brief context for why this question matters (e.g., "Need to know HSA contribution to calculate true savings rate")' },
            category: { type: 'string', description: 'Topic category (e.g., "retirement", "insurance", "taxes", "savings", "benefits")' },
          },
          required: ['question'],
        },
      },
      {
        name: 'manage_goals',
        description: 'Create or update financial goals. Use this when the user wants to set savings targets, track debt payoff, plan for a home purchase, or establish any financial milestone. Link goals to accounts when possible so progress updates automatically from balance snapshots.',
        input_schema: {
          type: 'object' as const,
          properties: {
            action: { type: 'string', enum: ['create', 'update'], description: 'Whether to create a new goal or update an existing one' },
            name: { type: 'string', description: 'Goal name (e.g., "Emergency Fund"). Required for create.' },
            type: { type: 'string', enum: ['fi', 'home_purchase', 'savings', 'debt_payoff', 'custom'], description: 'Goal type. Required for create.' },
            target_amount: { type: 'number', description: 'Target dollar amount. Required for create.' },
            current_amount: { type: 'number', description: 'Current progress amount (default 0). Not needed if linking to an account.' },
            target_date: { type: 'string', description: 'Target completion date (YYYY-MM-DD)' },
            description: { type: 'string', description: 'Brief description of the goal' },
            account_id: { type: 'number', description: 'Link to an account ID for automatic progress tracking from balance snapshots. Use this when the goal maps to a specific account (e.g., savings account, investment account).' },
            goal_id: { type: 'number', description: 'ID of the goal to update. Required for update.' },
            is_active: { type: 'boolean', description: 'Set to false to deactivate a completed or abandoned goal' },
          },
          required: ['action'],
        },
      },
    ];

    // Helper: execute tool calls and return results
    const executeTools = (content: Anthropic.ContentBlock[]): Anthropic.ToolResultBlockParam[] => {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of content) {
        if (block.type !== 'tool_use') continue;

        if (block.name === 'search_transactions') {
          const input = block.input as {
            date_from?: string; date_to?: string;
            min_amount?: number; max_amount?: number;
            description?: string; category?: string;
            account?: string; type?: string;
          };

          const conditions: string[] = [];
          const params: (string | number)[] = [];

          const dateFrom = input.date_from || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const dateTo = input.date_to || new Date().toISOString().slice(0, 10);
          conditions.push('t.date >= ? AND t.date <= ?');
          params.push(dateFrom, dateTo);

          if (input.min_amount != null) { conditions.push('ABS(t.amount) >= ?'); params.push(input.min_amount); }
          if (input.max_amount != null) { conditions.push('ABS(t.amount) <= ?'); params.push(input.max_amount); }
          if (input.description) { conditions.push('LOWER(t.description) LIKE ?'); params.push(`%${input.description.toLowerCase()}%`); }
          if (input.category) { conditions.push('c.name = ?'); params.push(input.category); }
          if (input.account) { conditions.push('LOWER(a.name) LIKE ?'); params.push(`%${input.account.toLowerCase()}%`); }
          if (input.type) { conditions.push('t.type = ?'); params.push(input.type); }

          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const results = db.prepare(`
            SELECT t.id, t.date, t.amount, t.description, t.type,
                   COALESCE(c.name, 'Uncategorized') as category,
                   a.name as account
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            LEFT JOIN accounts a ON a.id = t.account_id
            ${whereClause}
            ORDER BY ABS(t.amount) DESC, t.date DESC
            LIMIT 20
          `).all(...params) as Array<{
            id: number; date: string; amount: number; description: string;
            type: string; category: string; account: string;
          }>;

          const resultText = results.length > 0
            ? results.map(t =>
                `  ID:${t.id} | ${t.date} | $${Math.abs(t.amount).toFixed(2)} | ${t.description} | ${t.category} | ${t.account} | ${t.type}`
              ).join('\n')
            : '  No matching transactions found.';

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Found ${results.length} transaction(s):\n${resultText}`,
          });
        } else if (block.name === 'save_profile') {
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
        } else if (block.name === 'save_spending_event') {
          const input = block.input as {
            name: string; category: string; description?: string;
            date_start?: string; date_end?: string; total_amount?: number;
            tags?: string[]; transaction_ids?: number[];
          };

          const result = db.prepare(`
            INSERT INTO spending_events (name, description, category, date_start, date_end, total_amount, tags, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'advisor')
          `).run(
            input.name,
            input.description || null,
            input.category,
            input.date_start || null,
            input.date_end || null,
            input.total_amount || null,
            input.tags ? JSON.stringify(input.tags) : null,
          );

          const eventId = result.lastInsertRowid;
          if (input.transaction_ids && input.transaction_ids.length > 0) {
            const linkStmt = db.prepare(`
              INSERT OR IGNORE INTO transaction_events (transaction_id, event_id) VALUES (?, ?)
            `);
            for (const txnId of input.transaction_ids) {
              linkStmt.run(txnId, eventId);
            }
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Spending event "${input.name}" saved successfully${input.transaction_ids?.length ? ` with ${input.transaction_ids.length} linked transactions` : ''}.`,
          });
        } else if (block.name === 'save_followup') {
          const input = block.input as {
            question: string; context?: string; category?: string;
          };

          db.prepare(`
            INSERT INTO advisor_questions (question, context_json, status, created_at)
            VALUES (?, ?, 'pending', datetime('now'))
          `).run(
            input.question,
            JSON.stringify({ context: input.context || null, category: input.category || null }),
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Follow-up question saved: "${input.question}"`,
          });
        } else if (block.name === 'manage_goals') {
          const input = block.input as {
            action: 'create' | 'update';
            name?: string; type?: string; target_amount?: number;
            current_amount?: number; target_date?: string;
            description?: string; account_id?: number;
            goal_id?: number; is_active?: boolean;
          };

          if (input.action === 'create') {
            if (!input.name || !input.type || input.target_amount == null) {
              toolResults.push({
                type: 'tool_result', tool_use_id: block.id,
                content: 'Error: name, type, and target_amount are required for creating a goal.',
              });
            } else {
              const result = db.prepare(`
                INSERT INTO goals (name, type, target_amount, current_amount, target_date, description, account_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                input.name, input.type, input.target_amount,
                input.current_amount ?? 0,
                input.target_date ?? null,
                input.description ?? null,
                input.account_id ?? null,
              );
              const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid) as {
                id: number; name: string; type: string; target_amount: number;
                current_amount: number; account_id: number | null;
              };

              let currentAmount = goal.current_amount;
              if (goal.account_id) {
                const bal = db.prepare(
                  'SELECT balance FROM balances WHERE account_id = ? ORDER BY date DESC LIMIT 1'
                ).get(goal.account_id) as { balance: number } | undefined;
                if (bal) currentAmount = bal.balance;
              }

              const progress = goal.target_amount > 0
                ? Math.min(100, (currentAmount / goal.target_amount) * 100)
                : 0;

              toolResults.push({
                type: 'tool_result', tool_use_id: block.id,
                content: `Goal "${input.name}" created (ID: ${goal.id}). Current: $${currentAmount.toLocaleString()} / $${goal.target_amount.toLocaleString()} (${progress.toFixed(1)}% complete)${goal.account_id ? ' — linked to account for auto-tracking' : ''}.`,
              });
            }
          } else if (input.action === 'update') {
            if (!input.goal_id) {
              toolResults.push({
                type: 'tool_result', tool_use_id: block.id,
                content: 'Error: goal_id is required for updating a goal.',
              });
            } else {
              const existing = db.prepare('SELECT id FROM goals WHERE id = ?').get(input.goal_id);
              if (!existing) {
                toolResults.push({
                  type: 'tool_result', tool_use_id: block.id,
                  content: `Error: Goal with ID ${input.goal_id} not found.`,
                });
              } else {
                const fields: string[] = [];
                const values: (string | number | null)[] = [];

                if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
                if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
                if (input.current_amount !== undefined) { fields.push('current_amount = ?'); values.push(input.current_amount); }
                if (input.target_amount !== undefined) { fields.push('target_amount = ?'); values.push(input.target_amount); }
                if (input.target_date !== undefined) { fields.push('target_date = ?'); values.push(input.target_date); }
                if (input.is_active !== undefined) { fields.push('is_active = ?'); values.push(input.is_active ? 1 : 0); }
                if (input.account_id !== undefined) { fields.push('account_id = ?'); values.push(input.account_id); }

                if (fields.length > 0) {
                  fields.push("updated_at = datetime('now')");
                  values.push(input.goal_id);
                  db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
                }

                const updated = db.prepare('SELECT * FROM goals WHERE id = ?').get(input.goal_id) as {
                  name: string; target_amount: number; current_amount: number; account_id: number | null;
                };

                let currentAmount = updated.current_amount;
                if (updated.account_id) {
                  const bal = db.prepare(
                    'SELECT balance FROM balances WHERE account_id = ? ORDER BY date DESC LIMIT 1'
                  ).get(updated.account_id) as { balance: number } | undefined;
                  if (bal) currentAmount = bal.balance;
                }

                const progress = updated.target_amount > 0
                  ? Math.min(100, (currentAmount / updated.target_amount) * 100)
                  : 0;

                toolResults.push({
                  type: 'tool_result', tool_use_id: block.id,
                  content: `Goal "${updated.name}" updated. Current: $${currentAmount.toLocaleString()} / $${updated.target_amount.toLocaleString()} (${progress.toFixed(1)}% complete).`,
                });
              }
            }
          }
        }
      }
      return toolResults;
    };

    // Stream response via SSE
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let fullText = '';
          let modelName = '';

          // Streaming loop: stream text, handle tool use, repeat
          let streaming = true;
          while (streaming) {
            const msgStream = anthropic.messages.stream({
              model: selectedModel,
              max_tokens: 1024,
              system: systemPrompt,
              messages: conversationMessages,
              tools,
            });

            msgStream.on('text', (text) => {
              fullText += text;
              send({ type: 'delta', text });
            });

            const finalMessage = await msgStream.finalMessage();
            modelName = finalMessage.model;
            totalInputTokens += finalMessage.usage.input_tokens;
            totalOutputTokens += finalMessage.usage.output_tokens;

            if (finalMessage.stop_reason === 'tool_use') {
              // Notify client that tools are running
              const toolNames = finalMessage.content
                .filter(b => b.type === 'tool_use')
                .map(b => b.type === 'tool_use' ? b.name : '');
              for (const name of toolNames) {
                send({ type: 'tool_status', tool: name });
              }

              const toolResults = executeTools(finalMessage.content);
              conversationMessages.push({ role: 'assistant', content: finalMessage.content });
              conversationMessages.push({ role: 'user', content: toolResults });
            } else {
              streaming = false;
            }
          }

          // Save assistant response to DB
          db.prepare(`
            INSERT INTO conversations (role, content, conversation_type)
            VALUES ('assistant', ?, ?)
          `).run(fullText, convType);

          // Auto-compaction check
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
              const baseUrl = request.nextUrl.origin;
              fetch(`${baseUrl}/api/advisor/compact`, { method: 'POST' }).catch(() => {});
            }
          } catch (compactErr) {
            console.error('Auto-compaction check failed:', compactErr);
          }

          // Compute cost and send final metadata
          const pricing: Record<string, [number, number]> = {
            'claude-sonnet-4-5-20250929': [3, 15],
            'claude-opus-4-6': [15, 75],
            'claude-haiku-4-5-20251001': [0.80, 4],
          };
          const [inPrice, outPrice] = pricing[selectedModel] ?? [3, 15];
          const cost = (totalInputTokens * inPrice + totalOutputTokens * outPrice) / 1_000_000;

          send({
            type: 'done',
            model: modelName,
            usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
            cost,
          });
        } catch (err) {
          console.error('Streaming error:', err);
          send({ type: 'error', message: err instanceof Error ? err.message : 'Streaming failed' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('POST /api/advisor error:', error);
    return NextResponse.json({ error: 'Failed to get advisor response' }, { status: 500 });
  }
}
