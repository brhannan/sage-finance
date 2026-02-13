import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    const questions = db.prepare(`
      SELECT aq.id, aq.question, aq.context_json, aq.conversation_id,
             aq.status, aq.created_at, aq.answered_at,
             c.content as message_content
      FROM advisor_questions aq
      LEFT JOIN conversations c ON c.id = aq.conversation_id
      WHERE aq.status = ?
      ORDER BY aq.created_at DESC
    `).all(status);

    return NextResponse.json(questions);
  } catch (error) {
    console.error('GET /api/advisor/questions error:', error);
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const { id, status } = await request.json();

    if (!id || !['answered', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: 'id and valid status (answered|dismissed) required' }, { status: 400 });
    }

    const answeredAt = status === 'answered' ? "datetime('now')" : 'NULL';
    db.prepare(`
      UPDATE advisor_questions
      SET status = ?, answered_at = ${answeredAt}
      WHERE id = ?
    `).run(status, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PATCH /api/advisor/questions error:', error);
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 });
  }
}
