/**
 * Bulk import script for credit card and bank statements.
 * Run with: npx tsx scripts/bulk-import.ts
 */

import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const DB_PATH = path.join(process.cwd(), 'data', 'sage-finance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Helpers ---

function getOrCreateAccount(name: string, type: string, institution: string): number {
  const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db.prepare('INSERT INTO accounts (name, type, institution) VALUES (?, ?, ?)').run(name, type, institution);
  console.log(`  Created account: ${name} (${type}) [id=${result.lastInsertRowid}]`);
  return result.lastInsertRowid as number;
}

function importHash(date: string, amount: number, description: string, accountId: number): string {
  const data = `${date}|${amount}|${description}|${accountId}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

function autoCategorize(description: string): number | null {
  const categories = db.prepare("SELECT id, name, keywords FROM categories WHERE keywords IS NOT NULL AND keywords != ''").all() as Array<{ id: number; name: string; keywords: string }>;
  const descLower = description.toLowerCase();
  for (const cat of categories) {
    const keywords = cat.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    for (const kw of keywords) {
      if (descLower.includes(kw)) return cat.id;
    }
  }
  return null;
}

function normalizeDate(dateStr: string): string {
  // Handle "MM/DD/YYYY" format
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`;
  }
  // Handle "YYYY-MM-DD" already
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  return dateStr;
}

// --- Credit Card Import (Amex-style CSV) ---

function importCreditCard(filePath: string, accountName: string) {
  console.log(`\nImporting credit card: ${filePath}`);
  const accountId = getOrCreateAccount(accountName, 'credit_card', 'American Express');

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions (date, amount, description, category_id, account_id, type, import_hash, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'csv_import')
  `);

  let imported = 0, dupes = 0;

  const importAll = db.transaction(() => {
    for (const row of parsed.data as Record<string, string>[]) {
      const dateRaw = row['Date'];
      const description = row['Description'];
      const amountRaw = row['Amount'];

      if (!dateRaw || !description || !amountRaw) continue;

      const date = normalizeDate(dateRaw.trim());
      const amount = parseFloat(amountRaw.replace(/[,$]/g, ''));
      if (isNaN(amount)) continue;

      // Amex: positive = charge, negative = credit/payment
      const type = amount < 0 ? 'income' : 'expense';
      const absAmount = Math.abs(amount);
      const categoryId = autoCategorize(description);
      const hash = importHash(date, absAmount, description, accountId);

      const result = insert.run(date, type === 'expense' ? -absAmount : absAmount, description, categoryId, accountId, type, hash);
      if (result.changes > 0) imported++;
      else dupes++;
    }
  });

  importAll();
  console.log(`  Imported: ${imported}, Duplicates: ${dupes}`);
}

// --- Schwab Investment/HSA Import ---

function importSchwab(filePath: string, accountName: string, accountType: string) {
  console.log(`\nImporting Schwab: ${filePath}`);
  const accountId = getOrCreateAccount(accountName, accountType, 'Charles Schwab');

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions (date, amount, description, category_id, account_id, type, notes, import_hash, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'csv_import')
  `);

  let imported = 0, dupes = 0;

  const importAll = db.transaction(() => {
    for (const row of parsed.data as Record<string, string>[]) {
      const dateRaw = row['Date'];
      const action = row['Action'] || '';
      const symbol = row['Symbol'] || '';
      const description = row['Description'] || '';
      const amountRaw = row['Amount'];

      if (!dateRaw) continue;

      // Clean date: "01/16/2026 as of 01/15/2026" -> take first date
      const dateClean = dateRaw.trim().split(' ')[0];
      const date = normalizeDate(dateClean);

      // Parse amount (may have $ and commas, may be empty)
      if (!amountRaw || amountRaw.trim() === '') continue;
      const amount = parseFloat(amountRaw.replace(/[,$]/g, ''));
      if (isNaN(amount)) continue;

      const fullDesc = [action, symbol, description].filter(Boolean).join(' - ').trim();
      const type = amount >= 0 ? 'income' : 'expense';
      const notes = `${action}${symbol ? ` ${symbol}` : ''}`;
      const hash = importHash(date, Math.abs(amount), fullDesc, accountId);

      const result = insert.run(date, amount, fullDesc, null, accountId, type, notes, hash);
      if (result.changes > 0) imported++;
      else dupes++;
    }
  });

  importAll();
  console.log(`  Imported: ${imported}, Duplicates: ${dupes}`);
}

// --- Run all imports ---

console.log('=== Bulk Import ===\n');

// Credit cards
importCreditCard('/Users/bhannan/Downloads/cc-statements/activity.csv', 'Amex Card 1');
importCreditCard('/Users/bhannan/Downloads/cc-statements/activity-2.csv', 'Amex Card 2');

// Schwab accounts
importSchwab('/Users/bhannan/Downloads/bank-statements/HSA_Brokerage_XXX789_Transactions_20260211-194235.csv', 'Schwab HSA Brokerage', 'investment');
importSchwab('/Users/bhannan/Downloads/bank-statements/Individual_XXX329_Transactions_20260211-194225.csv', 'Schwab Individual Brokerage', 'investment');
importSchwab('/Users/bhannan/Downloads/bank-statements/Roth_Contributory_IRA_XXX285_Transactions_20260211-194230.csv', 'Schwab Roth IRA', 'investment');

// Summary
const totalTx = (db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number }).c;
const totalAccounts = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }).c;
console.log(`\n=== Done ===`);
console.log(`Total transactions: ${totalTx}`);
console.log(`Total accounts: ${totalAccounts}`);

db.close();
