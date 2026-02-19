// Custom promptfoo provider that calls the Claude SDK directly,
// replicating the advisor's behavior without a running Next.js server.
//
// Self-contained: inlines context building, tool definitions, and tool stubs
// to avoid ESM cross-file import issues with promptfoo's TS loader.
//
// Reference files (kept for documentation/maintenance):
//   - context-builder.ts — system prompt builder
//   - tool-definitions.ts — tool schemas
//   - tool-stubs.ts — canned tool results

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOOL_ROUNDS = 5;

// ─── Tool Definitions ───────────────────────────────────────────────
// Extracted from src/app/api/advisor/route.ts (lines 304-389)

const advisorTools: Anthropic.Tool[] = [
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
        },
      },
      required: ['entries'],
    },
  },
  {
    name: 'search_transactions',
    description: "Search the user's full transaction history. Use this to look up specific charges, find transactions in past months, investigate unusual spending, or answer questions about historical transactions. Returns up to 20 matching transactions.",
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
    description: "Save a named spending event when the user explains unusual spending. This stores the explanation so the system won't ask about it again.",
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
    description: "Save an important follow-up question to ask the user later. Use this when you ask the user a question about their finances that they haven't answered yet.",
    input_schema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'The follow-up question you want to ask later' },
        context: { type: 'string', description: 'Brief context for why this question matters' },
        category: { type: 'string', description: 'Topic category (e.g., "retirement", "insurance", "taxes")' },
      },
      required: ['question'],
    },
  },
  {
    name: 'manage_goals',
    description: 'Create or update financial goals. Use this when the user wants to set savings targets, track debt payoff, plan for a home purchase, or establish any financial milestone.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['create', 'update'], description: 'Whether to create a new goal or update an existing one' },
        name: { type: 'string', description: 'Goal name (e.g., "Emergency Fund"). Required for create.' },
        type: { type: 'string', enum: ['fi', 'home_purchase', 'savings', 'debt_payoff', 'custom'], description: 'Goal type. Required for create.' },
        target_amount: { type: 'number', description: 'Target dollar amount. Required for create.' },
        current_amount: { type: 'number', description: 'Current progress amount (default 0).' },
        target_date: { type: 'string', description: 'Target completion date (YYYY-MM-DD)' },
        description: { type: 'string', description: 'Brief description of the goal' },
        account_id: { type: 'number', description: 'Link to an account ID for automatic progress tracking.' },
        goal_id: { type: 'number', description: 'ID of the goal to update. Required for update.' },
        is_active: { type: 'boolean', description: 'Set to false to deactivate a completed or abandoned goal' },
      },
      required: ['action'],
    },
  },
];

// ─── Tool Stubs ─────────────────────────────────────────────────────

