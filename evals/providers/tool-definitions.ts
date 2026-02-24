// Tool schemas extracted verbatim from src/app/api/advisor/route.ts (lines 304-389)
// Keep in sync with the advisor route when tools change.

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const advisorTools: ToolDefinition[] = [
  {
    name: 'save_profile',
    description:
      'Save or update user profile information. Call this whenever the user shares personal or financial details like age, location, income, job title, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        entries: {
          type: 'object',
          description:
            'Key-value pairs to save. Keys should be snake_case (e.g., age, location, total_comp, expected_bonus, occupation, filing_status, risk_tolerance, financial_goals)',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['entries'],
    },
  },
  {
    name: 'search_transactions',
    description:
      "Search the user's full transaction history. Use this to look up specific charges, find transactions in past months, investigate unusual spending, or answer questions about historical transactions. Returns up to 20 matching transactions.",
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: {
          type: 'string',
          description: 'Start date (YYYY-MM-DD). Defaults to 1 year ago if not specified.',
        },
        date_to: {
          type: 'string',
          description: 'End date (YYYY-MM-DD). Defaults to today if not specified.',
        },
        min_amount: { type: 'number', description: 'Minimum absolute amount to filter by' },
        max_amount: { type: 'number', description: 'Maximum absolute amount to filter by' },
        description: {
          type: 'string',
          description:
            'Search term to match against transaction descriptions (partial match, case-insensitive)',
        },
        category: { type: 'string', description: 'Category name to filter by (exact match)' },
        account: { type: 'string', description: 'Account name to filter by (partial match)' },
        type: {
          type: 'string',
          enum: ['expense', 'income'],
          description: 'Transaction type filter',
        },
      },
      required: [],
    },
  },
  {
    name: 'save_spending_event',
    description:
      "Save a named spending event when the user explains unusual spending. This stores the explanation so the system won't ask about it again.",
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description:
            'Short descriptive name for the event (e.g., "Ski trip to Vail", "New apartment furniture")',
        },
        category: { type: 'string', description: 'Spending category this event falls under' },
        description: { type: 'string', description: 'Brief description of the event' },
        date_start: { type: 'string', description: 'Start date (YYYY-MM-DD format)' },
        date_end: { type: 'string', description: 'End date (YYYY-MM-DD format)' },
        total_amount: { type: 'number', description: 'Total amount spent on this event' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization',
        },
        transaction_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'IDs of related transactions to link',
        },
      },
      required: ['name', 'category'],
    },
  },
  {
    name: 'save_followup',
    description:
      "Save an important follow-up question to ask the user later. Use this when you ask the user a question about their finances that they haven't answered yet — especially about account details, contribution amounts, employer benefits, insurance, or other information that would improve your advice. The question will appear in your context in future conversations so you can circle back to it.",
    input_schema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'The follow-up question you want to ask later',
        },
        context: {
          type: 'string',
          description:
            'Brief context for why this question matters (e.g., "Need to know HSA contribution to calculate true savings rate")',
        },
        category: {
          type: 'string',
          description:
            'Topic category (e.g., "retirement", "insurance", "taxes", "savings", "benefits")',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'manage_goals',
    description:
      'Create or update financial goals. Use this when the user wants to set savings targets, track debt payoff, plan for a home purchase, or establish any financial milestone. Link goals to accounts when possible so progress updates automatically from balance snapshots.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update'],
          description: 'Whether to create a new goal or update an existing one',
        },
        name: {
          type: 'string',
          description: 'Goal name (e.g., "Emergency Fund"). Required for create.',
        },
        type: {
          type: 'string',
          enum: ['fi', 'home_purchase', 'savings', 'debt_payoff', 'custom'],
          description: 'Goal type. Required for create.',
        },
        target_amount: {
          type: 'number',
          description: 'Target dollar amount. Required for create.',
        },
        current_amount: {
          type: 'number',
          description: 'Current progress amount (default 0). Not needed if linking to an account.',
        },
        target_date: { type: 'string', description: 'Target completion date (YYYY-MM-DD)' },
        description: { type: 'string', description: 'Brief description of the goal' },
        account_id: {
          type: 'number',
          description:
            'Link to an account ID for automatic progress tracking from balance snapshots.',
        },
        goal_id: {
          type: 'number',
          description: 'ID of the goal to update. Required for update.',
        },
        is_active: {
          type: 'boolean',
          description: 'Set to false to deactivate a completed or abandoned goal',
        },
      },
      required: ['action'],
    },
  },
];
