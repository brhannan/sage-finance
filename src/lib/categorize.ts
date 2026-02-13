import { getDb } from './db';
import crypto from 'crypto';

interface Category {
  id: number;
  name: string;
  keywords: string | null;
}

export function autoCategorize(description: string): number | null {
  const db = getDb();
  const categories = db.prepare("SELECT id, name, keywords FROM categories WHERE keywords IS NOT NULL AND keywords != ''").all() as Category[];

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

export function normalizeDate(dateStr: string): string | null {
  const trimmed = dateStr.trim();

  // Try YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Try MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) {
      year = (parseInt(year) > 50 ? '19' : '20') + year;
    }
    return `${year}-${month}-${day}`;
  }

  // Try MM/DD (no year — common in credit card statements, assume current year)
  const shortSlashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortSlashMatch) {
    const month = shortSlashMatch[1].padStart(2, '0');
    const day = shortSlashMatch[2].padStart(2, '0');
    const year = new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }

  // Try MM-DD-YYYY or MM.DD.YYYY
  const dashDotMatch = trimmed.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})$/);
  if (dashDotMatch) {
    const month = dashDotMatch[1].padStart(2, '0');
    const day = dashDotMatch[2].padStart(2, '0');
    let year = dashDotMatch[3];
    if (year.length === 2) {
      year = (parseInt(year) > 50 ? '19' : '20') + year;
    }
    return `${year}-${month}-${day}`;
  }

  // Try parsing with Date constructor as fallback (handles "Jan 15, 2026", "January 15 2026", etc.)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}
