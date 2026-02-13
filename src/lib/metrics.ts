import { getDb } from './db';

export function getSavingsRate(month?: string): { rate: number; income: number; expenses: number } {
  const db = getDb();
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  // Use income_records (net_pay) as the source of truth for income
  const incomeResult = db.prepare(`
    SELECT COALESCE(SUM(net_pay), 0) as total
    FROM income_records
    WHERE strftime('%Y-%m', date) = ?
  `).get(targetMonth) as { total: number };

  const expenseResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total
    FROM transactions
    WHERE type = 'expense' AND strftime('%Y-%m', date) = ?
  `).get(targetMonth) as { total: number };

  const income = incomeResult.total;
  const expenses = expenseResult.total;
  const rate = income > 0 ? ((income - expenses) / income) * 100 : 0;

  return { rate: Math.round(rate * 10) / 10, income, expenses };
}

export function getTrailingSavingsRate(months: number = 12): { rate: number; income: number; expenses: number } {
  const db = getDb();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const start = startDate.toISOString().slice(0, 10);

  // Use income_records (net_pay) as the source of truth for income
  const incomeResult = db.prepare(`
    SELECT COALESCE(SUM(net_pay), 0) as total
    FROM income_records WHERE date >= ?
  `).get(start) as { total: number };

  const expenseResult = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total
    FROM transactions WHERE type = 'expense' AND date >= ?
  `).get(start) as { total: number };

  const income = incomeResult.total;
  const expenses = expenseResult.total;
  const rate = income > 0 ? ((income - expenses) / income) * 100 : 0;

  return { rate: Math.round(rate * 10) / 10, income, expenses };
}

export function getNetWorth(): { total: number; assets: number; liabilities: number; history: Array<{ date: string; amount: number }> } {
  const db = getDb();

  // Get latest balance for each account
  const latestBalances = db.prepare(`
    SELECT b.balance, a.type, a.name
    FROM balances b
    JOIN accounts a ON a.id = b.account_id
    WHERE b.date = (SELECT MAX(b2.date) FROM balances b2 WHERE b2.account_id = b.account_id)
  `).all() as Array<{ balance: number; type: string; name: string }>;

  let assets = 0;
  let liabilities = 0;

  for (const b of latestBalances) {
    if (b.type === 'credit_card' || b.type === 'loan') {
      liabilities += Math.abs(b.balance);
    } else {
      assets += b.balance;
    }
  }

  // Get net worth history (monthly snapshots)
  const history = db.prepare(`
    SELECT strftime('%Y-%m', b.date) as date,
           SUM(CASE WHEN a.type IN ('credit_card', 'loan') THEN -ABS(b.balance) ELSE b.balance END) as amount
    FROM balances b
    JOIN accounts a ON a.id = b.account_id
    WHERE b.date = (
      SELECT MAX(b2.date) FROM balances b2
      WHERE b2.account_id = b.account_id
      AND strftime('%Y-%m', b2.date) = strftime('%Y-%m', b.date)
    )
    GROUP BY strftime('%Y-%m', b.date)
    ORDER BY date
  `).all() as Array<{ date: string; amount: number }>;

  return { total: assets - liabilities, assets, liabilities, history };
}

export function getSpendingByCategory(month?: string): Array<{ name: string; amount: number; budget: number | null; color: string }> {
  const db = getDb();
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  return db.prepare(`
    SELECT c.name, COALESCE(SUM(ABS(t.amount)), 0) as amount, c.budget_amount as budget, c.color
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND strftime('%Y-%m', t.date) = ?
      AND t.type = 'expense'
    WHERE c.name NOT IN ('Income', 'Transfer')
    GROUP BY c.id
    HAVING amount > 0
    ORDER BY amount DESC
  `).all(targetMonth) as Array<{ name: string; amount: number; budget: number | null; color: string }>;
}

export function getMonthlySpendingTrend(months: number = 6): Array<{ month: string; categories: Record<string, number>; total: number }> {
  const db = getDb();
  const results: Array<{ month: string; categories: Record<string, number>; total: number }> = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthStr = d.toISOString().slice(0, 7);

    const spending = db.prepare(`
      SELECT c.name, COALESCE(SUM(ABS(t.amount)), 0) as amount
      FROM categories c
      JOIN transactions t ON t.category_id = c.id
      WHERE strftime('%Y-%m', t.date) = ? AND t.type = 'expense'
      GROUP BY c.id
    `).all(monthStr) as Array<{ name: string; amount: number }>;

    const categories: Record<string, number> = {};
    let total = 0;
    for (const s of spending) {
      categories[s.name] = s.amount;
      total += s.amount;
    }

    results.push({ month: monthStr, categories, total });
  }

  return results;
}

