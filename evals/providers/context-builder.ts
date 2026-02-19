// Builds the advisor system prompt from a financial context fixture.
// Mirrors the format in src/app/api/advisor/route.ts (lines 212-283).

export interface FinancialContext {
  profile: Record<string, string>;
  savingsRate: { income: number; expenses: number };
  trailingSavingsRate: {
    income: number;
    expenses: number;
    rate: number;
    monthsWithIncome: number;
  };
  netWorth: { total: number; assets: number; liabilities: number };
  avgMonthlyIncome: number;
  accounts: Array<{
    id: number;
    name: string;
    type: string;
    institution?: string;
    balance: number | null;
  }>;
  topSpending: Array<{
    name: string;
    amount: number;
    budget?: number;
  }>;
  recentTransactions: Array<{
    date: string;
    amount: number;
    description: string;
    category: string;
    account: string;
  }>;
  goals: Array<{
    name: string;
    type: string;
    current_amount: number;
    target_amount: number;
    progress: number;
    account_id?: number | null;
  }>;
  recentPaychecks: Array<{
    date: string;
    gross_pay: number;
    net_pay: number;
    employer?: string;
    pay_period_start?: string;
    pay_period_end?: string;
    federal_tax?: number;
    state_tax?: number;
    social_security?: number;
    medicare?: number;
    retirement_401k?: number;
    health_insurance?: number;
    dental_insurance?: number;
    vision_insurance?: number;
    hsa?: number;
    other_deductions?: number;
    other_deductions_detail?: string;
  }>;
  trend: Array<{
    month: string;
    income: number;
    expenses: number;
    savings: number;
    savingsRate: number;
  }>;
  spendingEvents?: Array<{
    name: string;
    category: string;
    description?: string;
    date_start?: string;
    date_end?: string;
    total_amount?: number;
  }>;
}

export function buildSystemPrompt(ctx: FinancialContext): string {
  const profileContext = Object.entries(ctx.profile)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const incomeMonths = ctx.trailingSavingsRate.monthsWithIncome || 1;

  const paycheckContext = ctx.recentPaychecks
    .map((p) => {
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
      const period =
        p.pay_period_start && p.pay_period_end
          ? ` (${p.pay_period_start} to ${p.pay_period_end})`
          : '';
      const emp = p.employer ? ` [${p.employer}]` : '';
      return `  ${p.date}${period}${emp}: gross $${p.gross_pay.toFixed(2)} → net $${p.net_pay.toFixed(2)}${deductions.length > 0 ? `\n    Deductions: ${deductions.join(', ')}` : ''}`;
    })
    .join('\n');

  const trendContext = ctx.trend
    .map(
      (t) =>
        `  ${t.month}: income=$${t.income.toLocaleString()}, expenses=$${t.expenses.toLocaleString()}, savings=$${t.savings.toLocaleString()} (${t.savingsRate}%)`
    )
    .join('\n');

  const topSpending = ctx.topSpending
    .slice(0, 10)
    .map(
      (s) =>
        `  ${s.name}: $${s.amount.toFixed(2)}${s.budget ? ` (budget: $${s.budget.toFixed(2)})` : ''}`
    )
    .join('\n');

  const recentTxnContext = ctx.recentTransactions
    .map(
      (t) =>
        `  ${t.date} | $${Math.abs(t.amount).toFixed(2)} | ${t.description.slice(0, 40)} | ${t.category} | ${t.account}`
    )
    .join('\n');

  const goalsContext = ctx.goals
    .map((g) => {
      const acct = g.account_id
        ? ctx.accounts.find((a) => a.id === g.account_id)
        : null;
      const acctLabel = acct ? ` [tracking: ${acct.name}]` : '';
      return `  ${g.name} (${g.type}): $${g.current_amount.toLocaleString()} / $${g.target_amount.toLocaleString()} (${g.progress.toFixed(1)}%)${acctLabel}`;
    })
    .join('\n');

  const accountsContext = ctx.accounts
    .map((a) => {
      const bal = a.balance != null ? `$${a.balance.toLocaleString()}` : 'no balance';
      const inst = a.institution ? ` (${a.institution})` : '';
      return `  [${a.type}] ${a.name}${inst}: ${bal}`;
    })
    .join('\n');

  const spendingEventsContext =
    ctx.spendingEvents && ctx.spendingEvents.length > 0
      ? ctx.spendingEvents
          .map(
            (e) =>
              `  - "${e.name}" (${e.category || '?'}, ${e.date_start || '?'}–${e.date_end || '?'}, $${e.total_amount?.toFixed(2) || '?'}): ${e.description || 'no description'}`
          )
          .join('\n')
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
${spendingEventsContext ? `\nKNOWN SPENDING EVENTS (reference these naturally when discussing the user's spending history):\n${spendingEventsContext}\n` : ''}`;
}
