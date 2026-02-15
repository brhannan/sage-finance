import Database from 'better-sqlite3';

/**
 * Creates a fresh in-memory SQLite database with the full application schema.
 * Categories are seeded with default keywords for auto-categorization.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

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
      keywords TEXT,
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
      other_deductions_detail TEXT,
      employer TEXT,
      source TEXT DEFAULT 'manual',
      raw_data TEXT,
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
      details TEXT,
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
      config TEXT,
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
      metadata TEXT,
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
      mapping TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS insights_cache (
      id INTEGER PRIMARY KEY DEFAULT 1,
      cache_key TEXT NOT NULL,
      data TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      data_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS advisor_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      context_json TEXT,
      conversation_id INTEGER REFERENCES conversations(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'answered', 'dismissed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      answered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS spending_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      date_start TEXT,
      date_end TEXT,
      total_amount REAL,
      tags TEXT,
      source TEXT DEFAULT 'advisor',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transaction_events (
      transaction_id INTEGER NOT NULL REFERENCES transactions(id),
      event_id INTEGER NOT NULL REFERENCES spending_events(id),
      PRIMARY KEY (transaction_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_advisor_questions_status ON advisor_questions(status);
    CREATE INDEX IF NOT EXISTS idx_spending_events_dates ON spending_events(date_start, date_end);

    INSERT OR IGNORE INTO categories (name, keywords, color) VALUES
      ('Housing', 'rent,mortgage,hoa', '#3B82F6'),
      ('Utilities', 'electric,water,internet,phone,utility,pse,puget sound energy,xfinity,comcast,centurylink,t-mobile,verizon,at&t', '#8B5CF6'),
      ('Groceries', 'grocery,groceries,whole foods,trader joe,safeway,kroger,publix,aldi', '#10B981'),
      ('Dining', 'restaurant,doordash,uber eats,grubhub,starbucks,coffee,mcdonald,chipotle', '#F59E0B'),
      ('Transportation', 'gas,fuel,uber,lyft,parking,transit,metro,shell oil,chevron,exxon,mobil,arco,costco gas,bp#,sunoco,valero,speedway,marathon petro,wawa,circle k,phillips 66,76 ,casey,qt ,quiktrip,racetrac,pilot,flying j,love s,sheetz,kwik trip,good to go,orca,toll', '#EF4444'),
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
      ('Transfer', 'transfer,zelle,venmo,payment,journal,mobile payment,sell -,ira contrib', '#94A3B8'),
      ('Other', '', '#6B7280');

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_balances_account_date ON balances(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_income_date ON income_records(date);
  `);

  return db;
}

/**
 * Seeds a test database with deterministic data for testing metrics and API routes.
 */
export function seedTestData(db: Database.Database) {
  // Accounts
  db.prepare("INSERT INTO accounts (name, type, institution) VALUES ('Chase Checking', 'checking', 'Chase')").run();
  db.prepare("INSERT INTO accounts (name, type, institution) VALUES ('Ally Savings', 'savings', 'Ally')").run();
  db.prepare("INSERT INTO accounts (name, type, institution) VALUES ('Chase Sapphire', 'credit_card', 'Chase')").run();
  db.prepare("INSERT INTO accounts (name, type, institution) VALUES ('Vanguard 401k', 'investment', 'Vanguard')").run();

  // Balances (account 1=checking, 2=savings, 3=credit_card, 4=investment)
  db.prepare("INSERT INTO balances (account_id, date, balance) VALUES (1, '2025-01-31', 5000)").run();
  db.prepare("INSERT INTO balances (account_id, date, balance) VALUES (2, '2025-01-31', 25000)").run();
  db.prepare("INSERT INTO balances (account_id, date, balance) VALUES (3, '2025-01-31', 1500)").run();
  db.prepare("INSERT INTO balances (account_id, date, balance) VALUES (4, '2025-01-31', 150000)").run();

  // Income records for January 2025
  db.prepare(`
    INSERT INTO income_records (date, gross_pay, net_pay, federal_tax, state_tax, employer)
    VALUES ('2025-01-15', 6000, 4500, 900, 300, 'Acme Corp')
  `).run();
  db.prepare(`
    INSERT INTO income_records (date, gross_pay, net_pay, federal_tax, state_tax, employer)
    VALUES ('2025-01-31', 6000, 4500, 900, 300, 'Acme Corp')
  `).run();

  // Get category IDs for seeded categories
  const groceriesId = (db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").get() as { id: number }).id;
  const diningId = (db.prepare("SELECT id FROM categories WHERE name = 'Dining'").get() as { id: number }).id;
  const housingId = (db.prepare("SELECT id FROM categories WHERE name = 'Housing'").get() as { id: number }).id;
  const shoppingId = (db.prepare("SELECT id FROM categories WHERE name = 'Shopping'").get() as { id: number }).id;

  // Expense transactions for January 2025
  db.prepare("INSERT INTO transactions (date, amount, description, category_id, account_id, type) VALUES ('2025-01-05', -2000, 'Rent Payment', ?, 1, 'expense')").run(housingId);
  db.prepare("INSERT INTO transactions (date, amount, description, category_id, account_id, type) VALUES ('2025-01-10', -150, 'Whole Foods Market', ?, 3, 'expense')").run(groceriesId);
  db.prepare("INSERT INTO transactions (date, amount, description, category_id, account_id, type) VALUES ('2025-01-12', -45, 'Starbucks', ?, 3, 'expense')").run(diningId);
  db.prepare("INSERT INTO transactions (date, amount, description, category_id, account_id, type) VALUES ('2025-01-20', -200, 'Amazon Purchase', ?, 3, 'expense')").run(shoppingId);
  db.prepare("INSERT INTO transactions (date, amount, description, category_id, account_id, type) VALUES ('2025-01-25', -100, 'Trader Joe groceries', ?, 1, 'expense')").run(groceriesId);

  // Goals
  db.prepare(`
    INSERT INTO goals (name, type, target_amount, current_amount, target_date, is_active)
    VALUES ('Emergency Fund', 'savings', 30000, 25000, '2025-12-31', 1)
  `).run();
  db.prepare(`
    INSERT INTO goals (name, type, target_amount, current_amount, target_date, is_active)
    VALUES ('House Down Payment', 'home_purchase', 100000, 40000, '2027-06-30', 1)
  `).run();
}