export function getGoalProgress(): Array<{
  id: number; name: string; type: string; target_amount: number;
  current_amount: number; target_date: string | null; progress: number;
}> {
  const db = getDb();
  const goals = db.prepare('SELECT * FROM goals WHERE is_active = 1').all() as Array<{
    id: number; name: string; type: string; target_amount: number;
    current_amount: number; target_date: string | null;
  }>;

  return goals.map(g => ({
    ...g,
    progress: g.target_amount > 0 ? Math.min(100, (g.current_amount / g.target_amount) * 100) : 0,
  }));
}

export function getFIProjection(config: {
  currentSavings: number;
  annualExpenses: number;
  monthlySavings: number;
  expectedReturn: number;
}): { fiNumber: number; yearsToFI: number; fiDate: string } {
  const { currentSavings, annualExpenses, monthlySavings, expectedReturn } = config;
  const fiNumber = annualExpenses * 25;
  const monthlyReturn = expectedReturn / 12;

  let balance = currentSavings;
  let months = 0;
  const maxMonths = 600; // 50 years cap

  while (balance < fiNumber && months < maxMonths) {
    balance = balance * (1 + monthlyReturn) + monthlySavings;
    months++;
  }

  const fiDate = new Date();
  fiDate.setMonth(fiDate.getMonth() + months);

  return {
    fiNumber,
    yearsToFI: Math.round((months / 12) * 10) / 10,
    fiDate: fiDate.toISOString().slice(0, 10),
  };
}

export function getMonthlyIncomeExpenseTrend(months: number = 6): Array<{
  month: string;
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
}> {
  const db = getDb();
  const results: Array<{ month: string; income: number; expenses: number; savings: number; savingsRate: number }> = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const monthStr = d.toISOString().slice(0, 7);

    const incomeResult = db.prepare(`
      SELECT COALESCE(SUM(net_pay), 0) as total
      FROM income_records
      WHERE strftime('%Y-%m', date) = ?
    `).get(monthStr) as { total: number };

    const expenseResult = db.prepare(`
      SELECT COALESCE(SUM(ABS(amount)), 0) as total
      FROM transactions
      WHERE type = 'expense' AND strftime('%Y-%m', date) = ?
    `).get(monthStr) as { total: number };

    const income = incomeResult.total;
    const expenses = expenseResult.total;
    const savings = income - expenses;
    const savingsRate = income > 0 ? Math.round(((income - expenses) / income) * 1000) / 10 : 0;

    results.push({ month: monthStr, income, expenses, savings, savingsRate });
  }

  return results;
}

export function getHomeBuyingReadiness(config: {
  targetPrice: number;
  downPaymentPercent: number;
  currentSavings: number;
  monthlyIncome: number;
  monthlyDebts: number;
}): {
  downPaymentNeeded: number;
  downPaymentProgress: number;
  dti: number;
  maxMonthlyPayment: number;
  affordablePrice: number;
} {
  const { targetPrice, downPaymentPercent, currentSavings, monthlyIncome, monthlyDebts } = config;
  const downPaymentNeeded = targetPrice * (downPaymentPercent / 100);
  const downPaymentProgress = downPaymentNeeded > 0 ? (currentSavings / downPaymentNeeded) * 100 : 0;
  const dti = monthlyIncome > 0 ? (monthlyDebts / monthlyIncome) * 100 : 0;

  // Max housing payment: 28% of gross income minus existing debts (conservative)
  const maxMonthlyPayment = Math.max(0, monthlyIncome * 0.28 - monthlyDebts);

  // Rough affordability calc (30-year fixed at ~7%)
  const rate = 0.07 / 12;
  const n = 360;
  const loanAmount = maxMonthlyPayment > 0
    ? maxMonthlyPayment * ((Math.pow(1 + rate, n) - 1) / (rate * Math.pow(1 + rate, n)))
    : 0;
  const affordablePrice = loanAmount / (1 - downPaymentPercent / 100);

  return {
    downPaymentNeeded,
    downPaymentProgress: Math.round(downPaymentProgress * 10) / 10,
    dti: Math.round(dti * 10) / 10,
    maxMonthlyPayment: Math.round(maxMonthlyPayment),
    affordablePrice: Math.round(affordablePrice),
  };
}
