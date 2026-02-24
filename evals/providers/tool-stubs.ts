// Canned tool results for eval determinism.
// Returns realistic responses without needing a database.

export function getToolStubResult(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case 'save_profile':
      return 'Profile updated.';

    case 'search_transactions':
      return getSearchTransactionsResult(input);

    case 'save_spending_event': {
      const name = (input.name as string) || 'Event';
      const txnIds = input.transaction_ids as number[] | undefined;
      return `Spending event "${name}" saved successfully${txnIds?.length ? ` with ${txnIds.length} linked transactions` : ''}.`;
    }

    case 'save_followup': {
      const question = (input.question as string) || 'Follow-up';
      return `Follow-up question saved: "${question}"`;
    }

    case 'manage_goals':
      return getManageGoalsResult(input);

    default:
      return `Unknown tool: ${toolName}`;
  }
}

function getSearchTransactionsResult(input: Record<string, unknown>): string {
  const description = ((input.description as string) || '').toLowerCase();
  const category = ((input.category as string) || '').toLowerCase();

  // Amazon transactions
  if (description.includes('amazon')) {
    return `Found 5 transaction(s):
  ID:201 | 2026-01-28 | $89.99 | Amazon.com - Electronics | Shopping | Chase Sapphire | expense
  ID:198 | 2026-01-22 | $34.50 | Amazon.com - Household | Shopping | Chase Sapphire | expense
  ID:185 | 2026-01-15 | $125.00 | Amazon.com - Kitchen | Shopping | Chase Sapphire | expense
  ID:172 | 2026-01-08 | $22.99 | Amazon.com - Books | Shopping | Chase Sapphire | expense
  ID:156 | 2026-01-02 | $67.50 | Amazon.com - Office | Shopping | Chase Sapphire | expense`;
  }

  // Restaurant transactions
  if (description.includes('restaurant') || category.includes('dining') || category.includes('restaurant')) {
    return `Found 6 transaction(s):
  ID:205 | 2026-01-30 | $78.50 | Sushi Den | Dining & Restaurants | Chase Sapphire | expense
  ID:195 | 2026-01-24 | $45.00 | Chipotle | Dining & Restaurants | Chase Sapphire | expense
  ID:188 | 2026-01-18 | $92.00 | Guard and Grace | Dining & Restaurants | Chase Sapphire | expense
  ID:175 | 2026-01-11 | $32.50 | Illegal Pete's | Dining & Restaurants | Chase Sapphire | expense
  ID:162 | 2026-01-05 | $55.00 | Mercantile Dining | Dining & Restaurants | Chase Sapphire | expense
  ID:148 | 2025-12-28 | $120.00 | Tavernetta | Dining & Restaurants | Chase Sapphire | expense`;
  }

  // Gas transactions
  if (description.includes('gas') || category.includes('gas') || category.includes('fuel') || category.includes('auto')) {
    return `Found 4 transaction(s):
  ID:199 | 2026-01-25 | $52.00 | Shell Gas Station | Auto & Gas | Wells Fargo Checking | expense
  ID:180 | 2026-01-12 | $48.50 | Costco Gas | Auto & Gas | Wells Fargo Checking | expense
  ID:160 | 2025-12-30 | $55.00 | King Soopers Fuel | Auto & Gas | Wells Fargo Checking | expense
  ID:140 | 2025-12-15 | $50.00 | Shell Gas Station | Auto & Gas | Wells Fargo Checking | expense`;
  }

  // Large transactions (min_amount filter)
  if ((input.min_amount as number) >= 200) {
    return `Found 3 transaction(s):
  ID:210 | 2026-01-28 | $450.00 | REI - Ski Equipment | Shopping | Chase Sapphire | expense
  ID:188 | 2026-01-15 | $350.00 | United Airlines | Travel | Chase Sapphire | expense
  ID:170 | 2026-01-05 | $275.00 | Costco Wholesale | Groceries | Wells Fargo Checking | expense`;
  }

  // Generic fallback
  return `Found 8 transaction(s):
  ID:205 | 2026-01-30 | $78.50 | Sushi Den | Dining & Restaurants | Chase Sapphire | expense
  ID:201 | 2026-01-28 | $89.99 | Amazon.com | Shopping | Chase Sapphire | expense
  ID:199 | 2026-01-25 | $52.00 | Shell Gas Station | Auto & Gas | Wells Fargo Checking | expense
  ID:195 | 2026-01-22 | $156.00 | King Soopers | Groceries | Wells Fargo Checking | expense
  ID:190 | 2026-01-19 | $45.00 | Netflix + Spotify | Subscriptions | Chase Sapphire | expense
  ID:185 | 2026-01-15 | $125.00 | Xcel Energy | Utilities | Wells Fargo Checking | expense
  ID:180 | 2026-01-12 | $85.00 | Target | Shopping | Chase Sapphire | expense
  ID:175 | 2026-01-08 | $32.50 | Illegal Pete's | Dining & Restaurants | Chase Sapphire | expense`;
}

function getManageGoalsResult(input: Record<string, unknown>): string {
  const action = input.action as string;

  if (action === 'create') {
    const name = (input.name as string) || 'New Goal';
    const target = (input.target_amount as number) || 0;
    const current = (input.current_amount as number) || 0;
    const progress = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const linked = input.account_id ? ' — linked to account for auto-tracking' : '';
    return `Goal "${name}" created (ID: 5). Current: $${current.toLocaleString()} / $${target.toLocaleString()} (${progress.toFixed(1)}% complete)${linked}.`;
  }

  if (action === 'update') {
    const goalId = input.goal_id as number;
    if (!goalId) return 'Error: goal_id is required for updating a goal.';
    const target = (input.target_amount as number) || 25000;
    const name = (input.name as string) || 'Emergency Fund';
    return `Goal "${name}" updated. Current: $24,000 / $${target.toLocaleString()} (${((24000 / target) * 100).toFixed(1)}% complete).`;
  }

  return 'Error: action must be "create" or "update".';
}
