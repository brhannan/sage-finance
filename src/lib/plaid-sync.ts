import { PlaidApi, RemovedTransaction, Transaction } from 'plaid';
import { getDb } from './db';
import { getPlaidClient } from './plaid';
import { autoCategorize, getImportHash } from './categorize';

interface PlaidItem {
  id: number;
  item_id: string;
  access_token: string;
  institution_name: string | null;
  cursor: string | null;
  status: string;
}

interface SyncResult {
  itemId: number;
  institutionName: string | null;
  added: number;
  modified: number;
  removed: number;
  error?: string;
}

/**
 * Determines the transaction type based on amount.
 * Plaid: positive amount = money leaving the account (expense)
 * Our schema: negative amount = expense, positive = income
 */
function classifyTransaction(amount: number, description: string): { type: string; amount: number } {
  // Negate Plaid amount: Plaid positive = expense, we use negative = expense
  const ourAmount = -amount;

  const descLower = description.toLowerCase();
  const transferKeywords = ['transfer', 'zelle', 'venmo', 'payment', 'mobile payment'];
  const isTransfer = transferKeywords.some(kw => descLower.includes(kw));

  if (isTransfer) {
    return { type: 'transfer', amount: ourAmount };
  }

  return {
    type: ourAmount >= 0 ? 'income' : 'expense',
    amount: ourAmount,
  };
}

/**
 * Processes added transactions from Plaid sync.
 */
function processAdded(
  db: ReturnType<typeof getDb>,
  transactions: Transaction[],
  accountMap: Map<string, number>,
): number {
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

    // Skip if we already have this Plaid transaction
    if (checkPlaidId.get(txn.transaction_id)) continue;

    const date = txn.date; // Already YYYY-MM-DD
    const description = txn.name || txn.merchant_name || 'Unknown';
    const { type, amount } = classifyTransaction(txn.amount, description);
    const categoryId = autoCategorize(description);
    const importHash = getImportHash(date, amount, description, accountId);
    const isPending = txn.pending ? 1 : 0;

    // Check for cross-source dupe (CSV import with same hash)
    const existingByHash = checkHash.get(importHash) as { id: number } | undefined;
    if (existingByHash) {
      // Upgrade existing CSV transaction with Plaid ID
      updateCsvTxn.run(txn.transaction_id, isPending, importHash);
      count++;
      continue;
    }

    insertTxn.run(date, amount, description, categoryId, accountId, type, importHash, txn.transaction_id, isPending);
    count++;
  }

  return count;
}

/**
 * Processes modified transactions from Plaid sync.
 * Updates amount/description/pending but preserves user-edited category/notes.
 */
function processModified(
  db: ReturnType<typeof getDb>,
  transactions: Transaction[],
  accountMap: Map<string, number>,
): number {
  let count = 0;

  const updateTxn = db.prepare(`
    UPDATE transactions SET
      date = ?,
      amount = ?,
      description = ?,
      is_pending = ?,
      import_hash = ?
    WHERE plaid_transaction_id = ?
  `);

  for (const txn of transactions) {
    const accountId = accountMap.get(txn.account_id);
    if (!accountId) continue;

    const date = txn.date;
    const description = txn.name || txn.merchant_name || 'Unknown';
    const { amount } = classifyTransaction(txn.amount, description);
    const importHash = getImportHash(date, amount, description, accountId);
    const isPending = txn.pending ? 1 : 0;

    const result = updateTxn.run(date, amount, description, isPending, importHash, txn.transaction_id);
    if (result.changes > 0) count++;
  }

  return count;
}

/**
 * Processes removed transactions from Plaid sync.
 */
function processRemoved(
  db: ReturnType<typeof getDb>,
  transactions: RemovedTransaction[],
): number {
  let count = 0;
  const deleteTxn = db.prepare('DELETE FROM transactions WHERE plaid_transaction_id = ?');

  for (const txn of transactions) {
    const result = deleteTxn.run(txn.transaction_id);
    if (result.changes > 0) count++;
  }

  return count;
}

/**
 * Syncs balances for all accounts linked to a Plaid item.
 */
async function syncBalances(
  client: PlaidApi,
  accessToken: string,
  accountMap: Map<string, number>,
): Promise<void> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const response = await client.accountsBalanceGet({
    access_token: accessToken,
  });

  const upsertBalance = db.prepare(`
    INSERT INTO balances (account_id, date, balance, source)
    VALUES (?, ?, ?, 'plaid')
    ON CONFLICT(account_id, date) DO UPDATE SET
      balance = excluded.balance,
      source = excluded.source,
      created_at = datetime('now')
  `);

  for (const account of response.data.accounts) {
    const accountId = accountMap.get(account.account_id);
    if (!accountId) continue;

    const balance = account.balances.current;
    if (balance !== null && balance !== undefined) {
      // For credit cards, Plaid returns positive balance = amount owed
      // Our schema stores credit card balances as positive (amount owed)
      upsertBalance.run(accountId, today, balance);
    }
  }
}

