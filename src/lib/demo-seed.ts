import Database from 'better-sqlite3';
import crypto from 'crypto';

// Seeded PRNG (mulberry32) for deterministic "random" data
function createRng(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randBetween(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function seedDemoData(db: Database.Database) {
  // Idempotent guard
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM accounts').get() as { cnt: number };
  if (existing.cnt > 0) return;

  const rng = createRng(42);

  // ── Accounts ──
  const accounts = [
    { name: 'Chase Checking', type: 'checking', institution: 'Chase', last_four: '4821' },
    { name: 'Marcus Savings', type: 'savings', institution: 'Goldman Sachs', last_four: '7733' },
    { name: 'Chase Sapphire Reserve', type: 'credit_card', institution: 'Chase', last_four: '9102' },
    { name: 'Amex Gold', type: 'credit_card', institution: 'American Express', last_four: '3056' },
    { name: '401(k)', type: 'investment', institution: 'Fidelity', last_four: '6640' },
    { name: 'Roth IRA', type: 'investment', institution: 'Vanguard', last_four: '2218' },
    { name: 'Brokerage', type: 'investment', institution: 'Fidelity', last_four: '5501' },
    { name: 'HSA', type: 'other', institution: 'Optum', last_four: '1189' },
  ];

  const insertAccount = db.prepare(
    'INSERT INTO accounts (name, type, institution, last_four) VALUES (?, ?, ?, ?)'
  );
  const accountIds: number[] = [];
  for (const a of accounts) {
    const info = insertAccount.run(a.name, a.type, a.institution, a.last_four);
    accountIds.push(Number(info.lastInsertRowid));
  }

  const [checkingId, savingsId, chaseCardId, amexCardId, k401Id, rothId, brokId, hsaId] = accountIds;

  // ── Category lookup ──
  const categories = db.prepare('SELECT id, name FROM categories').all() as Array<{ id: number; name: string }>;
  const catMap: Record<string, number> = {};
  for (const c of categories) catMap[c.name] = c.id;

  // ── Balance Snapshots (12 months: Mar 2025 – Feb 2026) ──
  const insertBalance = db.prepare(
    'INSERT INTO balances (account_id, date, balance) VALUES (?, ?, ?)'
  );

  // Starting balances (Mar 2025) and monthly growth patterns
  const balanceSeeds: Record<number, { start: number; monthlyDelta: (m: number, rng: () => number) => number }> = {
    [checkingId]:  { start: 5200, monthlyDelta: (m, r) => randBetween(r, -300, 600) },
    [savingsId]:   { start: 18500, monthlyDelta: (m, r) => randBetween(r, 400, 1200) },
    [chaseCardId]: { start: -1800, monthlyDelta: (m, r) => randBetween(r, -400, 400) },
    [amexCardId]:  { start: -950, monthlyDelta: (m, r) => randBetween(r, -300, 300) },
    [k401Id]:      { start: 62000, monthlyDelta: (m, r) => randBetween(r, 800, 2200) },
    [rothId]:      { start: 34500, monthlyDelta: (m, r) => randBetween(r, 300, 1100) },
    [brokId]:      { start: 12800, monthlyDelta: (m, r) => randBetween(r, -200, 800) },
    [hsaId]:       { start: 4100, monthlyDelta: (m, r) => randBetween(r, 150, 350) },
  };

  for (const accId of accountIds) {
    let bal = balanceSeeds[accId].start;
    for (let mi = 0; mi < 12; mi++) {
      const year = mi < 10 ? 2025 : 2026;
      const day = 28; // end of month snapshot
      const actualMonth = mi < 10 ? 3 + mi : mi - 9; // 3..12 then 1,2
      insertBalance.run(accId, dateStr(year, actualMonth, day), round2(bal));
      bal += balanceSeeds[accId].monthlyDelta(mi, rng);
    }
  }

  // ── Transactions (~200 across 12 months) ──
  const insertTxn = db.prepare(
    `INSERT INTO transactions (date, amount, description, category_id, account_id, type, import_hash, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'demo')`
  );

  const recurringExpenses = [
    { desc: 'Rent Payment', amount: 1850, cat: 'Housing', account: checkingId, day: 1 },
    { desc: 'Xcel Energy', amount: [65, 120], cat: 'Utilities', account: checkingId, day: 5 },
    { desc: 'Comcast Internet', amount: 79.99, cat: 'Utilities', account: checkingId, day: 8 },
    { desc: 'T-Mobile', amount: 85, cat: 'Utilities', account: checkingId, day: 12 },
    { desc: 'GEICO Auto Insurance', amount: 142, cat: 'Insurance', account: checkingId, day: 15 },
    { desc: 'Netflix', amount: 15.49, cat: 'Subscriptions', account: chaseCardId, day: 3 },
    { desc: 'Spotify Premium', amount: 10.99, cat: 'Subscriptions', account: chaseCardId, day: 7 },
    { desc: 'Colorado Athletic Club', amount: 59, cat: 'Personal Care', account: chaseCardId, day: 1 },
  ];

  const variableExpenses = [
    { descs: ['King Soopers', 'Whole Foods Market', 'Trader Joe\'s', 'Sprouts'], cat: 'Groceries', range: [45, 135], account: chaseCardId },
    { descs: ['Chipotle', 'Starbucks', 'Illegal Pete\'s', 'Snooze Eatery', 'True Food Kitchen', 'DoorDash'], cat: 'Dining', range: [12, 65], account: amexCardId },
    { descs: ['Shell Gas Station', 'RTD Transit', 'Denver Parking'], cat: 'Transportation', range: [25, 70], account: checkingId },
    { descs: ['Amazon.com', 'Target', 'REI Co-op', 'Best Buy'], cat: 'Shopping', range: [20, 150], account: amexCardId },
    { descs: ['AMC Theatres', 'Meow Wolf Denver', 'Red Rocks Tickets'], cat: 'Entertainment', range: [15, 85], account: chaseCardId },
    { descs: ['UCHealth Copay', 'CVS Pharmacy', 'Kaiser Permanente'], cat: 'Healthcare', range: [20, 75], account: checkingId },
    { descs: ['Great Clips', 'Ulta Beauty'], cat: 'Personal Care', range: [25, 55], account: chaseCardId },
  ];

  let txnSeq = 0;
  for (let mi = 0; mi < 12; mi++) {
    const year = mi < 10 ? 2025 : 2026;
    const month = mi < 10 ? 3 + mi : mi - 9;

    // Recurring expenses
    for (const r of recurringExpenses) {
      const amt = Array.isArray(r.amount) ? round2(randBetween(rng, r.amount[0], r.amount[1])) : r.amount;
      const hash = crypto.createHash('sha256').update(`demo-${txnSeq++}`).digest('hex');
      insertTxn.run(dateStr(year, month, r.day), -amt, r.desc, catMap[r.cat], r.account, 'expense', hash);
    }

    // Variable expenses (3-5 grocery trips, 3-4 dining, 1-2 of each other)
    const variableCounts = [
      Math.floor(randBetween(rng, 3, 6)),  // groceries
      Math.floor(randBetween(rng, 3, 5)),  // dining
      Math.floor(randBetween(rng, 1, 3)),  // transportation
      Math.floor(randBetween(rng, 1, 3)),  // shopping
      Math.floor(randBetween(rng, 0, 2)),  // entertainment
      Math.floor(randBetween(rng, 0, 2)),  // healthcare
      Math.floor(randBetween(rng, 0, 2)),  // personal care
    ];

    variableExpenses.forEach((ve, vi) => {
      const count = variableCounts[vi];
      for (let j = 0; j < count; j++) {
        const day = Math.min(28, Math.floor(randBetween(rng, 1, 29)));
        const amt = round2(randBetween(rng, ve.range[0], ve.range[1]));
        const desc = pick(rng, ve.descs);
        const hash = crypto.createHash('sha256').update(`demo-${txnSeq++}`).digest('hex');
        insertTxn.run(dateStr(year, month, day), -amt, desc, catMap[ve.cat], ve.account, 'expense', hash);
      }
    });

    // Seasonal extras
    // Holiday spending (Nov, Dec = mi=8,9)
    if (mi === 8 || mi === 9) {
      const giftCount = mi === 9 ? 4 : 2;
      for (let g = 0; g < giftCount; g++) {
        const day = Math.floor(randBetween(rng, 5, 26));
        const amt = round2(randBetween(rng, 30, 200));
        const desc = pick(rng, ['Amazon.com Gift', 'Nordstrom', 'Apple Store', 'Etsy Purchase']);
        const hash = crypto.createHash('sha256').update(`demo-${txnSeq++}`).digest('hex');
        insertTxn.run(dateStr(year, month, day), -amt, desc, catMap['Gifts & Donations'], amexCardId, 'expense', hash);
      }
    }

    // Summer travel (Jun, Jul = mi=3,4)
    if (mi === 3 || mi === 4) {
      const travelItems = mi === 3
        ? [['United Airlines', 380], ['Airbnb - Moab UT', 450]] as const
        : [['National Park Pass', 80], ['Mountain Lodge', 220]] as const;
      for (const [desc, amt] of travelItems) {
        const day = Math.floor(randBetween(rng, 10, 25));
        const hash = crypto.createHash('sha256').update(`demo-${txnSeq++}`).digest('hex');
        insertTxn.run(dateStr(year, month, day), -amt, desc, catMap['Travel'], chaseCardId, 'expense', hash);
      }
    }
  }

  // ── Income Records (bimonthly paychecks) ──
  const insertIncome = db.prepare(
    `INSERT INTO income_records (date, pay_period_start, pay_period_end, gross_pay, net_pay,
     federal_tax, state_tax, social_security, medicare, retirement_401k,
     health_insurance, dental_insurance, vision_insurance, hsa, employer, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')`
  );

  const grossPerPaycheck = round2(145000 / 24); // ~6041.67
  for (let mi = 0; mi < 12; mi++) {
    const year = mi < 10 ? 2025 : 2026;
    const month = mi < 10 ? 3 + mi : mi - 9;

    for (const payDay of [15, 28]) {
      const d = dateStr(year, month, payDay);
      const periodStart = payDay === 15 ? dateStr(year, month, 1) : dateStr(year, month, 16);
      const periodEnd = payDay === 15 ? dateStr(year, month, 15) : dateStr(year, month, Math.min(28, 30));

      const federalTax = round2(grossPerPaycheck * 0.22);
      const stateTax = round2(grossPerPaycheck * 0.0455);
      const socialSecurity = round2(grossPerPaycheck * 0.062);
      const medicare = round2(grossPerPaycheck * 0.0145);
      const retirement = round2(grossPerPaycheck * 0.10); // 10% 401k contribution
      const health = 185;
      const dental = 24;
      const vision = 8;
      const hsa = 125;

      const totalDeductions = federalTax + stateTax + socialSecurity + medicare + retirement + health + dental + vision + hsa;
      const netPay = round2(grossPerPaycheck - totalDeductions);

      insertIncome.run(d, periodStart, periodEnd, grossPerPaycheck, netPay,
        federalTax, stateTax, socialSecurity, medicare, retirement,
        health, dental, vision, hsa, 'TechCorp Inc.', 'demo');

      // Also add income transaction to checking
      const hash = crypto.createHash('sha256').update(`demo-income-${txnSeq++}`).digest('hex');
      insertTxn.run(d, netPay, 'TechCorp Inc. Direct Deposit', catMap['Income'], checkingId, 'income', hash);
    }
  }

  // ── Goals ──
  const insertGoal = db.prepare(
    `INSERT INTO goals (name, type, target_amount, current_amount, target_date, description, config)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertGoal.run(
    'Emergency Fund', 'savings', 25000, 18500,
    '2025-12-31', '6 months of expenses',
    JSON.stringify({ monthlyContribution: 800 })
  );
  insertGoal.run(
    'House Down Payment', 'home_purchase', 100000, 31300,
    '2028-06-01', '20% down on $500K home in Denver metro',
    JSON.stringify({ monthlyContribution: 1500, targetHomePrice: 500000 })
  );
  insertGoal.run(
    'Coast FI', 'fi', 250000, 109300,
    '2030-01-01', 'Enough invested to coast to retirement at 60',
    JSON.stringify({ targetAge: 60, expectedReturn: 0.07, annualExpenses: 55000 })
  );

  // ── Credit Scores (12 months, 748 → 762 with noise) ──
  const insertScore = db.prepare(
    'INSERT INTO credit_scores (date, score, source, score_type) VALUES (?, ?, ?, ?)'
  );

  let creditScore = 748;
  for (let mi = 0; mi < 12; mi++) {
    const year = mi < 10 ? 2025 : 2026;
    const month = mi < 10 ? 3 + mi : mi - 9;
    const noise = Math.floor(randBetween(rng, -3, 5));
    const trend = mi < 8 ? 1.5 : 1; // slightly faster growth early
    creditScore = Math.min(780, Math.max(740, Math.round(creditScore + trend + noise)));
    insertScore.run(dateStr(year, month, 1), creditScore, 'credit_karma', 'vantage_3');
  }

  // ── Advisor Profile ──
  const insertProfile = db.prepare(
    'INSERT OR REPLACE INTO advisor_profile (key, value) VALUES (?, ?)'
  );

  const profileEntries: [string, string][] = [
    ['name', 'Alex Chen'],
    ['age', '32'],
    ['occupation', 'Senior Software Engineer'],
    ['location', 'Denver, CO'],
    ['filing_status', 'Single'],
    ['risk_tolerance', 'Moderate-Aggressive'],
    ['annual_income', '145000'],
    ['financial_goals', 'Build emergency fund, save for house, reach Coast FI'],
    ['notes', 'Has employer 401k match up to 6%. Interested in index fund investing. Enjoys outdoor recreation and travel.'],
  ];
  for (const [key, value] of profileEntries) {
    insertProfile.run(key, value);
  }

  // ── Action Items ──
  const insertAction = db.prepare(
    `INSERT INTO action_items (title, description, status, source, completed_at)
     VALUES (?, ?, ?, 'advisor', ?)`
  );

  insertAction.run(
    'Increase 401k contribution to capture full employer match',
    'Currently contributing 10% but employer matches up to 6%. Consider increasing to maximize free money.',
    'completed', '2025-05-15'
  );
  insertAction.run(
    'Open high-yield savings for house down payment',
    'Move house savings to a dedicated HYSA earning 4.5%+ APY to accelerate the goal.',
    'pending', null
  );
  insertAction.run(
    'Review and rebalance brokerage portfolio',
    'Brokerage account hasn\'t been rebalanced in 8 months. Check asset allocation against target.',
    'pending', null
  );
}
