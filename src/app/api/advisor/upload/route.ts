import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import Papa from 'papaparse';
import { getDb } from '@/lib/db';
import { autoCategorize, getImportHash, normalizeDate } from '@/lib/categorize';

const anthropic = new Anthropic();

interface ColumnMapping {
  institution: string;
  account_name: string;
  account_type: 'checking' | 'savings' | 'credit_card' | 'investment';
  mapping: {
    date: string;
    amount: string;
    description: string;
  };
  amount_convention: 'negative_expenses' | 'positive_expenses';
}

interface ExtractedTransaction {
  date: string;
  amount: number;
  description: string;
}

interface PdfExtraction {
  institution: string;
  account_name: string;
  account_type: 'checking' | 'savings' | 'credit_card' | 'investment';
  transactions: ExtractedTransaction[];
}

const ALLOWED_MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { file, fileName, message, model, fileType } = body as {
      file: string;
      fileName: string;
      message: string;
      model?: string;
      fileType?: 'csv' | 'pdf';
    };

    if (!file || !fileName) {
      return NextResponse.json(
        { error: 'file and fileName are required' },
        { status: 400 }
      );
    }

    const selectedModel = ALLOWED_MODELS.includes(model ?? '') ? model! : 'claude-sonnet-4-5-20250929';
    const isPdf = fileType === 'pdf' || fileName.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      return handlePdf(file, fileName, message, selectedModel);
    } else {
      return handleCsv(file, fileName, message, selectedModel);
    }
  } catch (error) {
    console.error('POST /api/advisor/upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process file upload' },
      { status: 500 }
    );
  }
}

