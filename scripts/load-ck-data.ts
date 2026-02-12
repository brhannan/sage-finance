/**
 * Load Credit Karma data extracted from screenshots.
 * Run with: npx tsx scripts/load-ck-data.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'mybudget.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const today = '2026-02-11';

function getOrCreateAccount(name: string, type: string, institution: string, lastFour?: string): number {
  const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db.prepare('INSERT INTO accounts (name, type, institution, last_four) VALUES (?, ?, ?, ?)').run(name, type, institution, lastFour || null);
  console.log(`  Created account: ${name} (${type})`);
  return result.lastInsertRowid as number;
}

function upsertBalance(accountId: number, date: string, balance: number) {
  db.prepare(`
    INSERT INTO balances (account_id, date, balance, source)
    VALUES (?, ?, ?, 'credit_karma')
    ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance
  `).run(accountId, date, balance);
}

console.log('=== Loading Credit Karma Data ===\n');

// --- Credit Scores ---
console.log('Credit Scores:');
db.prepare(`INSERT INTO credit_scores (date, score, source, score_type, details) VALUES (?, ?, ?, ?, ?)`)
  .run(today, 803, 'credit_karma', 'vantage_3', JSON.stringify({ bureau: 'TransUnion', change: '+2 pts', rating: 'Excellent' }));
db.prepare(`INSERT INTO credit_scores (date, score, source, score_type, details) VALUES (?, ?, ?, ?, ?)`)
  .run(today, 812, 'credit_karma', 'vantage_3', JSON.stringify({ bureau: 'Equifax', rating: 'Excellent' }));
console.log('  TransUnion: 803, Equifax: 812');

// --- Investment Accounts & Balances ---
console.log('\nInvestment Accounts:');
const accounts = [
  { name: 'Fidelity 401(k)', type: 'investment', institution: 'Fidelity Investments', last4: '7896', balance: 180887 },
  { name: 'TIAA Draper Lab (2212)', type: 'investment', institution: 'TIAA Retirement', last4: '2212', balance: 94947 },
  { name: 'CSDL Supplemental Retirement', type: 'investment', institution: 'TIAA Retirement', last4: '2212', balance: 91160 },
  { name: 'TIAA Draper Retirement (2214)', type: 'investment', institution: 'TIAA Retirement', last4: '2214', balance: 49603 },
  { name: 'TIAA Draper Lab (2214)', type: 'investment', institution: 'TIAA Retirement', last4: '2214', balance: 40136 },
  { name: 'TIAA Draper EE Contr', type: 'investment', institution: 'TIAA Retirement', last4: '2211', balance: 18859 },
  { name: 'HealthEquity HSA', type: 'savings', institution: 'HealthEquity', last4: null, balance: 13870 },
  { name: 'Fidelity BrokerageLink Roth', type: 'investment', institution: 'Fidelity Investments', last4: '4125', balance: 0 },
  { name: 'Fidelity BrokerageLink', type: 'investment', institution: 'Fidelity Investments', last4: '4124', balance: 0 },
  // Property
  { name: 'Vehicle / Property', type: 'other', institution: 'Manual', last4: null, balance: 35125 },
];

for (const acct of accounts) {
  const id = getOrCreateAccount(acct.name, acct.type, acct.institution, acct.last4 ?? undefined);
  upsertBalance(id, today, acct.balance);
  console.log(`  ${acct.name}: $${acct.balance.toLocaleString()}`);
}

// Also update balances for existing Schwab accounts
const schwabAccounts = [
  { name: 'Schwab Roth IRA', balance: 24132 },
  { name: 'Schwab Individual Brokerage', balance: 11017 },
  { name: 'Schwab HSA Brokerage', balance: 11017 }, // same as Individual per CK
];

for (const acct of schwabAccounts) {
  const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(acct.name) as { id: number } | undefined;
  if (existing) {
    upsertBalance(existing.id, today, acct.balance);
    console.log(`  ${acct.name}: $${acct.balance.toLocaleString()} (updated)`);
  }
}

// --- Cash accounts ---
console.log('\nCash Accounts:');
const cashId = getOrCreateAccount('Cash (All Banks)', 'checking', 'Various');
upsertBalance(cashId, today, 7188);
console.log('  Cash total: $7,188');

// --- Debts ---
console.log('\nDebts:');
const ccDebtId = getOrCreateAccount('Credit Card Balances', 'credit_card', 'Various');
upsertBalance(ccDebtId, today, 1260);
console.log('  Credit cards: $1,260');

const loanId = getOrCreateAccount('Loan', 'loan', 'From Credit Report');
upsertBalance(loanId, today, 1092);
console.log('  Loans: $1,092');

// --- Summary ---
const totalAssets = db.prepare(`
  SELECT COALESCE(SUM(b.balance), 0) as total
  FROM balances b JOIN accounts a ON a.id = b.account_id
  WHERE a.type NOT IN ('credit_card', 'loan')
  AND b.date = (SELECT MAX(b2.date) FROM balances b2 WHERE b2.account_id = b.account_id)
`).get() as { total: number };

const totalLiabilities = db.prepare(`
  SELECT COALESCE(SUM(ABS(b.balance)), 0) as total
  FROM balances b JOIN accounts a ON a.id = b.account_id
  WHERE a.type IN ('credit_card', 'loan')
  AND b.date = (SELECT MAX(b2.date) FROM balances b2 WHERE b2.account_id = b.account_id)
`).get() as { total: number };

console.log(`\n=== Summary ===`);
console.log(`Assets: $${totalAssets.total.toLocaleString()}`);
console.log(`Liabilities: $${totalLiabilities.total.toLocaleString()}`);
console.log(`Net Worth: $${(totalAssets.total - totalLiabilities.total).toLocaleString()}`);

db.close();