function getToolStubResult(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'save_profile':
      return 'Profile updated.';
    case 'search_transactions':
      return getSearchTransactionsResult(input);
    case 'save_spending_event': {
      const name = (input.name as string) || 'Event';
      const txnIds = input.transaction_ids as number[] | undefined;
      return `Spending event "${name}" saved successfully${txnIds?.length ? ` with ${txnIds.length} linked transactions` : ''}.`;
    }
    case 'save_followup':
      return `Follow-up question saved: "${(input.question as string) || 'Follow-up'}"`;
    case 'manage_goals':
      return getManageGoalsResult(input);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

function getSearchTransactionsResult(input: Record<string, unknown>): string {
  const desc = ((input.description as string) || '').toLowerCase();
  const cat = ((input.category as string) || '').toLowerCase();

  if (desc.includes('amazon')) {
    return `Found 5 transaction(s):\n  ID:201 | 2026-01-28 | $89.99 | Amazon.com - Electronics | Shopping | Chase Sapphire | expense\n  ID:198 | 2026-01-22 | $34.50 | Amazon.com - Household | Shopping | Chase Sapphire | expense\n  ID:185 | 2026-01-15 | $125.00 | Amazon.com - Kitchen | Shopping | Chase Sapphire | expense\n  ID:172 | 2026-01-08 | $22.99 | Amazon.com - Books | Shopping | Chase Sapphire | expense\n  ID:156 | 2026-01-02 | $67.50 | Amazon.com - Office | Shopping | Chase Sapphire | expense`;
  }
  if (desc.includes('restaurant') || cat.includes('dining') || cat.includes('restaurant')) {
    return `Found 6 transaction(s):\n  ID:205 | 2026-01-30 | $78.50 | Sushi Den | Dining & Restaurants | Chase Sapphire | expense\n  ID:195 | 2026-01-24 | $45.00 | Chipotle | Dining & Restaurants | Chase Sapphire | expense\n  ID:188 | 2026-01-18 | $92.00 | Guard and Grace | Dining & Restaurants | Chase Sapphire | expense\n  ID:175 | 2026-01-11 | $32.50 | Illegal Pete's | Dining & Restaurants | Chase Sapphire | expense\n  ID:162 | 2026-01-05 | $55.00 | Mercantile Dining | Dining & Restaurants | Chase Sapphire | expense\n  ID:148 | 2025-12-28 | $120.00 | Tavernetta | Dining & Restaurants | Chase Sapphire | expense`;
  }
  if (desc.includes('gas') || cat.includes('gas') || cat.includes('fuel') || cat.includes('auto')) {
    return `Found 4 transaction(s):\n  ID:199 | 2026-01-25 | $52.00 | Shell Gas Station | Auto & Gas | Wells Fargo Checking | expense\n  ID:180 | 2026-01-12 | $48.50 | Costco Gas | Auto & Gas | Wells Fargo Checking | expense\n  ID:160 | 2025-12-30 | $55.00 | King Soopers Fuel | Auto & Gas | Wells Fargo Checking | expense\n  ID:140 | 2025-12-15 | $50.00 | Shell Gas Station | Auto & Gas | Wells Fargo Checking | expense`;
  }
  if ((input.min_amount as number) >= 200) {
    return `Found 3 transaction(s):\n  ID:210 | 2026-01-28 | $450.00 | REI - Ski Equipment | Shopping | Chase Sapphire | expense\n  ID:188 | 2026-01-15 | $350.00 | United Airlines | Travel | Chase Sapphire | expense\n  ID:170 | 2026-01-05 | $275.00 | Costco Wholesale | Groceries | Wells Fargo Checking | expense`;
  }
  return `Found 8 transaction(s):\n  ID:205 | 2026-01-30 | $78.50 | Sushi Den | Dining & Restaurants | Chase Sapphire | expense\n  ID:201 | 2026-01-28 | $89.99 | Amazon.com | Shopping | Chase Sapphire | expense\n  ID:199 | 2026-01-25 | $52.00 | Shell Gas Station | Auto & Gas | Wells Fargo Checking | expense\n  ID:195 | 2026-01-22 | $156.00 | King Soopers | Groceries | Wells Fargo Checking | expense\n  ID:190 | 2026-01-19 | $45.00 | Netflix + Spotify | Subscriptions | Chase Sapphire | expense\n  ID:185 | 2026-01-15 | $125.00 | Xcel Energy | Utilities | Wells Fargo Checking | expense\n  ID:180 | 2026-01-12 | $85.00 | Target | Shopping | Chase Sapphire | expense\n  ID:175 | 2026-01-08 | $32.50 | Illegal Pete's | Dining & Restaurants | Chase Sapphire | expense`;
}

function getManageGoalsResult(input: Record<string, unknown>): string {
  const action = input.action as string;
  if (action === 'create') {
    const name = (input.name as string) || 'New Goal';
    const target = (input.target_amount as number) || 0;
    const current = (input.current_amount as number) || 0;
    const progress = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const linked = input.account_id ? ' — linked to account for auto-tracking' : '';
    return `Goal "${name}" created (ID: 5). Current: $${current.toLocaleString()} / $${target.toLocaleString()} (${progress.toFixed(1)}% complete)${linked}.`;
  }
  if (action === 'update') {
    const goalId = input.goal_id as number;
    if (!goalId) return 'Error: goal_id is required for updating a goal.';
    const target = (input.target_amount as number) || 25000;
    const name = (input.name as string) || 'Emergency Fund';
    return `Goal "${name}" updated. Current: $24,000 / $${target.toLocaleString()} (${((24000 / target) * 100).toFixed(1)}% complete).`;
  }
  return 'Error: action must be "create" or "update".';
}

// ─── Context Builder ────────────────────────────────────────────────

interface FinancialContext {
  profile: Record<string, string>;
  savingsRate: { income: number; expenses: number };
  trailingSavingsRate: { income: number; expenses: number; rate: number; monthsWithIncome: number };
  netWorth: { total: number; assets: number; liabilities: number };
  avgMonthlyIncome: number;
  accounts: Array<{ id: number; name: string; type: string; institution?: string; balance: number | null }>;
  topSpending: Array<{ name: string; amount: number; budget?: number }>;
  recentTransactions: Array<{ date: string; amount: number; description: string; category: string; account: string }>;
  goals: Array<{ name: string; type: string; current_amount: number; target_amount: number; progress: number; account_id?: number | null }>;
  recentPaychecks: Array<{
    date: string; gross_pay: number; net_pay: number; employer?: string;
    pay_period_start?: string; pay_period_end?: string;
    federal_tax?: number; state_tax?: number; social_security?: number; medicare?: number;
    retirement_401k?: number; health_insurance?: number; dental_insurance?: number;
    vision_insurance?: number; hsa?: number;
  }>;
  trend: Array<{ month: string; income: number; expenses: number; savings: number; savingsRate: number }>;
  spendingEvents?: Array<{ name: string; category: string; description?: string; date_start?: string; date_end?: string; total_amount?: number }>;
}

function buildSystemPrompt(ctx: FinancialContext): string {
  const profileContext = Object.entries(ctx.profile).map(([k, v]) => `${k}: ${v}`).join('\n');
  const incomeMonths = ctx.trailingSavingsRate.monthsWithIncome || 1;

  const paycheckContext = ctx.recentPaychecks.map((p) => {
    const d: string[] = [];
    if (p.federal_tax) d.push(`federal tax: $${p.federal_tax.toFixed(2)}`);
    if (p.state_tax) d.push(`state tax: $${p.state_tax.toFixed(2)}`);
    if (p.social_security) d.push(`social security: $${p.social_security.toFixed(2)}`);
    if (p.medicare) d.push(`medicare: $${p.medicare.toFixed(2)}`);
    if (p.retirement_401k) d.push(`401k: $${p.retirement_401k.toFixed(2)}`);
    if (p.health_insurance) d.push(`health ins: $${p.health_insurance.toFixed(2)}`);
    if (p.dental_insurance) d.push(`dental: $${p.dental_insurance.toFixed(2)}`);
    if (p.vision_insurance) d.push(`vision: $${p.vision_insurance.toFixed(2)}`);
    if (p.hsa) d.push(`HSA: $${p.hsa.toFixed(2)}`);
    const period = p.pay_period_start && p.pay_period_end ? ` (${p.pay_period_start} to ${p.pay_period_end})` : '';
    const emp = p.employer ? ` [${p.employer}]` : '';
    return `  ${p.date}${period}${emp}: gross $${p.gross_pay.toFixed(2)} → net $${p.net_pay.toFixed(2)}${d.length > 0 ? `\n    Deductions: ${d.join(', ')}` : ''}`;
  }).join('\n');

  const trendContext = ctx.trend.map((t) =>
    `  ${t.month}: income=$${t.income.toLocaleString()}, expenses=$${t.expenses.toLocaleString()}, savings=$${t.savings.toLocaleString()} (${t.savingsRate}%)`
  ).join('\n');

  const topSpending = ctx.topSpending.slice(0, 10).map((s) =>
    `  ${s.name}: $${s.amount.toFixed(2)}${s.budget ? ` (budget: $${s.budget.toFixed(2)})` : ''}`
  ).join('\n');

  const recentTxnContext = ctx.recentTransactions.map((t) =>
    `  ${t.date} | $${Math.abs(t.amount).toFixed(2)} | ${t.description.slice(0, 40)} | ${t.category} | ${t.account}`
  ).join('\n');

  const goalsContext = ctx.goals.map((g) => {
    const acct = g.account_id ? ctx.accounts.find((a) => a.id === g.account_id) : null;
    const acctLabel = acct ? ` [tracking: ${acct.name}]` : '';
    return `  ${g.name} (${g.type}): $${g.current_amount.toLocaleString()} / $${g.target_amount.toLocaleString()} (${g.progress.toFixed(1)}%)${acctLabel}`;
  }).join('\n');

  const accountsContext = ctx.accounts.map((a) => {
    const bal = a.balance != null ? `$${a.balance.toLocaleString()}` : 'no balance';
    const inst = a.institution ? ` (${a.institution})` : '';
    return `  [${a.type}] ${a.name}${inst}: ${bal}`;
  }).join('\n');

  const spendingEventsContext = ctx.spendingEvents?.length
    ? ctx.spendingEvents.map((e) =>
        `  - "${e.name}" (${e.category || '?'}, ${e.date_start || '?'}–${e.date_end || '?'}, $${e.total_amount?.toFixed(2) || '?'}): ${e.description || 'no description'}`
      ).join('\n')
    : '';

  return `You are a knowledgeable and supportive personal financial advisor for the Sage Finance app. You help users understand their finances, set and achieve goals, and make smart financial decisions.

USER PROFILE:
${profileContext || 'No profile information set yet.'}

CURRENT FINANCIAL SNAPSHOT:
- This month so far (PARTIAL — may not include all paychecks yet): income recorded: $${ctx.savingsRate.income.toLocaleString()}, expenses: $${ctx.savingsRate.expenses.toLocaleString()}
- Average monthly net income (based on ${incomeMonths} month${incomeMonths !== 1 ? 's' : ''} of data): $${Math.round(ctx.avgMonthlyIncome).toLocaleString()}
- Trailing 12-month totals: income $${ctx.trailingSavingsRate.income.toLocaleString()}, expenses $${ctx.trailingSavingsRate.expenses.toLocaleString()}, savings rate ${ctx.trailingSavingsRate.rate}%
- Net worth: $${ctx.netWorth.total.toLocaleString()} (assets: $${ctx.netWorth.assets.toLocaleString()}, liabilities: $${ctx.netWorth.liabilities.toLocaleString()})

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

GUIDELINES:
- Be concise but thorough. Use specific numbers from the user's data.
- Offer actionable advice tailored to their situation.
- If asked about something you don't have data for, say so and suggest how they can add that data.
- Be encouraging about progress and honest about areas for improvement.
- When relevant, mention tax implications, compound interest effects, or opportunity costs.
- Do not make up financial data. Only reference what is provided above.
- TRANSACTION LOOKUP: You have a search_transactions tool. When the user asks about specific charges, past months, or transactions outside your recent 30-day window, USE IT to look them up.
- CRITICAL INCOME NOTE: The "this month so far" income figure is PARTIAL — it only reflects paychecks recorded so far this month, NOT full monthly income. NEVER treat a single paycheck as the user's monthly income. Always use the "average monthly net income (trailing 12 months)" figure when discussing monthly take-home pay.

GOAL MANAGEMENT:
- You have a manage_goals tool. Use it when the user wants to set financial goals, savings targets, or track progress toward any financial milestone.
- Goal types: fi (financial independence), home_purchase, savings, debt_payoff, custom.

PROFILE MANAGEMENT:
- You have a save_profile tool. Use it to save any personal or financial details the user shares.
- When the user shares info like "I'm 32" or "I make 180k", immediately save it via save_profile.

FOLLOW-UP QUESTIONS:
- You have a save_followup tool. Use it whenever you ask the user an important question they haven't answered yet.
- Do NOT save trivial or rhetorical questions.

SPENDING EVENT TRACKING:
- You have a save_spending_event tool. Use it when the user explains unusual spending.
${spendingEventsContext ? `\nKNOWN SPENDING EVENTS:\n${spendingEventsContext}\n` : ''}`;
}

// ─── Provider ───────────────────────────────────────────────────────

let anthropic: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

function loadFixture(): FinancialContext {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const path = resolve(__dirname, '../datasets/fixtures/base-financial-context.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

interface ProviderOptions {
  config?: { model?: string; temperature?: number; max_tokens?: number };
}

interface PromptfooVars {
  message?: string;
  financialContext?: string;
  model?: string;
}

export default class AdvisorProvider {
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(options?: ProviderOptions) {
    this.model = options?.config?.model || DEFAULT_MODEL;
    this.temperature = options?.config?.temperature ?? 0;
    this.maxTokens = options?.config?.max_tokens ?? 1024;
  }

  id(): string {
    return `advisor-provider:${this.model}`;
  }

  async callApi(prompt: string, context?: { vars?: PromptfooVars }): Promise<{ output: string; tokenUsage?: { total: number; prompt: number; completion: number }; cost?: number }> {
    const vars = context?.vars || {};
    const model = vars.model || this.model;

    const financialContext: FinancialContext = vars.financialContext
      ? JSON.parse(vars.financialContext)
      : loadFixture();

    const systemPrompt = buildSystemPrompt(financialContext);
    const userMessage = vars.message || prompt;
    const client = getClient();

    const conversationMessages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let fullText = '';
    const allToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: systemPrompt,
        messages: conversationMessages,
        tools: advisorTools,
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      for (const block of response.content) {
        if (block.type === 'text') fullText += block.text;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
        );

        for (const block of toolUseBlocks) {
          allToolCalls.push({ name: block.name, input: block.input as Record<string, unknown> });
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: getToolStubResult(block.name, block.input as Record<string, unknown>),
        }));

        conversationMessages.push({ role: 'assistant', content: response.content });
        conversationMessages.push({ role: 'user', content: toolResults });
      } else {
        break;
      }
    }

    const pricing: Record<string, [number, number]> = {
      'claude-sonnet-4-5-20250929': [3, 15],
      'claude-opus-4-6': [15, 75],
      'claude-haiku-4-5-20251001': [0.80, 4],
    };
    const [inPrice, outPrice] = pricing[model] ?? [3, 15];
    const cost = (totalInputTokens * inPrice + totalOutputTokens * outPrice) / 1_000_000;

    const output = JSON.stringify({
      text: fullText,
      toolCalls: allToolCalls,
      model,
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      cost,
    });

    return {
      output,
      tokenUsage: { total: totalInputTokens + totalOutputTokens, prompt: totalInputTokens, completion: totalOutputTokens },
      cost,
    };
  }
}