/**
 * Syncs a single Plaid item (bank connection).
 * Uses cursor-based incremental sync via /transactions/sync.
 */
export async function syncPlaidItem(
  itemId: number,
  client?: PlaidApi,
): Promise<SyncResult> {
  const db = getDb();
  const plaidClient = client || getPlaidClient();

  const item = db.prepare('SELECT * FROM plaid_items WHERE id = ? AND status = ?').get(itemId, 'active') as PlaidItem | undefined;
  if (!item) {
    return { itemId, institutionName: null, added: 0, modified: 0, removed: 0, error: 'Item not found or inactive' };
  }

  // Build account map: plaid_account_id -> our account id
  const accounts = db.prepare('SELECT id, plaid_account_id FROM accounts WHERE plaid_item_id = ?').all(item.id) as { id: number; plaid_account_id: string }[];
  const accountMap = new Map(accounts.map(a => [a.plaid_account_id, a.id]));

  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;
  let cursor = item.cursor;
  let hasMore = true;
  let retries = 0;

  try {
    while (hasMore) {
      let response;
      try {
        response = await plaidClient.transactionsSync({
          access_token: item.access_token,
          cursor: cursor || undefined,
        });
      } catch (syncError: unknown) {
        // Handle rate limiting with exponential backoff
        const err = syncError as { response?: { status?: number } };
        if (err.response?.status === 429 && retries < 3) {
          retries++;
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
          continue;
        }
        throw syncError;
      }

      const data = response.data;

      const syncTransaction = db.transaction(() => {
        totalAdded += processAdded(db, data.added, accountMap);
        totalModified += processModified(db, data.modified, accountMap);
        totalRemoved += processRemoved(db, data.removed);
      });
      syncTransaction();

      cursor = data.next_cursor;
      hasMore = data.has_more;
    }

    // Update cursor and last_synced_at
    db.prepare('UPDATE plaid_items SET cursor = ?, last_synced_at = datetime(\'now\'), status = \'active\', error_code = NULL, error_message = NULL, updated_at = datetime(\'now\') WHERE id = ?')
      .run(cursor, item.id);

    // Sync balances
    try {
      await syncBalances(plaidClient, item.access_token, accountMap);
    } catch (balanceError) {
      console.error(`Balance sync failed for item ${item.id}:`, balanceError);
      // Don't fail the whole sync for balance errors
    }

    // Log success
    db.prepare('INSERT INTO plaid_sync_log (plaid_item_id, status, transactions_added, transactions_modified, transactions_removed) VALUES (?, ?, ?, ?, ?)')
      .run(item.id, 'success', totalAdded, totalModified, totalRemoved);

    return {
      itemId: item.id,
      institutionName: item.institution_name,
      added: totalAdded,
      modified: totalModified,
      removed: totalRemoved,
    };
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error_code?: string; error_message?: string } }; message?: string };
    const errorCode = err.response?.data?.error_code || 'UNKNOWN';
    const errorMessage = err.response?.data?.error_message || err.message || 'Unknown error';

    // Mark item with error status if it's a login-required error
    if (errorCode === 'ITEM_LOGIN_REQUIRED') {
      db.prepare('UPDATE plaid_items SET status = \'error\', error_code = ?, error_message = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(errorCode, errorMessage, item.id);
    }

    // Log error
    db.prepare('INSERT INTO plaid_sync_log (plaid_item_id, status, error_message) VALUES (?, ?, ?)')
      .run(item.id, 'error', `${errorCode}: ${errorMessage}`);

    return {
      itemId: item.id,
      institutionName: item.institution_name,
      added: totalAdded,
      modified: totalModified,
      removed: totalRemoved,
      error: `${errorCode}: ${errorMessage}`,
    };
  }
}

/**
 * Syncs all active Plaid items.
 */
export async function syncAllPlaidItems(client?: PlaidApi): Promise<SyncResult[]> {
  const db = getDb();
  const items = db.prepare('SELECT id FROM plaid_items WHERE status = ?').all('active') as { id: number }[];
  const results: SyncResult[] = [];

  for (const item of items) {
    const result = await syncPlaidItem(item.id, client);
    results.push(result);
  }

  return results;
}
