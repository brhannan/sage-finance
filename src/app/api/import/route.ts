import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { autoCategorize, getImportHash, normalizeDate } from '@/lib/categorize';

interface ColumnMapping {
  date: string;
  amount: string;
  description: string;
  category?: string;
  type?: string;
  debit?: string;
  credit?: string;
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { rows, mapping, accountId } = body as {
      rows: Record<string, string>[];
      mapping: ColumnMapping;
      accountId: number;
      institutionName?: string;
    };

    if (!rows || !mapping || !accountId) {
      return NextResponse.json(
        { error: 'rows, mapping, and accountId are required' },
        { status: 400 }
      );
    }

    if (!mapping.date || !mapping.description || (!mapping.amount && !mapping.debit)) {
      return NextResponse.json(
        { error: 'mapping must include date, description, and amount (or debit/credit) columns' },
        { status: 400 }
      );
    }

    const insertStmt = db.prepare(`
      INSERT INTO transactions (date, amount, description, category_id, account_id, type, import_hash, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'import')
    `);

    const checkHash = db.prepare('SELECT id FROM transactions WHERE import_hash = ?');
    const checkDateAmount = db.prepare(
      'SELECT id FROM transactions WHERE date = ? AND amount = ? AND account_id = ?'
    );

    const checkIncomeRecord = db.prepare(
      'SELECT id FROM income_records WHERE date = ? AND ABS(net_pay - ?) < 0.01'
    );
    const insertIncomeRecord = db.prepare(`
      INSERT INTO income_records (date, gross_pay, net_pay, employer, source)
      VALUES (?, ?, ?, ?, 'import')
    `);

    let imported = 0;
    let duplicates = 0;
    const errors: string[] = [];

    const insertMany = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const dateRaw = row[mapping.date]?.trim();
          const description = row[mapping.description]?.trim();

          if (!dateRaw || !description) {
            errors.push(`Row ${i + 1}: missing date or description`);
            continue;
          }

          // Parse amount
          let amount: number;
          if (mapping.debit && mapping.credit) {
            const debit = parseFloat(row[mapping.debit]?.replace(/[,$]/g, '') || '0');
            const credit = parseFloat(row[mapping.credit]?.replace(/[,$]/g, '') || '0');
            amount = credit > 0 ? credit : -Math.abs(debit);
          } else {
            const raw = row[mapping.amount]?.replace(/[,$]/g, '') || '';
            amount = parseFloat(raw);
          }

          if (isNaN(amount)) {
            errors.push(`Row ${i + 1}: invalid amount`);
            continue;
          }

          // Normalize date to YYYY-MM-DD
          const date = normalizeDate(dateRaw);
          if (!date) {
            errors.push(`Row ${i + 1}: could not parse date "${dateRaw}"`);
            continue;
          }

          // Auto-categorize
          const categoryId = autoCategorize(description);
          const catName = categoryId
            ? (db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string } | undefined)?.name
            : undefined;

          // Determine type — Transfer category overrides amount-based detection
          let type = 'expense';
          if (catName === 'Transfer') {
            type = 'transfer';
          } else if (mapping.type && row[mapping.type]) {
            type = row[mapping.type].toLowerCase();
          } else if (amount > 0) {
            type = 'income';
          }

          // Generate import hash for deduplication
          const importHash = getImportHash(date, amount, description, accountId);

          // Check for duplicate (hash match)
          const existing = checkHash.get(importHash);
          if (existing) {
            duplicates++;
            continue;
          }

          // Secondary dedup: same date + amount + account (catches cross-format duplicates)
          const existingByDateAmount = checkDateAmount.get(date, amount, accountId);
          if (existingByDateAmount) {
            duplicates++;
            continue;
          }

          insertStmt.run(date, amount, description, categoryId, accountId, type, importHash);
          imported++;

          // Auto-create income_records entry for paycheck/salary transactions
          if (catName === 'Income' && amount > 0) {
            const existingIncome = checkIncomeRecord.get(date, amount);
            if (!existingIncome) {
              insertIncomeRecord.run(date, amount, amount, description);
            }
          }
        } catch (err) {
          errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'unknown error'}`);
        }
      }
    });

    insertMany();

    return NextResponse.json({ imported, duplicates, errors });
  } catch (error) {
    console.error('POST /api/import error:', error);
    return NextResponse.json({ error: 'Failed to import transactions' }, { status: 500 });
  }
}

