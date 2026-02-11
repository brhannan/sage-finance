import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;
    const body = await request.json();
    const { date, amount, description, category_id, account_id, type, notes } = body;

    const existing = db.prepare('SELECT id FROM transactions WHERE id = ?').get(Number(id));
    if (!existing) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (date !== undefined) { fields.push('date = ?'); values.push(date); }
    if (amount !== undefined) { fields.push('amount = ?'); values.push(amount); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (category_id !== undefined) { fields.push('category_id = ?'); values.push(category_id); }
    if (account_id !== undefined) { fields.push('account_id = ?'); values.push(account_id); }
    if (type !== undefined) { fields.push('type = ?'); values.push(type); }
    if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(Number(id));
    db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const transaction = db.prepare(`
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ?
    `).get(Number(id));

    return NextResponse.json(transaction);
  } catch (error) {
    console.error('PUT /api/transactions/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;

    const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(id));
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/transactions/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
