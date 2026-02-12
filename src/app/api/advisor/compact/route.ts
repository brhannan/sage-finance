import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/lib/db';

const anthropic = new Anthropic();

export async function POST() {
  try {
    const db = getDb();
    const conversationType = 'general';

    // Find the last summary's end_id
    const lastSummary = db.prepare(`
      SELECT messages_end_id FROM conversation_summaries
      WHERE conversation_type = ?
      ORDER BY messages_end_id DESC
      LIMIT 1
    `).get(conversationType) as { messages_end_id: number } | undefined;

    const lastSummarizedId = lastSummary?.messages_end_id ?? 0;

    // Fetch all unsummarized messages
    const unsummarized = db.prepare(`
      SELECT id, role, content, created_at FROM conversations
      WHERE conversation_type = ? AND id > ?
      ORDER BY id ASC
    `).all(conversationType, lastSummarizedId) as Array<{
      id: number;
      role: string;
      content: string;
      created_at: string;
    }>;

    if (unsummarized.length < 10) {
      return NextResponse.json({
        summarized: false,
        reason: 'not enough messages',
        unsummarizedCount: unsummarized.length,
      });
    }

    // Keep the most recent 6 messages untouched
    const toCompact = unsummarized.slice(0, -6);

    if (toCompact.length < 4) {
      return NextResponse.json({
        summarized: false,
        reason: 'not enough messages after reserving recent ones',
        unsummarizedCount: unsummarized.length,
      });
    }

    const messagesText = toCompact.map(m =>
      `[${m.created_at}] ${m.role}: ${m.content}`
    ).join('\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are a conversation summarizer for a personal finance app. Analyze the conversation and produce a structured JSON summary. Return ONLY valid JSON with no markdown formatting, no code fences, just the raw JSON object.

The JSON must follow this exact schema:
{
  "period": "start date to end date",
  "key_topics": ["topic1", "topic2"],
  "financial_insights": ["insight1", "insight2"],
  "action_items": ["item1", "item2"],
  "user_preferences": ["pref1", "pref2"],
  "open_questions": ["question1"]
}

All arrays can be empty if not applicable. Be concise but capture all important financial details and context.`,
      messages: [{
        role: 'user',
        content: `Summarize this financial advisor conversation:\n\n${messagesText}`,
      }],
    });

    const summaryText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.type === 'text' ? block.text : '')
      .join('');

    // Validate it's parseable JSON
    let summaryJson: unknown;
    try {
      summaryJson = JSON.parse(summaryText);
    } catch {
      return NextResponse.json({
        summarized: false,
        reason: 'Failed to parse summary JSON from Claude',
        raw: summaryText,
      }, { status: 500 });
    }

    const startId = toCompact[0].id;
    const endId = toCompact[toCompact.length - 1].id;

    db.prepare(`
      INSERT INTO conversation_summaries
        (conversation_type, summary_json, messages_start_id, messages_end_id, message_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      conversationType,
      JSON.stringify(summaryJson),
      startId,
      endId,
      toCompact.length,
    );

    return NextResponse.json({
      summarized: true,
      messagesCompacted: toCompact.length,
      summary: summaryJson,
    });
  } catch (error) {
    console.error('POST /api/advisor/compact error:', error);
    return NextResponse.json({ error: 'Failed to compact conversation' }, { status: 500 });
  }
}
