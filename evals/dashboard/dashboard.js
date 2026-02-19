// ============================================
// EVAL OBSERVATORY — Dashboard Logic
// ============================================

const RESULTS_BASE = '../results';
const CHART_COLORS = {
  cyan: '#3dd8d8',
  cyanFade: 'rgba(61, 216, 216, 0.08)',
  green: '#34d399',
  greenFade: 'rgba(52, 211, 153, 0.08)',
  red: '#f87171',
  purple: '#a78bfa',
  purpleFade: 'rgba(167, 139, 250, 0.08)',
  amber: '#fbbf24',
  amberFade: 'rgba(251, 191, 36, 0.08)',
  muted: '#555f78',
  grid: 'rgba(255,255,255,0.04)',
  gridBorder: 'rgba(255,255,255,0.06)',
};

// Sample data for when no results exist yet
const SAMPLE_DATA = [
  {
    timestamp: new Date(Date.now() - 3 * 86400000).toISOString(),
    overall: { total: 28, passed: 20, failed: 8, passRate: 71 },
    scenarios: [
      { name: 'Tool Selection Accuracy', total: 15, passed: 12, failed: 3, passRate: 80 },
      { name: 'Financial Reasoning', total: 13, passed: 8, failed: 5, passRate: 62 },
    ],
    byType: {
      regression: { total: 12, passed: 11, passRate: 92 },
      capability: { total: 16, passed: 9, passRate: 56 },
    },
    testCases: [
      { message: "I'm 32 years old and I live in Denver", testType: 'regression', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [save_profile]' },
      { message: 'My total compensation is $180k base plus $20k bonus', testType: 'regression', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [save_profile]' },
      { message: 'What did I spend at Amazon last month?', testType: 'regression', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [search_transactions]' },
      { message: 'Show me my restaurant spending in December', testType: 'regression', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [search_transactions]' },
      { message: 'I want to save $30,000 for a house down payment by 2028', testType: 'regression', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [manage_goals]' },
      { message: 'Update my emergency fund goal to $30,000', testType: 'regression', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [manage_goals]' },
      { message: 'That $450 charge was for a ski trip to Vail last weekend', testType: 'regression', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [save_spending_event]' },
      { message: "What's my net worth?", testType: 'regression', passed: true, score: 0.92, reason: '11/12 cited numbers are grounded (92%).' },
      { message: 'How much am I saving each month?', testType: 'regression', passed: true, score: 0.88, reason: '7/8 cited numbers are grounded (88%).' },
      { message: 'Am I on track for my emergency fund goal?', testType: 'regression', passed: true, score: 0.95, reason: '19/20 cited numbers are grounded (95%).' },
      { message: 'How does my spending break down this month?', testType: 'regression', passed: true, score: 0.85, reason: '17/20 cited numbers are grounded (85%).' },
      { message: "What's my savings rate?", testType: 'regression', passed: false, score: 0.6, reason: 'Used partial current month rate instead of trailing.' },
      { message: 'I just got promoted and my new salary is $160k', testType: 'capability', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [save_profile]' },
      { message: 'Can you look up any charges over $200 from the past 3 months?', testType: 'capability', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [search_transactions]' },
      { message: 'How much have I been spending on gas?', testType: 'capability', passed: false, score: 0, reason: 'Expected [search_transactions] but called: []' },
      { message: "I'm wondering if I should increase my 401k contribution", testType: 'capability', passed: true, score: 1, reason: 'Correctly made no tool calls.' },
      { message: 'The holiday gifts in December were about $600 total', testType: 'capability', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [save_spending_event]' },
      { message: "I'm getting married next year and want to save $25k", testType: 'capability', passed: true, score: 1, reason: 'Called 1/1 expected tools. Called: [manage_goals]' },
      { message: 'Do you have any follow-up questions about my HSA?', testType: 'capability', passed: false, score: 0, reason: 'Expected no tool calls but called: [save_followup]' },
      { message: 'Should I pay off my credit cards or invest more?', testType: 'capability', passed: true, score: 0.82, reason: '9/11 cited numbers are grounded (82%).' },
      { message: 'Can I afford a $500K house?', testType: 'capability', passed: false, score: 0.55, reason: 'Fabricated mortgage rate. 6/11 grounded (55%).' },
      { message: 'My December spending was way higher than usual', testType: 'capability', passed: true, score: 0.9, reason: '9/10 cited numbers are grounded (90%).' },
      { message: 'How long until I reach FI?', testType: 'capability', passed: false, score: 0.5, reason: 'Gave specific date without stating assumptions.' },
      { message: 'I got a $5,000 bonus. What should I do with it?', testType: 'capability', passed: true, score: 0.85, reason: '11/13 cited numbers are grounded (85%).' },
      { message: 'Is my 401k contribution rate good enough?', testType: 'capability', passed: false, score: 0.7, reason: 'Cited 15% contribution rate but actual is 10%.' },
      { message: 'Compare my spending this month to last month', testType: 'capability', passed: false, score: 0.45, reason: 'Compared partial Feb as complete month.' },
      { message: 'What are my biggest financial risks?', testType: 'capability', passed: true, score: 0.88, reason: '7/8 cited numbers are grounded (88%).' },
      { message: "What's my savings rate?", testType: 'capability', passed: false, score: 0, reason: 'Expected no tool calls but called: [search_transactions]' },
    ],
    cost: 0.08,
    model: 'claude-haiku-4-5-20251001',
  },
  {
    timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
    overall: { total: 28, passed: 22, failed: 6, passRate: 79 },
    scenarios: [
      { name: 'Tool Selection Accuracy', total: 15, passed: 13, failed: 2, passRate: 87 },
      { name: 'Financial Reasoning', total: 13, passed: 9, failed: 4, passRate: 69 },
    ],
    byType: {
      regression: { total: 12, passed: 12, passRate: 100 },
      capability: { total: 16, passed: 10, passRate: 63 },
    },
    testCases: [],
    cost: 0.07,
    model: 'claude-haiku-4-5-20251001',
  },
  {
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    overall: { total: 28, passed: 24, failed: 4, passRate: 86 },
    scenarios: [
      { name: 'Tool Selection Accuracy', total: 15, passed: 14, failed: 1, passRate: 93 },
      { name: 'Financial Reasoning', total: 13, passed: 10, failed: 3, passRate: 77 },
    ],
    byType: {
      regression: { total: 12, passed: 12, passRate: 100 },
      capability: { total: 16, passed: 12, passRate: 75 },
    },
    testCases: [],
    cost: 0.09,
    model: 'claude-haiku-4-5-20251001',
  },
];

// ---- State ----
let allResults = [];
let charts = {};
let currentFilter = 'all';

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  allResults = await loadResults();
  renderSummaryCards();
  renderCharts();
  renderTable();
  setupFilters();
  updateTopbar();
});

// ---- Data Loading ----
async function loadResults() {
  try {
    const indexResp = await fetch(`${RESULTS_BASE}/results-index.json`);
    if (!indexResp.ok) throw new Error('No index');
    const filenames = await indexResp.json();
    if (!filenames.length) throw new Error('Empty index');

    const results = await Promise.all(
      filenames.map(async (f) => {
        try {
          const r = await fetch(`${RESULTS_BASE}/${f}`);
          return r.ok ? r.json() : null;
        } catch { return null; }
      })
    );

    const valid = results.filter(Boolean);
    if (valid.length === 0) throw new Error('No valid results');

    // Sort by timestamp
    valid.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return valid;
  } catch {
    console.info('Using sample data (no results found in ../results/)');
    return SAMPLE_DATA;
  }
}

// ---- Summary Cards ----
function renderSummaryCards() {
  const latest = allResults[allResults.length - 1];
  if (!latest) return;

  document.getElementById('card-total').textContent = latest.overall.total;
  document.getElementById('card-total-sub').textContent =
    `${latest.overall.passed} passed, ${latest.overall.failed} failed`;

  document.getElementById('card-pass').textContent = `${latest.overall.passRate}%`;
  animateBar('card-pass-bar', latest.overall.passRate);

  document.getElementById('card-regression').textContent = `${latest.byType.regression.passRate}%`;
  animateBar('card-regression-bar', latest.byType.regression.passRate);

  document.getElementById('card-capability').textContent = `${latest.byType.capability.passRate}%`;
  animateBar('card-capability-bar', latest.byType.capability.passRate);

  const cumCost = allResults.reduce((sum, r) => sum + (r.cost || 0), 0);
  document.getElementById('card-cost').textContent = `$${cumCost.toFixed(2)}`;
  document.getElementById('card-cost-sub').textContent =
    `~$${(latest.cost || 0).toFixed(3)}/run`;
}

function animateBar(id, pct) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.getElementById(id).style.width = `${Math.min(100, pct)}%`;
    }, 300);
  });
}

// ---- Charts ----
function renderCharts() {
  Chart.defaults.color = CHART_COLORS.muted;
  Chart.defaults.borderColor = CHART_COLORS.grid;
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 10;

  const labels = allResults.map((r) => formatDate(r.timestamp));
  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1c2030',
        borderColor: '#252a3a',
        borderWidth: 1,
        titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 10 },
        padding: 8,
        cornerRadius: 4,
      },
    },
    scales: {
      x: {
        grid: { color: CHART_COLORS.grid, drawBorder: false },
        ticks: { maxRotation: 0 },
      },
      y: {
        min: 0,
        max: 100,
        grid: { color: CHART_COLORS.grid, drawBorder: false },
        ticks: { callback: (v) => `${v}%`, stepSize: 25 },
      },
    },
    elements: {
      point: { radius: 3, hoverRadius: 5, borderWidth: 2 },
      line: { tension: 0.3, borderWidth: 2 },
    },
  };

  // Pass Rate Over Time
  charts.passrate = new Chart(document.getElementById('chart-passrate'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Pass Rate',
        data: allResults.map((r) => r.overall.passRate),
        borderColor: CHART_COLORS.cyan,
        backgroundColor: CHART_COLORS.cyanFade,
        fill: true,
        pointBackgroundColor: CHART_COLORS.cyan,
      }],
    },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        legend: { display: false },
      },
    },
  });

  // Scenarios
  const scenarioNames = [...new Set(allResults.flatMap((r) => (r.scenarios || []).map((s) => s.name)))];
  const scenarioColors = [CHART_COLORS.cyan, CHART_COLORS.amber, CHART_COLORS.purple, CHART_COLORS.green];

  charts.scenarios = new Chart(document.getElementById('chart-scenarios'), {
    type: 'line',
    data: {
      labels,
      datasets: scenarioNames.map((name, i) => ({
        label: name,
        data: allResults.map((r) => {
          const s = (r.scenarios || []).find((sc) => sc.name === name);
          return s ? s.passRate : null;
        }),
        borderColor: scenarioColors[i % scenarioColors.length],
        backgroundColor: 'transparent',
        pointBackgroundColor: scenarioColors[i % scenarioColors.length],
      })),
    },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 9 } },
        },
      },
    },
  });

  // Regression vs Capability
  charts.types = new Chart(document.getElementById('chart-types'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Regression',
          data: allResults.map((r) => r.byType?.regression?.passRate ?? null),
          borderColor: CHART_COLORS.purple,
          backgroundColor: CHART_COLORS.purpleFade,
          fill: true,
          pointBackgroundColor: CHART_COLORS.purple,
        },
        {
          label: 'Capability',
          data: allResults.map((r) => r.byType?.capability?.passRate ?? null),
          borderColor: CHART_COLORS.amber,
          backgroundColor: CHART_COLORS.amberFade,
          fill: true,
          pointBackgroundColor: CHART_COLORS.amber,
        },
      ],
    },
    options: {
      ...baseOpts,
      plugins: {
        ...baseOpts.plugins,
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 9 } },
        },
      },
    },
  });

  // Cost
  let cumCost = 0;
  const costData = allResults.map((r) => {
    cumCost += r.cost || 0;
    return Math.round(cumCost * 100) / 100;
  });

  charts.cost = new Chart(document.getElementById('chart-cost'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cumulative Cost',
        data: costData,
        borderColor: CHART_COLORS.muted,
        backgroundColor: 'rgba(85, 95, 120, 0.06)',
        fill: true,
        pointBackgroundColor: CHART_COLORS.muted,
      }],
    },
    options: {
      ...baseOpts,
      scales: {
        ...baseOpts.scales,
        y: {
          ...baseOpts.scales.y,
          min: undefined,
          max: undefined,
          ticks: { callback: (v) => `$${v.toFixed(2)}`, stepSize: undefined },
        },
      },
    },
  });
}

