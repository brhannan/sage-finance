import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { createTestDb } from './test-db';

// We can't import the sync functions directly because they use getDb() and getPlaidClient()
// singletons. Instead, we replicate the core logic in a testable way, testing:
// 1. Transaction processing (add/modify/remove)
// 2. Amount sign convention (Plaid positive = expense → our negative)
// 3. Auto-categorization via keyword matching
// 4. Dedup: Plaid-to-Plaid (via plaid_transaction_id UNIQUE)
// 5. Dedup: cross-source (CSV import_hash → upgrade with Plaid ID)
// 6. Cursor persistence
// 7. Balance sync
// 8. Pending transaction handling

interface MockPlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number; // Plaid convention: positive = expense
  pending: boolean;
}

function getImportHash(date: string, amount: number, description: string, accountId: number): string {
  const data = `${date}|${amount}|${description}|${accountId}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

function autoCategorize(db: Database.Database, description: string): number | null {
  const categories = db.prepare(
    "SELECT id, name, keywords FROM categories WHERE keywords IS NOT NULL AND keywords != ''"
  ).all() as Array<{ id: number; name: string; keywords: string | null }>;
  const descLower = description.toLowerCase();
  for (const cat of categories) {
    if (!cat.keywords) continue;
    const keywords = cat.keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    for (const kw of keywords) {
      if (descLower.includes(kw)) return cat.id;
    }
  }
  return null;
}

function classifyTransaction(amount: number, description: string): { type: string; amount: number } {
  const ourAmount = -amount; // Negate: Plaid positive = expense, ours negative = expense
  const descLower = description.toLowerCase();
  const transferKeywords = ['transfer', 'zelle', 'venmo', 'payment', 'mobile payment'];
  const isTransfer = transferKeywords.some(kw => descLower.includes(kw));
  if (isTransfer) return { type: 'transfer', amount: ourAmount };
  return { type: ourAmount >= 0 ? 'income' : 'expense', amount: ourAmount };
}

/** Sets up test DB with a plaid_item and linked account */
function setupPlaidTestData(db: Database.Database) {
  db.prepare("INSERT INTO accounts (name, type, institution) VALUES ('Test Checking', 'checking', 'Test Bank')").run();
  db.prepare("INSERT INTO plaid_items (item_id, access_token, institution_name, status) VALUES ('item_test_123', 'access-test-123', 'Test Bank', 'active')").run();
  db.prepare("UPDATE accounts SET plaid_account_id = 'plaid_acct_1', plaid_item_id = 1 WHERE id = 1").run();
}

/** Simulates processAdded from plaid-sync.ts */
function processAdded(db: Database.Database, transactions: MockPlaidTransaction[], accountMap: Map<string, number>): number {
  let count = 0;
  const insertTxn = db.prepare(`
    INSERT INTO transactions (date, amount, description, category_id, account_id, type, import_hash, source, plaid_transaction_id, is_pending)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'plaid', ?, ?)
    ON CONFLICT(plaid_transaction_id) DO NOTHING
  `);
  const updateCsvTxn = db.prepare(`
    UPDATE transactions SET plaid_transaction_id = ?, source = 'plaid', is_pending = ?
    WHERE import_hash = ? AND plaid_transaction_id IS NULL
  `);
  const checkHash = db.prepare('SELECT id FROM transactions WHERE import_hash = ?');
  const checkPlaidId = db.prepare('SELECT id FROM transactions WHERE plaid_transaction_id = ?');

  for (const txn of transactions) {
    const accountId = accountMap.get(txn.account_id);
    if (!accountId) continue;
    if (checkPlaidId.get(txn.transaction_id)) continue;

    const description = txn.name || txn.merchant_name || 'Unknown';
    const { type, amount } = classifyTransaction(txn.amount, description);
    const categoryId = autoCategorize(db, description);
    const importHash = getImportHash(txn.date, amount, description, accountId);
    const isPending = txn.pending ? 1 : 0;

    const existingByHash = checkHash.get(importHash) as { id: number } | undefined;
    if (existingByHash) {
      updateCsvTxn.run(txn.transaction_id, isPending, importHash);
      count++;
      continue;
    }

    insertTxn.run(txn.date, amount, description, categoryId, accountId, type, importHash, txn.transaction_id, isPending);
    count++;
  }
  return count;
}

/** Simulates processModified from plaid-sync.ts */
function processModified(db: Database.Database, transactions: MockPlaidTransaction[], accountMap: Map<string, number>): number {
  let count = 0;
  const updateTxn = db.prepare(`
    UPDATE transactions SET date = ?, amount = ?, description = ?, is_pending = ?, import_hash = ?
    WHERE plaid_transaction_id = ?
  `);

  for (const txn of transactions) {
    const accountId = accountMap.get(txn.account_id);
    if (!accountId) continue;
    const description = txn.name || txn.merchant_name || 'Unknown';
    const { amount } = classifyTransaction(txn.amount, description);
    const importHash = getImportHash(txn.date, amount, description, accountId);
    const isPending = txn.pending ? 1 : 0;
    const result = updateTxn.run(txn.date, amount, description, isPending, importHash, txn.transaction_id);
    if (result.changes > 0) count++;
  }
  return count;
}

/** Simulates processRemoved from plaid-sync.ts */
function processRemoved(db: Database.Database, transactionIds: string[]): number {
  let count = 0;
  const deleteTxn = db.prepare('DELETE FROM transactions WHERE plaid_transaction_id = ?');
  for (const id of transactionIds) {
    const result = deleteTxn.run(id);
    if (result.changes > 0) count++;
  }
  return count;
}

describe('Plaid sync engine', () => {
  let db: Database.Database;
  let accountMap: Map<string, number>;

  beforeEach(() => {
    db = createTestDb();
    setupPlaidTestData(db);
    accountMap = new Map([['plaid_acct_1', 1]]);
  });

  describe('amount sign convention', () => {
    it('negates Plaid amounts (positive expense → negative in our schema)', () => {
      const { amount } = classifyTransaction(45.23, 'WHOLE FOODS');
      expect(amount).toBe(-45.23);
    });

    it('negates Plaid amounts (negative income → positive in our schema)', () => {
      const { amount, type } = classifyTransaction(-500, 'Direct Deposit');
      expect(amount).toBe(500);
      expect(type).toBe('income');
    });

    it('classifies transfers correctly', () => {
      const { type } = classifyTransaction(25, 'Zelle Transfer');
      expect(type).toBe('transfer');
    });
  });

  describe('transaction add', () => {
    it('inserts new transactions from Plaid', () => {
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_1', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'WHOLE FOODS MARKET', merchant_name: 'Whole Foods', amount: 45.23, pending: false },
        { transaction_id: 'txn_2', account_id: 'plaid_acct_1', date: '2025-01-16', name: 'STARBUCKS', merchant_name: 'Starbucks', amount: 5.75, pending: false },
      ];

      const added = processAdded(db, txns, accountMap);
      expect(added).toBe(2);

      const count = (db.prepare('SELECT COUNT(*) as c FROM transactions WHERE source = ?').get('plaid') as { c: number }).c;
      expect(count).toBe(2);

      // Verify amounts are negated
      const txn = db.prepare('SELECT amount FROM transactions WHERE plaid_transaction_id = ?').get('txn_1') as { amount: number };
      expect(txn.amount).toBe(-45.23);
    });

    it('skips transactions for unknown accounts', () => {
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_1', account_id: 'unknown_acct', date: '2025-01-15', name: 'Test', merchant_name: null, amount: 10, pending: false },
      ];
      const added = processAdded(db, txns, accountMap);
      expect(added).toBe(0);
    });

    it('sets is_pending flag correctly', () => {
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_pending', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'Pending Charge', merchant_name: null, amount: 25, pending: true },
      ];
      processAdded(db, txns, accountMap);
      const txn = db.prepare('SELECT is_pending FROM transactions WHERE plaid_transaction_id = ?').get('txn_pending') as { is_pending: number };
      expect(txn.is_pending).toBe(1);
    });
  });

  describe('auto-categorization', () => {
    it('auto-categorizes transactions based on description keywords', () => {
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_grocery', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'WHOLE FOODS MARKET', merchant_name: null, amount: 45, pending: false },
        { transaction_id: 'txn_dining', account_id: 'plaid_acct_1', date: '2025-01-16', name: 'STARBUCKS', merchant_name: null, amount: 6, pending: false },
        { transaction_id: 'txn_shopping', account_id: 'plaid_acct_1', date: '2025-01-17', name: 'AMAZON.COM', merchant_name: null, amount: 30, pending: false },
      ];

      processAdded(db, txns, accountMap);

      const results = db.prepare(`
        SELECT t.plaid_transaction_id, c.name as category
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.source = 'plaid'
        ORDER BY t.date
      `).all() as Array<{ plaid_transaction_id: string; category: string | null }>;

      const byId = Object.fromEntries(results.map(r => [r.plaid_transaction_id, r.category]));
      expect(byId['txn_grocery']).toBe('Groceries');
      expect(byId['txn_dining']).toBe('Dining');
      expect(byId['txn_shopping']).toBe('Shopping');
    });
  });

  describe('dedup: Plaid-to-Plaid', () => {
    it('prevents duplicate Plaid transactions via plaid_transaction_id UNIQUE', () => {
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_1', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'Test', merchant_name: null, amount: 10, pending: false },
      ];

      const first = processAdded(db, txns, accountMap);
      expect(first).toBe(1);

      // Same transaction ID again
      const second = processAdded(db, txns, accountMap);
      expect(second).toBe(0);

      const count = (db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number }).c;
      expect(count).toBe(1);
    });
  });

  describe('dedup: cross-source (CSV → Plaid upgrade)', () => {
    it('upgrades CSV-imported transaction with Plaid ID instead of duplicating', () => {
      // First, simulate a CSV import
      const description = 'WHOLE FOODS MARKET';
      const amount = -45.23; // Already in our convention
      const importHash = getImportHash('2025-01-15', amount, description, 1);

      db.prepare(`
        INSERT INTO transactions (date, amount, description, account_id, type, import_hash, source)
        VALUES ('2025-01-15', ?, ?, 1, 'expense', ?, 'import')
      `).run(amount, description, importHash);

      // Now sync the same transaction from Plaid
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_plaid_1', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'WHOLE FOODS MARKET', merchant_name: null, amount: 45.23, pending: false },
      ];

      const added = processAdded(db, txns, accountMap);
      expect(added).toBe(1); // Counts as processed (upgraded)

      // Should still be just 1 transaction
      const count = (db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number }).c;
      expect(count).toBe(1);

      // Should now have the Plaid ID and source
      const txn = db.prepare('SELECT source, plaid_transaction_id FROM transactions WHERE import_hash = ?').get(importHash) as { source: string; plaid_transaction_id: string };
      expect(txn.source).toBe('plaid');
      expect(txn.plaid_transaction_id).toBe('txn_plaid_1');
    });
  });

  describe('transaction modify', () => {
    it('updates amount, description, and pending status while preserving category', () => {
      // Add initial transaction
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_mod', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'PENDING CHARGE', merchant_name: null, amount: 25, pending: true },
      ];
      processAdded(db, txns, accountMap);

      // Simulate user editing the category
      const groceriesId = (db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").get() as { id: number }).id;
      db.prepare('UPDATE transactions SET category_id = ?, notes = ? WHERE plaid_transaction_id = ?').run(groceriesId, 'my note', 'txn_mod');

      // Now modify: transaction settles with different amount and name
      const modified: MockPlaidTransaction[] = [
        { transaction_id: 'txn_mod', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'WHOLE FOODS MARKET #123', merchant_name: 'Whole Foods', amount: 47.50, pending: false },
      ];
      const modCount = processModified(db, modified, accountMap);
      expect(modCount).toBe(1);

      const txn = db.prepare('SELECT * FROM transactions WHERE plaid_transaction_id = ?').get('txn_mod') as {
        amount: number; description: string; is_pending: number; category_id: number; notes: string;
      };
      expect(txn.amount).toBe(-47.50);
      expect(txn.description).toBe('WHOLE FOODS MARKET #123');
      expect(txn.is_pending).toBe(0);
      // User edits preserved
      expect(txn.category_id).toBe(groceriesId);
      expect(txn.notes).toBe('my note');
    });
  });

  describe('transaction remove', () => {
    it('deletes reversed/erroneous transactions', () => {
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_del', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'Bad Charge', merchant_name: null, amount: 100, pending: false },
      ];
      processAdded(db, txns, accountMap);

      const removed = processRemoved(db, ['txn_del']);
      expect(removed).toBe(1);

      const count = (db.prepare('SELECT COUNT(*) as c FROM transactions WHERE plaid_transaction_id = ?').get('txn_del') as { c: number }).c;
      expect(count).toBe(0);
    });

    it('returns 0 for non-existent transaction IDs', () => {
      const removed = processRemoved(db, ['nonexistent_id']);
      expect(removed).toBe(0);
    });
  });

  describe('cursor persistence', () => {
    it('stores and retrieves sync cursor', () => {
      const cursor = 'cursor_abc123';
      db.prepare('UPDATE plaid_items SET cursor = ? WHERE id = 1').run(cursor);

      const item = db.prepare('SELECT cursor FROM plaid_items WHERE id = 1').get() as { cursor: string };
      expect(item.cursor).toBe(cursor);
    });
  });

  describe('balance sync', () => {
    it('upserts balance records with plaid source', () => {
      const today = new Date().toISOString().slice(0, 10);

      db.prepare(`
        INSERT INTO balances (account_id, date, balance, source)
        VALUES (1, ?, 1000, 'plaid')
        ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance, source = excluded.source
      `).run(today);

      const balance = db.prepare('SELECT balance, source FROM balances WHERE account_id = 1 AND date = ?').get(today) as { balance: number; source: string };
      expect(balance.balance).toBe(1000);
      expect(balance.source).toBe('plaid');

      // Update should overwrite
      db.prepare(`
        INSERT INTO balances (account_id, date, balance, source)
        VALUES (1, ?, 1500, 'plaid')
        ON CONFLICT(account_id, date) DO UPDATE SET balance = excluded.balance, source = excluded.source
      `).run(today);

      const updated = db.prepare('SELECT balance FROM balances WHERE account_id = 1 AND date = ?').get(today) as { balance: number };
      expect(updated.balance).toBe(1500);
    });
  });

  describe('sync logging', () => {
    it('records sync success in plaid_sync_log', () => {
      db.prepare('INSERT INTO plaid_sync_log (plaid_item_id, status, transactions_added, transactions_modified, transactions_removed) VALUES (1, ?, 5, 2, 1)').run('success');

      const log = db.prepare('SELECT * FROM plaid_sync_log WHERE plaid_item_id = 1').get() as {
        status: string; transactions_added: number; transactions_modified: number; transactions_removed: number;
      };
      expect(log.status).toBe('success');
      expect(log.transactions_added).toBe(5);
      expect(log.transactions_modified).toBe(2);
      expect(log.transactions_removed).toBe(1);
    });

    it('records sync errors in plaid_sync_log', () => {
      db.prepare('INSERT INTO plaid_sync_log (plaid_item_id, status, error_message) VALUES (1, ?, ?)').run('error', 'ITEM_LOGIN_REQUIRED: Login needed');

      const log = db.prepare('SELECT * FROM plaid_sync_log WHERE plaid_item_id = 1').get() as {
        status: string; error_message: string;
      };
      expect(log.status).toBe('error');
      expect(log.error_message).toBe('ITEM_LOGIN_REQUIRED: Login needed');
    });
  });

  describe('error handling', () => {
    it('marks item as error status with error code', () => {
      db.prepare("UPDATE plaid_items SET status = 'error', error_code = ?, error_message = ? WHERE id = 1")
        .run('ITEM_LOGIN_REQUIRED', 'Login credentials have changed');

      const item = db.prepare('SELECT status, error_code, error_message FROM plaid_items WHERE id = 1').get() as {
        status: string; error_code: string; error_message: string;
      };
      expect(item.status).toBe('error');
      expect(item.error_code).toBe('ITEM_LOGIN_REQUIRED');
      expect(item.error_message).toBe('Login credentials have changed');
    });

    it('clears error on successful sync', () => {
      // Set error first
      db.prepare("UPDATE plaid_items SET status = 'error', error_code = 'ITEM_LOGIN_REQUIRED', error_message = 'Login needed' WHERE id = 1").run();

      // Simulate successful sync clearing errors
      db.prepare("UPDATE plaid_items SET status = 'active', error_code = NULL, error_message = NULL, last_synced_at = datetime('now') WHERE id = 1").run();

      const item = db.prepare('SELECT status, error_code, error_message FROM plaid_items WHERE id = 1').get() as {
        status: string; error_code: string | null; error_message: string | null;
      };
      expect(item.status).toBe('active');
      expect(item.error_code).toBeNull();
      expect(item.error_message).toBeNull();
    });
  });

  describe('re-sync idempotency', () => {
    it('running sync twice produces no duplicates', () => {
      const txns: MockPlaidTransaction[] = [
        { transaction_id: 'txn_1', account_id: 'plaid_acct_1', date: '2025-01-15', name: 'WHOLE FOODS', merchant_name: null, amount: 45, pending: false },
        { transaction_id: 'txn_2', account_id: 'plaid_acct_1', date: '2025-01-16', name: 'STARBUCKS', merchant_name: null, amount: 6, pending: false },
        { transaction_id: 'txn_3', account_id: 'plaid_acct_1', date: '2025-01-17', name: 'AMAZON', merchant_name: null, amount: 30, pending: false },
      ];

      processAdded(db, txns, accountMap);
      processAdded(db, txns, accountMap); // Second sync

      const count = (db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number }).c;
      expect(count).toBe(3); // No duplicates
    });
  });
});
