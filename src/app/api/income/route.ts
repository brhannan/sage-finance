import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const employer = searchParams.get('employer');
    const limit = searchParams.get('limit');

    let query = 'SELECT * FROM income_records WHERE 1=1';
    const params: unknown[] = [];

    if (month) {
      query += ` AND strftime('%Y-%m', date) = ?`;
      params.push(month);
    }
    if (employer) {
      query += ' AND employer = ?';
      params.push(employer);
    }

    query += ' ORDER BY date DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(Number(limit));
    }

    const records = db.prepare(query).all(...params);
    return NextResponse.json(records);
  } catch (error) {
    console.error('GET /api/income error:', error);
    return NextResponse.json({ error: 'Failed to fetch income records' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const {
      date, pay_period_start, pay_period_end, gross_pay, net_pay,
      federal_tax, state_tax, social_security, medicare,
      retirement_401k, health_insurance, dental_insurance, vision_insurance,
      hsa, other_deductions, other_deductions_detail, employer, source, raw_data,
    } = body;

    if (!date || gross_pay === undefined || net_pay === undefined) {
      return NextResponse.json({ error: 'date, gross_pay, and net_pay are required' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO income_records (
        date, pay_period_start, pay_period_end, gross_pay, net_pay,
        federal_tax, state_tax, social_security, medicare,
        retirement_401k, health_insurance, dental_insurance, vision_insurance,
        hsa, other_deductions, other_deductions_detail, employer, source, raw_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      date, pay_period_start || null, pay_period_end || null, gross_pay, net_pay,
      federal_tax || null, state_tax || null, social_security || null, medicare || null,
      retirement_401k || null, health_insurance || null, dental_insurance || null, vision_insurance || null,
      hsa || null, other_deductions || null,
      other_deductions_detail ? JSON.stringify(other_deductions_detail) : null,
      employer || null, source || 'manual',
      raw_data ? JSON.stringify(raw_data) : null,
    );

    const record = db.prepare('SELECT * FROM income_records WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('POST /api/income error:', error);
    return NextResponse.json({ error: 'Failed to create income record' }, { status: 500 });
  }
}