async function handlePdf(base64Data: string, fileName: string, message: string, selectedModel: string) {
  const db = getDb();

  // Strip data URL prefix if present
  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

  // Ask Claude to extract transactions from the PDF statement
  const extractionResponse = await anthropic.messages.create({
    model: selectedModel,
    max_tokens: 16384,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: cleanBase64,
          },
        },
        {
          type: 'text',
          text: `Extract all transactions from this bank/credit card statement PDF.

Return ONLY valid JSON with this exact structure, no other text:
{
  "institution": "bank name (e.g. Chase, Amex, Bank of America)",
  "account_name": "descriptive account name (e.g. Chase Sapphire Preferred)",
  "account_type": "checking|savings|credit_card|investment",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "amount": -12.34,
      "description": "merchant or transaction description"
    }
  ]
}

Rules:
- Expenses/charges should be NEGATIVE amounts
- Payments/credits should be POSITIVE amounts
- Use YYYY-MM-DD date format
- Include ALL transactions listed on the statement
- Do NOT include balance summaries, interest calculations, or fee line items that aren't actual transactions
- The description should be the merchant name or transaction description as shown

File name: ${fileName}
User context: ${message || 'Import this statement'}`,
        },
      ],
    }],
  });

  const extractionText = extractionResponse.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  let extraction: PdfExtraction;
  try {
    const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[pdf] No JSON found in extraction response for ${fileName}. Raw response:`, extractionText.slice(0, 500));
      throw new Error('No JSON found');
    }
    extraction = JSON.parse(jsonMatch[0]);
    console.log(`[pdf] Extracted from ${fileName}: ${extraction.institution}, ${extraction.account_type}, ${extraction.transactions?.length ?? 0} transactions`);
    if (extraction.transactions?.length > 0) {
      console.log('[pdf] Sample extracted transactions:', JSON.stringify(extraction.transactions.slice(0, 3)));
    }
  } catch (err) {
    console.error(`[pdf] Failed to parse extraction for ${fileName}:`, err);
    return NextResponse.json(
      { error: 'Could not extract transactions from this PDF. The statement format may not be supported.' },
      { status: 422 }
    );
  }

  if (!extraction.transactions || extraction.transactions.length === 0) {
    return NextResponse.json(
      { error: 'No transactions found in this PDF statement.' },
      { status: 422 }
    );
  }

  // Find or create account
  let account = db.prepare(
    `SELECT id, name FROM accounts WHERE institution = ? AND type = ? AND is_active = 1 LIMIT 1`
  ).get(extraction.institution, extraction.account_type) as { id: number; name: string } | undefined;

  if (!account) {
    const result = db.prepare(
      `INSERT INTO accounts (name, type, institution) VALUES (?, ?, ?)`
    ).run(extraction.account_name, extraction.account_type, extraction.institution);
    account = { id: Number(result.lastInsertRowid), name: extraction.account_name };
  }

  const accountId = account.id;

  // Import transactions
  const { imported, duplicates, errors, categoryCounts } = importRows(
    db, extraction.transactions, accountId
  );

  // Generate summary
  const { content: summaryContent, usage: summaryUsage } = await generateSummary(
    selectedModel, fileName, account.name, extraction.institution,
    extraction.account_type, imported, duplicates, errors, categoryCounts, message
  );

  saveConversation(db, fileName, message, summaryContent);

  const totalInput = extractionResponse.usage.input_tokens + summaryUsage.input;
  const totalOutput = extractionResponse.usage.output_tokens + summaryUsage.output;
  const cost = calculateCost(selectedModel, totalInput, totalOutput);

  return NextResponse.json({
    role: 'assistant',
    content: summaryContent,
    imported,
    duplicates,
    errors: errors.length,
    model: selectedModel,
    usage: { input_tokens: totalInput, output_tokens: totalOutput },
    cost,
  });
}

async function handleCsv(fileText: string, fileName: string, message: string, selectedModel: string) {
  const db = getDb();

  // Parse CSV
  const parsed = Papa.parse(fileText, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return NextResponse.json(
      { error: `CSV parse error: ${parsed.errors[0].message}` },
      { status: 400 }
    );
  }

  const rows = parsed.data as Record<string, string>[];
  const headers = parsed.meta.fields ?? [];

  if (rows.length === 0 || headers.length === 0) {
    return NextResponse.json(
      { error: 'CSV file appears to be empty or has no headers' },
      { status: 400 }
    );
  }

  const sampleRows = rows.slice(0, 5);

  // Ask Claude to identify columns
  const mappingPrompt = `Given this CSV file from a bank or financial institution, identify:
- institution: the bank/institution name (e.g., "Chase", "Amex", "Bank of America")
- account_name: a descriptive account name (e.g., "Chase Sapphire Preferred", "Amex Platinum")
- account_type: one of "checking", "savings", "credit_card", "investment"
- mapping: which CSV columns contain the date, amount, and description
- amount_convention: "negative_expenses" if expenses are negative numbers, "positive_expenses" if expenses are positive

File name: ${fileName}
Headers: ${JSON.stringify(headers)}
Sample rows (first 5):
${JSON.stringify(sampleRows, null, 2)}
User context: ${message || 'Import this file'}

Return ONLY valid JSON with this exact structure, no other text:
{
  "institution": "string",
  "account_name": "string",
  "account_type": "checking|savings|credit_card|investment",
  "mapping": {
    "date": "column_name",
    "amount": "column_name",
    "description": "column_name"
  },
  "amount_convention": "negative_expenses|positive_expenses"
}`;

  const mappingResponse = await anthropic.messages.create({
    model: selectedModel,
    max_tokens: 512,
    messages: [{ role: 'user', content: mappingPrompt }],
  });

  const mappingText = mappingResponse.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  let columnMapping: ColumnMapping;
  try {
    const jsonMatch = mappingText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    columnMapping = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json(
      { error: 'Failed to identify CSV columns. Please try the manual import page.' },
      { status: 422 }
    );
  }

  // Validate the mapping references actual columns
  const { date: dateCol, amount: amountCol, description: descCol } = columnMapping.mapping;
  if (!headers.includes(dateCol) || !headers.includes(amountCol) || !headers.includes(descCol)) {
    return NextResponse.json(
      { error: `Column mapping references columns not found in CSV. Headers: ${headers.join(', ')}` },
      { status: 422 }
    );
  }

  // Find or create account
  let account = db.prepare(
    `SELECT id, name FROM accounts WHERE institution = ? AND type = ? AND is_active = 1 LIMIT 1`
  ).get(columnMapping.institution, columnMapping.account_type) as { id: number; name: string } | undefined;

  if (!account) {
    const result = db.prepare(
      `INSERT INTO accounts (name, type, institution) VALUES (?, ?, ?)`
    ).run(columnMapping.account_name, columnMapping.account_type, columnMapping.institution);
    account = { id: Number(result.lastInsertRowid), name: columnMapping.account_name };
  }

  const accountId = account.id;

  // Convert CSV rows to standard format
  const transactions: ExtractedTransaction[] = [];
  const csvErrors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dateRaw = row[dateCol]?.trim();
    const description = row[descCol]?.trim();

    if (!dateRaw || !description) {
      csvErrors.push(`Row ${i + 1}: missing date or description`);
      continue;
    }

    const rawAmount = row[amountCol]?.replace(/[,$]/g, '') || '';
    let amount = parseFloat(rawAmount);

    if (isNaN(amount)) {
      csvErrors.push(`Row ${i + 1}: invalid amount "${row[amountCol]}"`);
      continue;
    }

    if (columnMapping.amount_convention === 'positive_expenses' && amount > 0) {
      amount = -amount;
    }

    const date = normalizeDate(dateRaw);
    if (!date) {
      csvErrors.push(`Row ${i + 1}: could not parse date "${dateRaw}"`);
      continue;
    }

    transactions.push({ date, amount, description });
  }

  // Import
  const { imported, duplicates, errors: importErrors, categoryCounts } = importRows(
    db, transactions, accountId
  );
  const allErrors = [...csvErrors, ...importErrors];

  // Generate summary
  const { content: summaryContent, usage: summaryUsage } = await generateSummary(
    selectedModel, fileName, account.name, columnMapping.institution,
    columnMapping.account_type, imported, duplicates, allErrors, categoryCounts, message
  );

  saveConversation(db, fileName, message, summaryContent);

  const totalInput = mappingResponse.usage.input_tokens + summaryUsage.input;
  const totalOutput = mappingResponse.usage.output_tokens + summaryUsage.output;
  const cost = calculateCost(selectedModel, totalInput, totalOutput);

  return NextResponse.json({
    role: 'assistant',
    content: summaryContent,
    imported,
    duplicates,
    errors: allErrors.length,
    model: selectedModel,
    usage: { input_tokens: totalInput, output_tokens: totalOutput },
    cost,
  });
}

// --- Shared helpers ---

function importRows(
  db: ReturnType<typeof getDb>,
  transactions: ExtractedTransaction[],
  accountId: number
) {
  const insertStmt = db.prepare(`
    INSERT INTO transactions (date, amount, description, category_id, account_id, type, import_hash, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'import')
  `);
  const checkHash = db.prepare('SELECT id FROM transactions WHERE import_hash = ?');
  // Secondary dedup: same date + amount + account catches cross-format duplicates
  // (e.g., CSV "SUGAR BOWL - TICKETS" vs PDF "AplPay SUGAR BOWL – NORDEN CA")
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
  let incomeRecordsCreated = 0;
  const errors: string[] = [];
  const categoryCounts: Record<string, number> = {};

  // Log first few raw transactions for debugging
  console.log(`[import] Processing ${transactions.length} transactions for account ${accountId}`);
  if (transactions.length > 0) {
    console.log('[import] Sample transactions:', JSON.stringify(transactions.slice(0, 3)));
  }

  const insertMany = db.transaction(() => {
    for (let i = 0; i < transactions.length; i++) {
      const txn = transactions[i];
      try {
        // Coerce amount from string if needed (Claude sometimes returns "$45.23" or "45.23")
        let amount: number;
        if (typeof txn.amount === 'string') {
          amount = parseFloat(String(txn.amount).replace(/[,$]/g, ''));
        } else {
          amount = txn.amount;
        }
        if (isNaN(amount)) {
          errors.push(`Transaction ${i + 1}: invalid amount "${txn.amount}"`);
          continue;
        }

        const date = normalizeDate(String(txn.date));
        if (!date) {
          errors.push(`Transaction ${i + 1}: could not parse date "${txn.date}"`);
          continue;
        }

        const description = String(txn.description || '').trim();
        if (!description) {
          errors.push(`Transaction ${i + 1}: missing description`);
          continue;
        }

        const categoryId = autoCategorize(description);
        const catName = categoryId
          ? (db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string } | undefined)?.name ?? 'Other'
          : 'Uncategorized';

        // Transfer category overrides amount-based type detection
        // (credit card payments are positive but not income)
        const type = catName === 'Transfer' ? 'transfer' : (amount > 0 ? 'income' : 'expense');
        const importHash = getImportHash(date, amount, description, accountId);

        const existing = checkHash.get(importHash);
        if (existing) {
          duplicates++;
          continue;
        }

        // Secondary dedup: catch cross-format duplicates with different descriptions
        const existingByDateAmount = checkDateAmount.get(date, amount, accountId);
        if (existingByDateAmount) {
          duplicates++;
          continue;
        }

        insertStmt.run(date, amount, description, categoryId, accountId, type, importHash);
        imported++;
        categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;

        // Auto-create income_records entry for paycheck/salary transactions
        if (catName === 'Income' && amount > 0) {
          const existingIncome = checkIncomeRecord.get(date, amount);
          if (!existingIncome) {
            insertIncomeRecord.run(date, amount, amount, description);
            incomeRecordsCreated++;
            console.log(`[import] Auto-created income record: ${date} $${amount} "${description}"`);
          }
        }
      } catch (err) {
        errors.push(`Transaction ${i + 1}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
  });

  insertMany();

  if (errors.length > 0) {
    console.log(`[import] ${imported} imported, ${duplicates} duplicates, ${errors.length} errors`);
    console.log('[import] First 5 errors:', errors.slice(0, 5));
  }

  return { imported, duplicates, errors, categoryCounts, incomeRecordsCreated };
}

