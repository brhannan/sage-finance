import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const categories = db.prepare(`
      SELECT c.*,
        p.name as parent_name
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      ORDER BY c.name ASC
    `).all();

    return NextResponse.json(categories);
  } catch (error) {
    console.error('GET /api/categories error:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, parent_id, budget_amount, color, icon, keywords } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO categories (name, parent_id, budget_amount, color, icon, keywords)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, parent_id || null, budget_amount || null, color || null, icon || null, keywords || null);

    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    console.error('POST /api/categories error:', error);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { id, name, parent_id, budget_amount, color, icon, keywords } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(id));
    if (!existing) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (parent_id !== undefined) { fields.push('parent_id = ?'); values.push(parent_id); }
    if (budget_amount !== undefined) { fields.push('budget_amount = ?'); values.push(budget_amount); }
    if (color !== undefined) { fields.push('color = ?'); values.push(color); }
    if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
    if (keywords !== undefined) { fields.push('keywords = ?'); values.push(keywords); }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(Number(id));
    db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(id));
    return NextResponse.json(category);
  } catch (error) {
    console.error('PUT /api/categories error:', error);
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 });
  }
}
