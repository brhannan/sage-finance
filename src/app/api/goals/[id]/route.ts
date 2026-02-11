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
    const { name, type, target_amount, current_amount, target_date, description, config, is_active } = body;

    const existing = db.prepare('SELECT id FROM goals WHERE id = ?').get(Number(id));
    if (!existing) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (type !== undefined) { fields.push('type = ?'); values.push(type); }
    if (target_amount !== undefined) { fields.push('target_amount = ?'); values.push(target_amount); }
    if (current_amount !== undefined) { fields.push('current_amount = ?'); values.push(current_amount); }
    if (target_date !== undefined) { fields.push('target_date = ?'); values.push(target_date); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(config)); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active); }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    fields.push("updated_at = datetime('now')");
    values.push(Number(id));

    db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(Number(id));
    return NextResponse.json(goal);
  } catch (error) {
    console.error('PUT /api/goals/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;

    const result = db.prepare('DELETE FROM goals WHERE id = ?').run(Number(id));
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/goals/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete goal' }, { status: 500 });
  }
}
