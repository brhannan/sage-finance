#!/usr/bin/env npx tsx
// Transforms promptfoo's raw output into a timestamped dashboard-friendly JSON
// and updates the results-index.json manifest.
//
// Usage: npx tsx evals/scripts/collect-results.ts [path-to-promptfoo-output.json]
// Default input: evals/results/latest.json

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const RESULTS_DIR = resolve(__dirname, '../results');
const INDEX_PATH = join(RESULTS_DIR, 'results-index.json');

interface PromptfooResult {
  results: {
    results: Array<{
      vars: Record<string, string>;
      response?: { output: string };
      success: boolean;
      score: number;
      namedScores?: Record<string, number>;
      gradingResult?: {
        pass: boolean;
        score: number;
        reason: string;
        componentResults?: Array<{
          pass: boolean;
          score: number;
          reason: string;
          namedScores?: Record<string, number>;
        }>;
      };
      cost?: number;
      latencyMs?: number;
      provider?: { id: string; label: string };
    }>;
    stats: {
      successes: number;
      failures: number;
      errors: number;
      tokenUsage?: {
        total: number;
        prompt: number;
        completion: number;
      };
    };
  };
  config: {
    scenarios?: Array<{ description: string }>;
  };
}

interface DashboardResult {
  timestamp: string;
  overall: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  };
  scenarios: Array<{
    name: string;
    total: number;
    passed: number;
    failed: number;
    passRate: number;
  }>;
  byType: {
    regression: { total: number; passed: number; passRate: number };
    capability: { total: number; passed: number; passRate: number };
  };
  testCases: Array<{
    message: string;
    testType: string;
    passed: boolean;
    score: number;
    reason: string;
  }>;
  cost: number;
  model: string;
}

function main() {
  const inputPath = process.argv[2] || join(RESULTS_DIR, 'latest.json');

  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const raw: PromptfooResult = JSON.parse(readFileSync(inputPath, 'utf-8'));
  const results = raw.results?.results || [];

  const timestamp = new Date().toISOString();

  // Build test case details
  const testCases = results.map((r) => ({
    message: r.vars?.message || '(unknown)',
    testType: r.vars?.testType || 'unknown',
    passed: r.success,
    score: r.gradingResult?.score ?? r.score ?? 0,
    reason: r.gradingResult?.reason || '',
  }));

  const passed = testCases.filter((tc) => tc.passed).length;
  const failed = testCases.filter((tc) => !tc.passed).length;

  // Split by test type
  const regression = testCases.filter((tc) => tc.testType === 'regression');
  const capability = testCases.filter((tc) => tc.testType === 'capability');

  // Infer scenarios from dataset structure (first 15 = tool selection, rest = financial reasoning)
  // This is approximate; a more robust approach would use scenario metadata
  const scenarios = [
    {
      name: 'Tool Selection Accuracy',
      cases: testCases.filter((tc) =>
        results.find(
          (r) => r.vars?.message === tc.message && r.vars?.expectedTools !== undefined
        )
      ),
    },
    {
      name: 'Financial Reasoning',
      cases: testCases.filter((tc) =>
        results.find(
          (r) => r.vars?.message === tc.message && r.vars?.expectedTools === undefined
        )
      ),
    },
  ];

  // Sum cost from all results
  let totalCost = 0;
  for (const r of results) {
    if (r.cost) totalCost += r.cost;
    // Also try to extract from response output
    try {
      const parsed = JSON.parse(r.response?.output || '{}');
      if (parsed.cost) totalCost += parsed.cost;
    } catch {}
  }

  // Detect model
  let model = 'unknown';
  try {
    const firstOutput = JSON.parse(results[0]?.response?.output || '{}');
    model = firstOutput.model || 'unknown';
  } catch {}

  const dashboardResult: DashboardResult = {
    timestamp,
    overall: {
      total: testCases.length,
      passed,
      failed,
      passRate: testCases.length > 0 ? Math.round((passed / testCases.length) * 100) : 0,
    },
    scenarios: scenarios.map((s) => ({
      name: s.name,
      total: s.cases.length,
      passed: s.cases.filter((c) => c.passed).length,
      failed: s.cases.filter((c) => !c.passed).length,
      passRate:
        s.cases.length > 0
          ? Math.round((s.cases.filter((c) => c.passed).length / s.cases.length) * 100)
          : 0,
    })),
    byType: {
      regression: {
        total: regression.length,
        passed: regression.filter((tc) => tc.passed).length,
        passRate:
          regression.length > 0
            ? Math.round(
                (regression.filter((tc) => tc.passed).length / regression.length) * 100
              )
            : 0,
      },
      capability: {
        total: capability.length,
        passed: capability.filter((tc) => tc.passed).length,
        passRate:
          capability.length > 0
            ? Math.round(
                (capability.filter((tc) => tc.passed).length / capability.length) * 100
              )
            : 0,
      },
    },
    testCases,
    cost: Math.round(totalCost * 10000) / 10000,
    model,
  };

  // Write timestamped result
  const filename = `result-${timestamp.replace(/[:.]/g, '-')}.json`;
  const outputPath = join(RESULTS_DIR, filename);
  writeFileSync(outputPath, JSON.stringify(dashboardResult, null, 2));
  console.log(`Wrote: ${outputPath}`);

  // Update manifest
  let index: string[] = [];
  if (existsSync(INDEX_PATH)) {
    try {
      index = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
    } catch {}
  }
  index.push(filename);
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`Updated index: ${INDEX_PATH} (${index.length} entries)`);
}

main();
