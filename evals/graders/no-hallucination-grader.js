// Deterministic grader: verifies that dollar amounts and percentages cited in
// the advisor's response text exist in the financial context fixture.
//
// Extracts numbers from the response and checks them against known values
// from the fixture with a 5% tolerance for rounding.
// Score = proportion of cited numbers that are grounded in context.
// Pass threshold: 80% (allows for derived/computed values).

const PASS_THRESHOLD = 0.8;
const TOLERANCE = 0.05; // 5% relative tolerance

module.exports = (output, context) => {
  try {
    const parsed = JSON.parse(output);
    const text = parsed.text || '';

    if (!text.trim()) {
      return { pass: true, score: 1, reason: 'No text output to check.' };
    }

    // Parse the financial context
    const financialContext = context.vars.financialContext
      ? JSON.parse(context.vars.financialContext)
      : {};

    // Build a set of known numeric values from the context
    const knownValues = extractKnownValues(financialContext);

    // Extract dollar amounts from the response: $X,XXX or $X,XXX.XX
    const dollarPattern = /\$[\d,]+(?:\.\d{1,2})?/g;
    const dollarMatches = [...text.matchAll(dollarPattern)].map((m) =>
      parseFloat(m[0].replace(/[$,]/g, ''))
    );

    // Extract percentages from the response: XX% or XX.X%
    const percentPattern = /(\d+(?:\.\d+)?)%/g;
    const percentMatches = [...text.matchAll(percentPattern)].map((m) => parseFloat(m[1]));

    const allCitedNumbers = [...dollarMatches, ...percentMatches];

    if (allCitedNumbers.length === 0) {
      return { pass: true, score: 1, reason: 'No numeric claims to verify.' };
    }

    // Check each cited number against known values
    let grounded = 0;
    const ungrounded = [];

    for (const cited of allCitedNumbers) {
      if (isGrounded(cited, knownValues)) {
        grounded++;
      } else {
        ungrounded.push(cited);
      }
    }

    const score = grounded / allCitedNumbers.length;
    const pass = score >= PASS_THRESHOLD;

    let reason = `${grounded}/${allCitedNumbers.length} cited numbers are grounded (${(score * 100).toFixed(0)}%).`;
    if (ungrounded.length > 0) {
      reason += ` Ungrounded: [${ungrounded.slice(0, 5).join(', ')}${ungrounded.length > 5 ? '...' : ''}]`;
    }

    return { pass, score, reason };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Grader error: ${e.message}. Output: ${String(output).slice(0, 200)}`,
    };
  }
};

function extractKnownValues(ctx) {
  const values = new Set();

  // Savings rate
  if (ctx.savingsRate) {
    values.add(ctx.savingsRate.income);
    values.add(ctx.savingsRate.expenses);
  }

  // Trailing savings rate
  if (ctx.trailingSavingsRate) {
    values.add(ctx.trailingSavingsRate.income);
    values.add(ctx.trailingSavingsRate.expenses);
    values.add(ctx.trailingSavingsRate.rate);
  }

  // Net worth
  if (ctx.netWorth) {
    values.add(ctx.netWorth.total);
    values.add(ctx.netWorth.assets);
    values.add(ctx.netWorth.liabilities);
  }

  // Average monthly income
  if (ctx.avgMonthlyIncome) values.add(ctx.avgMonthlyIncome);

  // Account balances
  if (ctx.accounts) {
    for (const a of ctx.accounts) {
      if (a.balance != null) values.add(Math.abs(a.balance));
    }
  }

  // Spending categories
  if (ctx.topSpending) {
    for (const s of ctx.topSpending) {
      values.add(s.amount);
      if (s.budget) values.add(s.budget);
    }
  }

  // Transaction amounts
  if (ctx.recentTransactions) {
    for (const t of ctx.recentTransactions) {
      values.add(Math.abs(t.amount));
    }
  }

  // Goal amounts and progress
  if (ctx.goals) {
    for (const g of ctx.goals) {
      values.add(g.current_amount);
      values.add(g.target_amount);
      values.add(g.progress);
    }
  }

  // Paycheck amounts
  if (ctx.recentPaychecks) {
    for (const p of ctx.recentPaychecks) {
      values.add(p.gross_pay);
      values.add(p.net_pay);
      if (p.federal_tax) values.add(p.federal_tax);
      if (p.state_tax) values.add(p.state_tax);
      if (p.retirement_401k) values.add(p.retirement_401k);
      if (p.health_insurance) values.add(p.health_insurance);
      if (p.hsa) values.add(p.hsa);
    }
  }

  // Trend data
  if (ctx.trend) {
    for (const t of ctx.trend) {
      values.add(t.income);
      values.add(t.expenses);
      values.add(t.savings);
      values.add(t.savingsRate);
    }
  }

  // Spending events
  if (ctx.spendingEvents) {
    for (const e of ctx.spendingEvents) {
      if (e.total_amount) values.add(e.total_amount);
    }
  }

  // Profile-derived values
  if (ctx.profile) {
    // Extract numbers from profile strings like "$145,000"
    for (const v of Object.values(ctx.profile)) {
      const nums = String(v).match(/[\d,]+(?:\.\d+)?/g);
      if (nums) {
        for (const n of nums) {
          const parsed = parseFloat(n.replace(/,/g, ''));
          if (!isNaN(parsed) && parsed > 0) values.add(parsed);
        }
      }
    }
  }

  // Also add common derived values
  if (ctx.trailingSavingsRate) {
    // Trailing savings amount
    values.add(ctx.trailingSavingsRate.income - ctx.trailingSavingsRate.expenses);
    // Monthly savings
    const months = ctx.trailingSavingsRate.monthsWithIncome || 12;
    values.add(
      Math.round((ctx.trailingSavingsRate.income - ctx.trailingSavingsRate.expenses) / months)
    );
  }

  // Total credit card debt
  if (ctx.accounts) {
    const ccDebt = ctx.accounts
      .filter((a) => a.type === 'credit_card' && a.balance < 0)
      .reduce((sum, a) => sum + Math.abs(a.balance), 0);
    if (ccDebt > 0) values.add(ccDebt);
  }

  return values;
}

function isGrounded(cited, knownValues) {
  for (const known of knownValues) {
    if (known === 0 && cited === 0) return true;
    if (known === 0) continue;
    const relDiff = Math.abs(cited - known) / Math.abs(known);
    if (relDiff <= TOLERANCE) return true;
  }
  // Also allow small round numbers that are likely general advice (e.g., 3-6 months)
  // and common financial planning constants
  if (cited <= 12) return true; // months, percentages under 12
  return false;
}
