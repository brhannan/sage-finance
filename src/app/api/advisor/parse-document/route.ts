import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const DOCUMENT_PROMPTS: Record<string, string> = {
  paystub: `Extract all financial information from this paystub image. Return a JSON object with these fields:
{
  "date": "YYYY-MM-DD (pay date)",
  "pay_period_start": "YYYY-MM-DD",
  "pay_period_end": "YYYY-MM-DD",
  "gross_pay": number,
  "net_pay": number,
  "federal_tax": number or null,
  "state_tax": number or null,
  "social_security": number or null,
  "medicare": number or null,
  "retirement_401k": number or null,
  "health_insurance": number or null,
  "dental_insurance": number or null,
  "vision_insurance": number or null,
  "hsa": number or null,
  "other_deductions": number or null,
  "other_deductions_detail": { "name": amount } or null,
  "employer": "string or null",
  "ytd_gross": number or null,
  "ytd_net": number or null
}

Return ONLY the JSON object, no other text. Use null for fields you cannot find. All monetary values should be numbers (not strings).`,

  credit_karma: `Extract credit score and account information from this Credit Karma screenshot. Return a JSON object with these fields:
{
  "score": number,
  "score_type": "vantage_3" or "fico",
  "date": "YYYY-MM-DD (use today if not visible)",
  "change": number or null (score change from last period),
  "accounts": [
    {
      "name": "string",
      "type": "credit_card" or "loan" or "other",
      "balance": number or null,
      "limit": number or null,
      "utilization": number or null (percentage),
      "payment_status": "string or null"
    }
  ],
  "total_debt": number or null,
  "credit_utilization": number or null (overall percentage),
  "open_accounts": number or null,
  "hard_inquiries": number or null
}

Return ONLY the JSON object, no other text. Use null for fields you cannot determine.`,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, documentType, mediaType } = body as {
      image: string;
      documentType: string;
      mediaType?: string;
    };

    if (!image || !documentType) {
      return NextResponse.json(
        { error: 'image (base64) and documentType are required' },
        { status: 400 }
      );
    }

    const prompt = DOCUMENT_PROMPTS[documentType];
    if (!prompt) {
      return NextResponse.json(
        { error: `Unknown document type: ${documentType}. Supported types: ${Object.keys(DOCUMENT_PROMPTS).join(', ')}` },
        { status: 400 }
      );
    }

    // Determine media type
    const resolvedMediaType = (mediaType || 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

    // Strip data URL prefix if present
    const base64Data = image.includes(',') ? image.split(',')[1] : image;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: resolvedMediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No text response from vision model' }, { status: 500 });
    }

    // Parse the JSON response
    let parsed;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(textContent.text);
      }
    } catch {
      return NextResponse.json({
        error: 'Failed to parse structured data from document',
        raw: textContent.text,
      }, { status: 422 });
    }

    return NextResponse.json({
      documentType,
      data: parsed,
      raw: textContent.text,
    });
  } catch (error) {
    console.error('POST /api/advisor/parse-document error:', error);
    return NextResponse.json({ error: 'Failed to parse document' }, { status: 500 });
  }
}