// ---- Table ----
function renderTable() {
  const latest = allResults[allResults.length - 1];
  if (!latest || !latest.testCases?.length) {
    document.getElementById('results-body').innerHTML =
      '<tr><td colspan="5" class="empty-state">No test case details in latest run.</td></tr>';
    return;
  }

  document.getElementById('table-run-label').textContent = formatDate(latest.timestamp);

  const filtered = latest.testCases.filter((tc) => {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'failed') return !tc.passed;
    return tc.testType === currentFilter;
  });

  const tbody = document.getElementById('results-body');
  tbody.innerHTML = filtered
    .map(
      (tc) => `
    <tr>
      <td><span class="status-icon ${tc.passed ? 'pass' : 'fail'}">${tc.passed ? '\u2713' : '\u2717'}</span></td>
      <td><span class="message-text" title="${escapeHtml(tc.message)}">${escapeHtml(tc.message)}</span></td>
      <td><span class="type-badge ${tc.testType}">${tc.testType}</span></td>
      <td>
        <div class="score-cell">
          <div class="score-bar-track">
            <div class="score-bar-value ${tc.score >= 0.8 ? 'high' : tc.score >= 0.5 ? 'mid' : 'low'}"
                 style="width: ${Math.round(tc.score * 100)}%"></div>
          </div>
          <span class="score-number">${(tc.score * 100).toFixed(0)}%</span>
        </div>
      </td>
      <td><span class="reason-text" onclick="this.classList.toggle('expanded')">${escapeHtml(tc.reason || '—')}</span></td>
    </tr>`
    )
    .join('');

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No matching test cases.</td></tr>';
  }
}

// ---- Filters ----
function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelector('.filter-btn.active')?.classList.remove('active');
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTable();
    });
  });
}

// ---- Topbar ----
function updateTopbar() {
  const latest = allResults[allResults.length - 1];
  if (!latest) return;

  document.getElementById('model-badge').textContent = latest.model || '—';
  document.getElementById('last-run').textContent = formatDateTime(latest.timestamp);

  const dot = document.getElementById('status-dot');
  if (latest.byType?.regression?.passRate === 100) {
    dot.className = 'status-dot ok';
  } else if (latest.overall.passRate >= 70) {
    dot.className = 'status-dot warn';
  } else {
    dot.className = 'status-dot fail';
  }
}

// ---- Helpers ----
function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