async function generateSummary(
  model: string, fileName: string, accountName: string, institution: string,
  accountType: string, imported: number, duplicates: number,
  errors: string[], categoryCounts: Record<string, number>, message: string
) {
  const categoryBreakdown = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `  - ${cat}: ${count} transactions`)
    .join('\n');

  const summaryPrompt = `You are a helpful financial advisor. The user just uploaded a statement file and you imported their transactions. Generate a brief, friendly summary of what happened.

Facts:
- File: ${fileName}
- Account: ${accountName} (${institution}, ${accountType.replace('_', ' ')})
- Imported: ${imported} new transactions
- Duplicates skipped: ${duplicates}
- Errors: ${errors.length}${errors.length > 0 ? `\n  Error details: ${errors.slice(0, 5).join('\n  ')}` : ''}
- Category breakdown:
${categoryBreakdown || '  No categories matched'}

User's message: "${message || 'Import this file'}"

Write a concise, conversational response (2-4 sentences). Mention key numbers. If there were duplicates, briefly note they were skipped. End with a helpful suggestion like reviewing uncategorized transactions or checking the transactions page.`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 512,
    messages: [{ role: 'user', content: summaryPrompt }],
  });

  const content = response.content
    .filter(b => b.type === 'text')
    .map(b => b.type === 'text' ? b.text : '')
    .join('');

  return {
    content,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

function saveConversation(db: ReturnType<typeof getDb>, fileName: string, message: string, assistantContent: string) {
  const userContent = message
    ? `[Uploaded ${fileName}] ${message}`
    : `[Uploaded ${fileName}]`;

  db.prepare(`
    INSERT INTO conversations (role, content, conversation_type)
    VALUES ('user', ?, 'general')
  `).run(userContent);

  db.prepare(`
    INSERT INTO conversations (role, content, conversation_type)
    VALUES ('assistant', ?, 'general')
  `).run(assistantContent);
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, [number, number]> = {
    'claude-sonnet-4-5-20250929': [3, 15],
    'claude-opus-4-6': [15, 75],
    'claude-haiku-4-5-20251001': [0.80, 4],
  };
  const [inPrice, outPrice] = pricing[model] ?? [3, 15];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
