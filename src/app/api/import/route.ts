import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { autoCategorize, getImportHash } from '@/lib/categorize';

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

          // Determine type
          let type = 'expense';
          if (mapping.type && row[mapping.type]) {
            type = row[mapping.type].toLowerCase();
          } else if (amount > 0) {
            type = 'income';
          }

          // Auto-categorize
          const categoryId = autoCategorize(description);

          // Generate import hash for deduplication
          const importHash = getImportHash(date, amount, description, accountId);

          // Check for duplicate
          const existing = checkHash.get(importHash);
          if (existing) {
            duplicates++;
            continue;
          }

          insertStmt.run(date, amount, description, categoryId, accountId, type, importHash);
          imported++;
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

function normalizeDate(dateStr: string): string | null {
  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try MM/DD/YYYY or M/D/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) {
      year = (parseInt(year) > 50 ? '19' : '20') + year;
    }
    return `${year}-${month}-${day}`;
  }

  // Try parsing with Date constructor as fallback
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}
