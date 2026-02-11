import { getDb } from './db';
import crypto from 'crypto';

interface Category {
  id: number;
  name: string;
  keywords: string | null;
}

export function autoCategorize(description: string): number | null {
  const db = getDb();
  const categories = db.prepare('SELECT id, name, keywords FROM categories WHERE keywords IS NOT NULL AND keywords != ""').all() as Category[];

  const descLower = description.toLowerCase();

  for (const cat of categories) {
    if (!cat.keywords) continue;
    const keywords = cat.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    for (const kw of keywords) {
      if (descLower.includes(kw)) {
        return cat.id;
      }
    }
  }

  return null;
}

export function getImportHash(date: string, amount: number, description: string, accountId?: number): string {
  const data = `${date}|${amount}|${description}|${accountId || ''}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}
