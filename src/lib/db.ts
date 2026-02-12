import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'mybudget.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'credit_card', 'investment', 'loan', 'payroll', 'other')),
      institution TEXT,
      last_four TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES categories(id),
      budget_amount REAL,
      color TEXT,
      icon TEXT,
      keywords TEXT, -- comma-separated keywords for auto-categorization
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      account_id INTEGER REFERENCES accounts(id),
      type TEXT NOT NULL DEFAULT 'expense' CHECK(type IN ('expense', 'income', 'transfer')),
      notes TEXT,
      import_hash TEXT UNIQUE,
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS income_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      pay_period_start TEXT,
      pay_period_end TEXT,
      gross_pay REAL NOT NULL,
      net_pay REAL NOT NULL,
      federal_tax REAL,
      state_tax REAL,
      social_security REAL,
      medicare REAL,
      retirement_401k REAL,
      health_insurance REAL,
      dental_insurance REAL,
      vision_insurance REAL,
      hsa REAL,
      other_deductions REAL,
      other_deductions_detail TEXT, -- JSON
      employer TEXT,
      source TEXT DEFAULT 'manual',
      raw_data TEXT, -- JSON of all parsed fields
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL,
      balance REAL NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, date)
    );

    CREATE TABLE IF NOT EXISTS credit_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      score INTEGER NOT NULL,
      source TEXT DEFAULT 'credit_karma',
      score_type TEXT DEFAULT 'vantage_3',
      details TEXT, -- JSON with accounts, utilization, etc.
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('fi', 'home_purchase', 'savings', 'debt_payoff', 'custom')),
      target_amount REAL,
      current_amount REAL DEFAULT 0,
      target_date TEXT,
      description TEXT,
      config TEXT, -- JSON for type-specific config
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS advisor_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      conversation_type TEXT DEFAULT 'general',
      metadata TEXT, -- JSON
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_type TEXT NOT NULL DEFAULT 'general',
      summary_json TEXT NOT NULL,
      messages_start_id INTEGER NOT NULL,
      messages_end_id INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS column_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      institution TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id),
      mapping TEXT NOT NULL, -- JSON mapping of CSV columns
      file_type TEXT DEFAULT 'csv',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'dismissed')),
      source TEXT DEFAULT 'advisor',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    -- Seed default categories if empty
    INSERT OR IGNORE INTO categories (name, keywords, color) VALUES
      ('Housing', 'rent,mortgage,hoa', '#3B82F6'),
      ('Utilities', 'electric,gas,water,internet,phone,utility', '#8B5CF6'),
      ('Groceries', 'grocery,groceries,whole foods,trader joe,safeway,kroger,publix,aldi', '#10B981'),
      ('Dining', 'restaurant,doordash,uber eats,grubhub,starbucks,coffee,mcdonald,chipotle', '#F59E0B'),
      ('Transportation', 'gas,fuel,uber,lyft,parking,transit,metro', '#EF4444'),
      ('Shopping', 'amazon,target,walmart,costco,best buy', '#EC4899'),
      ('Entertainment', 'netflix,spotify,hulu,disney,movie,concert,gaming', '#6366F1'),
      ('Healthcare', 'doctor,pharmacy,cvs,walgreens,medical,dental,hospital', '#14B8A6'),
      ('Insurance', 'insurance,geico,state farm,allstate', '#64748B'),
      ('Subscriptions', 'subscription,membership,annual', '#A855F7'),
      ('Personal Care', 'haircut,salon,gym,fitness', '#F97316'),
      ('Education', 'tuition,course,book,udemy', '#0EA5E9'),
      ('Travel', 'hotel,airbnb,airline,flight,vacation', '#D946EF'),
      ('Gifts & Donations', 'gift,donation,charity', '#FB923C'),
      ('Income', 'payroll,salary,deposit,direct dep', '#22C55E'),
      ('Transfer', 'transfer,zelle,venmo,payment', '#94A3B8'),
      ('Other', '', '#6B7280');

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_balances_account_date ON balances(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_income_date ON income_records(date);
  `);
}
