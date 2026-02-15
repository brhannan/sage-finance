# Design: `manage_goals` Advisor Tool

## Problem

The advisor can see financial goals in its system prompt but has no tool to create or update them. In the conversation where the user paid off their car and wanted to set up savings targets, the advisor had to fake it — saving goals as profile text instead of actual goal records.

## Solution

Add a `manage_goals` tool to the advisor that creates and updates goals in the existing `goals` table, with optional account-linking for automatic progress tracking.

## Changes

### 1. Schema: Add `account_id` to goals table

Add an optional `account_id INTEGER REFERENCES accounts(id)` column to the `goals` table. When set, `current_amount` is auto-resolved from the latest balance snapshot for that account.

Migration: `ALTER TABLE goals ADD COLUMN account_id INTEGER REFERENCES accounts(id);`

### 2. Advisor tool: `manage_goals`

Single tool with `action` parameter supporting `create` and `update`.

**Create action inputs:**
- `name` (string, required) — e.g. "Emergency Fund"
- `type` (enum, required) — `fi`, `home_purchase`, `savings`, `debt_payoff`, `custom`
- `target_amount` (number, required)
- `current_amount` (number, optional, default 0)
- `target_date` (string YYYY-MM-DD, optional)
- `description` (string, optional)
- `account_id` (number, optional) — link to account for auto-tracking

**Update action inputs:**
- `goal_id` (number, required)
- `current_amount` (number, optional)
- `target_amount` (number, optional)
- `target_date` (string, optional)
- `is_active` (boolean, optional)

Handler inserts/updates directly in the DB and returns the goal with progress percentage.

### 3. Auto-resolve `current_amount` from linked accounts

When a goal has `account_id` set, two places resolve `current_amount` from the latest balance snapshot instead of using the static column:

- **`getGoalProgress()`** in `src/lib/metrics.ts` — feeds the advisor's system prompt
- **Goals API GET** (`/api/goals/route.ts`) — feeds the Goals page

Goals without `account_id` continue using the static `current_amount` value.

### 4. Goals page updates

- Show linked account name on account-linked goal cards
- Add optional Account dropdown to the add/edit dialog (populated from `/api/accounts`)
- No other UI changes — existing progress bars, badges, and layout work as-is

### 5. Advisor system prompt update

Add instruction: "When the user wants to set financial goals or track progress toward a target, use the manage_goals tool. Link goals to accounts when possible so progress updates automatically."

## Files to modify

- `src/lib/db.ts` — migration to add `account_id` column
- `src/app/api/advisor/route.ts` — add `manage_goals` tool definition and handler
- `src/lib/metrics.ts` — update `getGoalProgress()` to join against balances for account-linked goals
- `src/app/api/goals/route.ts` — update GET to resolve current_amount from balances
- `src/app/api/goals/[id]/route.ts` — update PUT to accept `account_id`
- `src/app/goals/page.tsx` — add account dropdown and linked account display
