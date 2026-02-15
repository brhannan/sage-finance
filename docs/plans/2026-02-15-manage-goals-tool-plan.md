# `manage_goals` Advisor Tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the advisor a `manage_goals` tool to create and update financial goals, with optional account-linking for automatic progress tracking via balance snapshots.

**Architecture:** Add `account_id` column to the existing `goals` table. Add a single `manage_goals` tool to the advisor's tool array. Update `getGoalProgress()` and the Goals API to auto-resolve `current_amount` from the latest balance when a goal is linked to an account. Update the Goals page to show linked accounts and allow linking via the UI.

**Tech Stack:** Next.js 14, better-sqlite3, TypeScript, Vitest, shadcn/ui

---

### Task 1: Schema — Add `account_id` column to goals table

**Files:**
- Modify: `src/lib/db.ts:139-151` (production schema)
- Modify: `src/lib/__tests__/test-db.ts:92-104` (test schema)

**Step 1: Update production schema in `src/lib/db.ts`**

In the `goals` CREATE TABLE statement (~line 139), add `account_id` column:

```sql
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('fi', 'home_purchase', 'savings', 'debt_payoff', 'custom')),
  target_amount REAL,
  current_amount REAL DEFAULT 0,
  target_date TEXT,
  description TEXT,
  config TEXT,
  account_id INTEGER REFERENCES accounts(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Also add an `ALTER TABLE` migration after `initializeSchema` completes, to handle existing databases. Add this inside `initializeSchema()` after the main `db.exec(...)` block:

```typescript
// Migration: add account_id to goals if it doesn't exist
try {
  db.prepare("SELECT account_id FROM goals LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE goals ADD COLUMN account_id INTEGER REFERENCES accounts(id)");
}
```

**Step 2: Update test schema in `src/lib/__tests__/test-db.ts`**

Same change to the `goals` CREATE TABLE in test-db.ts (~line 92). Add `account_id INTEGER REFERENCES accounts(id),` before `is_active`.

**Step 3: Run existing tests to verify schema change doesn't break anything**

Run: `npx vitest run src/app/api/__tests__/goals.test.ts`
Expected: All 4 existing tests pass (GET, POST, PUT, DELETE).

**Step 4: Commit**

```bash
git add src/lib/db.ts src/lib/__tests__/test-db.ts
git commit -m "feat(goals): add account_id column for account-linked goal tracking"
```

---

### Task 2: Auto-resolve `current_amount` for account-linked goals

**Files:**
- Modify: `src/lib/metrics.ts:165-179` (`getGoalProgress`)
- Modify: `src/app/api/goals/route.ts:4-25` (GET handler)
- Test: `src/app/api/__tests__/goals.test.ts`

**Step 1: Write failing tests for account-linked goal progress**

Add these tests to `src/app/api/__tests__/goals.test.ts`:

```typescript
it('resolves current_amount from latest balance for account-linked goals', async () => {
  // Create a goal linked to account 2 (Ally Savings, balance $25,000)
  const createReq = new NextRequest('http://localhost/api/goals', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Savings Target',
      type: 'savings',
      target_amount: 50000,
      current_amount: 0,
      account_id: 2,
    }),
  });
  await POST(createReq);

  const res = await GET();
  const data = await res.json();
  const linked = data.find((g: { name: string }) => g.name === 'Savings Target');

  expect(linked).toBeDefined();
  expect(linked.current_amount).toBe(25000); // from Ally Savings balance
  expect(linked.account_id).toBe(2);
  expect(linked.progress).toBeCloseTo(50, 0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/__tests__/goals.test.ts`
Expected: FAIL — `current_amount` is 0 (static), not 25000.

**Step 3: Update Goals API GET to resolve from balances**

In `src/app/api/goals/route.ts`, replace the query to join against balances:

```typescript
export async function GET() {
  try {
    const db = getDb();

    const goals = db.prepare(`
      SELECT g.*,
        CASE
          WHEN g.account_id IS NOT NULL THEN (
            SELECT b.balance FROM balances b
            WHERE b.account_id = g.account_id
            ORDER BY b.date DESC LIMIT 1
          )
          ELSE g.current_amount
        END as resolved_amount,
        a.name as account_name
      FROM goals g
      LEFT JOIN accounts a ON a.id = g.account_id
      ORDER BY g.is_active DESC, g.created_at DESC
    `).all() as Array<{
      id: number; name: string; type: string; target_amount: number;
      current_amount: number; resolved_amount: number;
      target_date: string | null; is_active: number;
      description: string | null; config: string | null;
      account_id: number | null; account_name: string | null;
    }>;

    const withProgress = goals.map(g => ({
      ...g,
      current_amount: g.resolved_amount ?? g.current_amount,
      config: g.config ? JSON.parse(g.config) : null,
      progress: g.target_amount > 0
        ? Math.min(100, Math.round(((g.resolved_amount ?? g.current_amount) / g.target_amount) * 1000) / 10)
        : 0,
    }));

    return NextResponse.json(withProgress);
  } catch (error) {
    console.error('GET /api/goals error:', error);
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/__tests__/goals.test.ts`
Expected: All tests pass including the new one.

**Step 5: Update `getGoalProgress()` in metrics.ts**

Replace the function in `src/lib/metrics.ts:165-179`:

```typescript
export function getGoalProgress(): Array<{
  id: number; name: string; type: string; target_amount: number;
  current_amount: number; target_date: string | null; progress: number;
  account_id: number | null;
}> {
  const db = getDb();
  const goals = db.prepare(`
    SELECT g.*,
      CASE
        WHEN g.account_id IS NOT NULL THEN (
          SELECT b.balance FROM balances b
          WHERE b.account_id = g.account_id
          ORDER BY b.date DESC LIMIT 1
        )
        ELSE g.current_amount
      END as resolved_amount
    FROM goals g
    WHERE g.is_active = 1
  `).all() as Array<{
    id: number; name: string; type: string; target_amount: number;
    current_amount: number; resolved_amount: number;
    target_date: string | null; account_id: number | null;
  }>;

  return goals.map(g => ({
    id: g.id,
    name: g.name,
    type: g.type,
    target_amount: g.target_amount,
    current_amount: g.resolved_amount ?? g.current_amount,
    target_date: g.target_date,
    account_id: g.account_id,
    progress: g.target_amount > 0 ? Math.min(100, ((g.resolved_amount ?? g.current_amount) / g.target_amount) * 100) : 0,
  }));
}
```

**Step 6: Run full test suite to check nothing broke**

Run: `npx vitest run`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add src/lib/metrics.ts src/app/api/goals/route.ts src/app/api/__tests__/goals.test.ts
git commit -m "feat(goals): auto-resolve current_amount from account balance for linked goals"
```

---

### Task 3: Goals API — Accept `account_id` on create and update

**Files:**
- Modify: `src/app/api/goals/route.ts:27-52` (POST handler)
- Modify: `src/app/api/goals/[id]/route.ts:4-46` (PUT handler)
- Test: `src/app/api/__tests__/goals.test.ts`

**Step 1: Write failing test for creating a goal with account_id**

Add to `src/app/api/__tests__/goals.test.ts` in the POST describe block:

```typescript
it('creates a goal linked to an account', async () => {
  const req = new NextRequest('http://localhost/api/goals', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Brokerage Growth',
      type: 'savings',
      target_amount: 200000,
      account_id: 4,
    }),
  });
  const res = await POST(req);
  const data = await res.json();

  expect(res.status).toBe(201);
  expect(data.name).toBe('Brokerage Growth');
  expect(data.account_id).toBe(4);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/__tests__/goals.test.ts`
Expected: FAIL — `account_id` is null because POST doesn't handle it.

**Step 3: Update POST handler to accept `account_id`**

In `src/app/api/goals/route.ts`, update the POST handler:

```typescript
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, type, target_amount, current_amount, target_date, description, config, account_id } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    const result = db.prepare(`
      INSERT INTO goals (name, type, target_amount, current_amount, target_date, description, config, account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, type, target_amount || null, current_amount || 0,
      target_date || null, description || null,
      config ? JSON.stringify(config) : null,
      account_id || null,
    );

    const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error('POST /api/goals error:', error);
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
  }
}
```

**Step 4: Update PUT handler to accept `account_id`**

In `src/app/api/goals/[id]/route.ts`, add `account_id` to the destructured body and the fields list:

Add after the `is_active` field handler (~line 29):
```typescript
if (account_id !== undefined) { fields.push('account_id = ?'); values.push(account_id); }
```

And add `account_id` to the destructured body on line 12.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/api/__tests__/goals.test.ts`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/app/api/goals/route.ts src/app/api/goals/[id]/route.ts src/app/api/__tests__/goals.test.ts
git commit -m "feat(goals): accept account_id on goal create and update"
```

---

### Task 4: Advisor tool — Add `manage_goals` tool definition and handler

**Files:**
- Modify: `src/app/api/advisor/route.ts:294-359` (tools array)
- Modify: `src/app/api/advisor/route.ts:463-479` (executeTools handler, add new else-if block)
- Modify: `src/app/api/advisor/route.ts:208-254` (system prompt instructions)

**Step 1: Add `manage_goals` tool definition**

Add to the `tools` array after the `save_followup` tool (~line 358):

```typescript
{
  name: 'manage_goals',
  description: 'Create or update financial goals. Use this when the user wants to set savings targets, track debt payoff, plan for a home purchase, or establish any financial milestone. Link goals to accounts when possible so progress updates automatically from balance snapshots.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ['create', 'update'], description: 'Whether to create a new goal or update an existing one' },
      // Create fields
      name: { type: 'string', description: 'Goal name (e.g., "Emergency Fund"). Required for create.' },
      type: { type: 'string', enum: ['fi', 'home_purchase', 'savings', 'debt_payoff', 'custom'], description: 'Goal type. Required for create.' },
      target_amount: { type: 'number', description: 'Target dollar amount. Required for create.' },
      current_amount: { type: 'number', description: 'Current progress amount (default 0). Not needed if linking to an account.' },
      target_date: { type: 'string', description: 'Target completion date (YYYY-MM-DD)' },
      description: { type: 'string', description: 'Brief description of the goal' },
      account_id: { type: 'number', description: 'Link to an account ID for automatic progress tracking from balance snapshots. Use this when the goal maps to a specific account (e.g., savings account, investment account).' },
      // Update fields
      goal_id: { type: 'number', description: 'ID of the goal to update. Required for update.' },
      is_active: { type: 'boolean', description: 'Set to false to deactivate a completed or abandoned goal' },
    },
    required: ['action'],
  },
},
```

**Step 2: Add `manage_goals` handler in `executeTools`**

Add a new `else if` block after the `save_followup` handler (~line 479):

```typescript
} else if (block.name === 'manage_goals') {
  const input = block.input as {
    action: 'create' | 'update';
    name?: string; type?: string; target_amount?: number;
    current_amount?: number; target_date?: string;
    description?: string; account_id?: number;
    goal_id?: number; is_active?: boolean;
  };

  if (input.action === 'create') {
    if (!input.name || !input.type || input.target_amount == null) {
      toolResults.push({
        type: 'tool_result', tool_use_id: block.id,
        content: 'Error: name, type, and target_amount are required for creating a goal.',
      });
    } else {
      const result = db.prepare(`
        INSERT INTO goals (name, type, target_amount, current_amount, target_date, description, account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.name, input.type, input.target_amount,
        input.current_amount || 0,
        input.target_date || null,
        input.description || null,
        input.account_id || null,
      );
      const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid) as {
        id: number; name: string; type: string; target_amount: number;
        current_amount: number; account_id: number | null;
      };

      // If linked to an account, resolve current amount from balance
      let currentAmount = goal.current_amount;
      if (goal.account_id) {
        const bal = db.prepare(
          'SELECT balance FROM balances WHERE account_id = ? ORDER BY date DESC LIMIT 1'
        ).get(goal.account_id) as { balance: number } | undefined;
        if (bal) currentAmount = bal.balance;
      }

      const progress = goal.target_amount > 0
        ? Math.min(100, (currentAmount / goal.target_amount) * 100)
        : 0;

      toolResults.push({
        type: 'tool_result', tool_use_id: block.id,
        content: `Goal "${input.name}" created (ID: ${goal.id}). Current: $${currentAmount.toLocaleString()} / $${goal.target_amount.toLocaleString()} (${progress.toFixed(1)}% complete)${goal.account_id ? ' — linked to account for auto-tracking' : ''}.`,
      });
    }
  } else if (input.action === 'update') {
    if (!input.goal_id) {
      toolResults.push({
        type: 'tool_result', tool_use_id: block.id,
        content: 'Error: goal_id is required for updating a goal.',
      });
    } else {
      const existing = db.prepare('SELECT id FROM goals WHERE id = ?').get(input.goal_id);
      if (!existing) {
        toolResults.push({
          type: 'tool_result', tool_use_id: block.id,
          content: `Error: Goal with ID ${input.goal_id} not found.`,
        });
      } else {
        const fields: string[] = [];
        const values: (string | number | null)[] = [];

        if (input.current_amount !== undefined) { fields.push('current_amount = ?'); values.push(input.current_amount); }
        if (input.target_amount !== undefined) { fields.push('target_amount = ?'); values.push(input.target_amount); }
        if (input.target_date !== undefined) { fields.push('target_date = ?'); values.push(input.target_date); }
        if (input.is_active !== undefined) { fields.push('is_active = ?'); values.push(input.is_active ? 1 : 0); }
        if (input.account_id !== undefined) { fields.push('account_id = ?'); values.push(input.account_id); }

        if (fields.length > 0) {
          fields.push("updated_at = datetime('now')");
          values.push(input.goal_id);
          db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        }

        const updated = db.prepare('SELECT * FROM goals WHERE id = ?').get(input.goal_id) as {
          name: string; target_amount: number; current_amount: number; account_id: number | null;
        };

        let currentAmount = updated.current_amount;
        if (updated.account_id) {
          const bal = db.prepare(
            'SELECT balance FROM balances WHERE account_id = ? ORDER BY date DESC LIMIT 1'
          ).get(updated.account_id) as { balance: number } | undefined;
          if (bal) currentAmount = bal.balance;
        }

        const progress = updated.target_amount > 0
          ? Math.min(100, (currentAmount / updated.target_amount) * 100)
          : 0;

        toolResults.push({
          type: 'tool_result', tool_use_id: block.id,
          content: `Goal "${updated.name}" updated. Current: $${currentAmount.toLocaleString()} / $${updated.target_amount.toLocaleString()} (${progress.toFixed(1)}% complete).`,
        });
      }
    }
  }
}
```

**Step 3: Update advisor system prompt**

Add this line to the system prompt instructions section (~line 250, after the existing tool guidance):

```
GOAL MANAGEMENT:
- You have a manage_goals tool. Use it when the user wants to set financial goals, savings targets, or track progress toward any financial milestone.
- When creating goals, link them to accounts when possible (using account_id) so progress updates automatically from balance snapshots.
- Available account IDs are shown in the ACCOUNTS section above — match goals to the most relevant account.
- Goal types: fi (financial independence), home_purchase, savings, debt_payoff, custom.
```

**Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/app/api/advisor/route.ts
git commit -m "feat(advisor): add manage_goals tool for creating and updating financial goals"
```

---

### Task 5: Update Goals page UI

**Files:**
- Modify: `src/app/goals/page.tsx`

**Step 1: Add `account_id` and `account_name` to the Goal interface**

Update the `Goal` interface (~line 35):

```typescript
interface Goal {
  id: number;
  name: string;
  type: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  description: string | null;
  is_active: number;
  progress: number;
  account_id: number | null;
  account_name: string | null;
}
```

**Step 2: Add Account type and fetch accounts for the dropdown**

Add an `Account` interface and state after the `Goal` interface:

```typescript
interface Account {
  id: number;
  name: string;
  type: string;
  institution: string | null;
}
```

Add `accounts` state and fetch in the component:

```typescript
const [accounts, setAccounts] = useState<Account[]>([]);

// Inside the useEffect or alongside fetchGoals:
useEffect(() => {
  fetch('/api/accounts').then(r => r.ok ? r.json() : []).then(setAccounts).catch(() => {});
}, []);
```

**Step 3: Add `account_id` to the form state**

Update the form state to include `account_id`:

```typescript
const [form, setForm] = useState({
  name: "",
  type: "savings",
  target_amount: "",
  current_amount: "",
  target_date: "",
  description: "",
  account_id: "",
});
```

Update `openAdd` and `openEdit` to handle `account_id`:
- `openAdd`: set `account_id: ""`
- `openEdit`: set `account_id: goal.account_id ? String(goal.account_id) : ""`

Update `handleSave` body to include: `account_id: form.account_id ? parseInt(form.account_id) : null`

**Step 4: Add Account dropdown to the dialog**

Add after the Target Date field in the dialog:

```tsx
<div className="space-y-2">
  <Label>Linked Account (optional)</Label>
  <Select
    value={form.account_id}
    onValueChange={(v) => setForm({ ...form, account_id: v })}
  >
    <SelectTrigger>
      <SelectValue placeholder="None — track manually" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">None — track manually</SelectItem>
      {accounts.map((a) => (
        <SelectItem key={a.id} value={String(a.id)}>
          {a.name}{a.institution ? ` (${a.institution})` : ''}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  <p className="text-xs text-muted-foreground">
    Link to an account to auto-track progress from balance updates.
  </p>
</div>
```

Handle `value="none"` in the `onValueChange`: if `v === "none"`, set `account_id: ""`.

**Step 5: Show linked account name on goal cards**

In the CardHeader for each goal card, below the Badge, add:

```tsx
{goal.account_name && (
  <span className="ml-2 text-xs text-muted-foreground">
    Tracking: {goal.account_name}
  </span>
)}
```

**Step 6: Test manually in the browser**

1. Navigate to `/goals`
2. Click "Add Goal" — verify Account dropdown appears with accounts
3. Create a goal linked to an account — verify progress shows account balance
4. Create a goal without account link — verify manual tracking still works
5. Edit a goal — verify account_id persists

**Step 7: Commit**

```bash
git add src/app/goals/page.tsx
git commit -m "feat(goals): add account linking UI to goals page"
```

---

### Task 6: Update advisor goals context to show account links

**Files:**
- Modify: `src/app/api/advisor/route.ts:163-165` (goalsContext formatting)

**Step 1: Update goalsContext to show linked account names**

The `getGoalProgress()` function now returns `account_id`. Update the goalsContext formatter to include account info when available:

```typescript
const goalsContext = goals.map(g => {
  const acct = g.account_id
    ? accounts.find(a => a.id === g.account_id)
    : null;
  const acctLabel = acct ? ` [tracking: ${acct.name}]` : '';
  return `  ${g.name} (${g.type}): $${g.current_amount.toLocaleString()} / $${g.target_amount.toLocaleString()} (${g.progress.toFixed(1)}%)${acctLabel}`;
}).join('\n');
```

Here `accounts` refers to the `getAccountBreakdown()` result already available at line 86.

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add src/app/api/advisor/route.ts
git commit -m "feat(advisor): show linked account names in goals context"
```

---

### Task 7: End-to-end smoke test

**Step 1: Start the dev server**

Run: `npm run dev`

**Step 2: Test via advisor chat**

Send message: "I want to set up an emergency fund goal of $13,500. Track it against my savings account."

Verify:
- Advisor calls `manage_goals` with action `create`
- Goal appears in `/goals` page with linked account
- Progress bar shows current savings account balance

**Step 3: Test goal update via advisor**

Send message: "Update my emergency fund target to $15,000."

Verify:
- Advisor calls `manage_goals` with action `update`
- Goal target updates in `/goals` page

**Step 4: Final commit if any fixes needed**
