"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface NetWorthData {
  total: number;
  assets: number;
  liabilities: number;
  history: Array<{ date: string; assets: number; liabilities: number; netWorth: number }>;
}

interface SavingsRateData {
  rate: number;
  income: number;
  expenses: number;
}

interface GoalData {
  id: number;
  name: string;
  type: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  progress: number;
}

interface IncomeExpenseTrendItem {
  month: string;
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
}

interface InsightsData {
  summary: string;
  going_well: string[];
  to_improve: string[];
  detailed_report?: string;
}

interface ActionItem {
  id: number;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

interface Category {
  id: number;
  name: string;
}

interface Account {
  id: number;
  name: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export default function HomePage() {
  const [netWorth, setNetWorth] = useState<NetWorthData | null>(null);
  const [savingsRate, setSavingsRate] = useState<SavingsRateData | null>(null);
  const [trailingSavingsRate, setTrailingSavingsRate] =
    useState<SavingsRateData | null>(null);
  const [incomeExpenseTrend, setIncomeExpenseTrend] = useState<IncomeExpenseTrendItem[]>([]);
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [pendingQuestionCount, setPendingQuestionCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [chartOpen, setChartOpen] = useState(false);
  const [netWorthChartOpen, setNetWorthChartOpen] = useState(false);

  // Quick-add transaction state
  const [addOpen, setAddOpen] = useState(false);
  const [txForm, setTxForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "",
    amount: "",
    type: "expense",
    category_id: "",
    account_id: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [metricsRes, aiRes, catRes, acctRes] =
        await Promise.all([
          fetch("/api/metrics"),
          fetch("/api/action-items?status=pending&limit=5"),
          fetch("/api/categories"),
          fetch("/api/accounts"),
        ]);

      if (metricsRes.ok) {
        const m = await metricsRes.json();
        setNetWorth(m.netWorth);
        setSavingsRate(m.savingsRate);
        setTrailingSavingsRate(m.trailingSavingsRate);
        setGoals(Array.isArray(m.goalProgress) ? m.goalProgress.slice(0, 3) : []);
        setIncomeExpenseTrend(Array.isArray(m.incomeExpenseTrend) ? m.incomeExpenseTrend : []);
      }
      if (aiRes.ok) {
        const data = await aiRes.json();
        setActionItems(Array.isArray(data) ? data : []);
      }
      if (catRes.ok) setCategories(await catRes.json());
      if (acctRes.ok) setAccounts(await acctRes.json());
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Fetch insights separately so dashboard isn't blocked
    setInsightsLoading(true);
    fetch("/api/insights")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        setInsights(data);
        // After insights load, check for pending proactive questions
        fetch("/api/advisor/questions?status=pending")
          .then((res) => res.ok ? res.json() : [])
          .then((questions) => setPendingQuestionCount(Array.isArray(questions) ? questions.length : 0))
          .catch(() => {});
      })
      .catch(() => {})
      .finally(() => setInsightsLoading(false));
  }, [fetchData]);

  const handleAddTransaction = async () => {
    if (!txForm.date || !txForm.description || !txForm.amount) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...txForm,
          amount: parseFloat(txForm.amount),
          category_id: txForm.category_id
            ? Number(txForm.category_id)
            : undefined,
          account_id: txForm.account_id
            ? Number(txForm.account_id)
            : undefined,
        }),
      });
      if (res.ok) {
        setAddOpen(false);
        setTxForm({
          date: new Date().toISOString().slice(0, 10),
          description: "",
          amount: "",
          type: "expense",
          category_id: "",
          account_id: "",
          notes: "",
        });
        fetchData();
      }
    } catch (err) {
      console.error("Failed to add transaction:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const chartData = incomeExpenseTrend.map((d) => ({
    ...d,
    label: new Date(d.month + "-15").toLocaleString("en-US", { month: "short" }),
    negExpenses: -d.expenses,
  }));

  const netWorthChartData = (netWorth?.history ?? []).map((d) => ({
    ...d,
    label: new Date(d.date + "-15").toLocaleString("en-US", { month: "short" }),
    negLiabilities: -d.liabilities,
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-lg">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>+ Quick Add Transaction</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add Transaction</DialogTitle>
              <DialogDescription>
                Quickly add a new transaction to your records.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tx-date">Date</Label>
                  <Input
                    id="tx-date"
                    type="date"
                    value={txForm.date}
                    onChange={(e) =>
                      setTxForm({ ...txForm, date: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tx-type">Type</Label>
                  <Select
                    value={txForm.type}
                    onValueChange={(v) => setTxForm({ ...txForm, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-desc">Description</Label>
                <Input
                  id="tx-desc"
                  placeholder="Coffee at Starbucks..."
                  value={txForm.description}
                  onChange={(e) =>
                    setTxForm({ ...txForm, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tx-amount">Amount</Label>
                  <Input
                    id="tx-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={txForm.amount}
                    onChange={(e) =>
                      setTxForm({ ...txForm, amount: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tx-category">Category</Label>
                  <Select
                    value={txForm.category_id}
                    onValueChange={(v) =>
                      setTxForm({ ...txForm, category_id: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-detect" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-account">Account</Label>
                <Select
                  value={txForm.account_id}
                  onValueChange={(v) =>
                    setTxForm({ ...txForm, account_id: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-notes">Notes</Label>
                <Textarea
                  id="tx-notes"
                  placeholder="Optional notes..."
                  value={txForm.notes}
                  onChange={(e) =>
                    setTxForm({ ...txForm, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleAddTransaction} disabled={submitting}>
                {submitting ? "Adding..." : "Add Transaction"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Net Worth */}
        <Card className="relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardDescription>Net Worth</CardDescription>
            <CardTitle className="text-3xl">
              {netWorth ? fmt(netWorth.total) : "$--"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {netWorth && (
              <div className="flex justify-between text-sm text-muted-foreground mt-2">
                <span>Assets: {fmt(netWorth.assets)}</span>
                <span>Liabilities: {fmt(netWorth.liabilities)}</span>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Link
              href="/net-worth"
              className="text-sm text-primary hover:underline"
            >
              View details
            </Link>
          </CardFooter>
          {netWorthChartData.length > 1 && (
            <div
              className="absolute bottom-2 right-2 w-[100px] bg-white/60 backdrop-blur-sm rounded-md border border-white/40 p-1 cursor-pointer group hover:bg-white/80 transition-colors"
              onClick={() => setNetWorthChartOpen(true)}
            >
              <div className="h-[48px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={netWorthChartData}
                    margin={{ top: 1, right: 1, left: 1, bottom: 1 }}
                    barGap={-8}
                  >
                    <Bar dataKey="assets" fill="#6BAF8D" radius={[1, 1, 0, 0]} />
                    <Bar dataKey="negLiabilities" fill="#E8927C" radius={[0, 0, 1, 1]} />
                    <Line
                      type="monotone"
                      dataKey="netWorth"
                      stroke="#3B82F6"
                      strokeWidth={1}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </Card>

        {/* Savings Rate */}
        <Card className="relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardDescription>Savings Rate (This Month)</CardDescription>
            <CardTitle className="text-3xl">
              {savingsRate ? `${savingsRate.rate}%` : "--%"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {savingsRate && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>Income</span>
                  <span className="text-green-600">
                    {fmt(savingsRate.income)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Expenses</span>
                  <span className="text-red-600">
                    {fmt(savingsRate.expenses)}
                  </span>
                </div>
              </div>
            )}
            <Separator className="my-3" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Trailing 12-month</span>
              <span className="font-medium">
                {trailingSavingsRate ? `${trailingSavingsRate.rate}%` : "--%"}
              </span>
            </div>
          </CardContent>
          <CardFooter>
            <Link
              href="/spending"
              className="text-sm text-primary hover:underline"
            >
              View spending
            </Link>
          </CardFooter>
          {chartData.length > 0 && (
            <div
              className="absolute bottom-2 right-2 w-[100px] bg-white/60 backdrop-blur-sm rounded-md border border-white/40 p-1 cursor-pointer group hover:bg-white/80 transition-colors"
              onClick={() => setChartOpen(true)}
            >
              <div className="h-[48px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 1, right: 1, left: 1, bottom: 1 }}
                    barGap={-8}
                  >
                    <Bar dataKey="income" fill="#6BAF8D" radius={[1, 1, 0, 0]} />
                    <Bar dataKey="negExpenses" fill="#E8927C" radius={[0, 0, 1, 1]} />
                    <Line
                      type="monotone"
                      dataKey="savings"
                      stroke="#3B82F6"
                      strokeWidth={1}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </Card>

        {/* Goals */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Top Goals</CardDescription>
            <CardTitle className="text-lg">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active goals yet.{" "}
                <Link href="/goals" className="text-primary hover:underline">
                  Create one
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {goals.map((goal) => (
                  <div key={goal.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{goal.name}</span>
                      <span className="text-muted-foreground">
                        {Math.round(goal.progress)}%
                      </span>
                    </div>
                    <Progress value={goal.progress} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{fmt(goal.current_amount)}</span>
                      <span>{fmt(goal.target_amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Link
              href="/goals"
              className="text-sm text-primary hover:underline"
            >
              Manage goals
            </Link>
          </CardFooter>
        </Card>
      </div>

      {/* AI Insights */}
      <Card>
        <CardContent className="pt-4 pb-3">
          {insightsLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-4 bg-muted rounded w-2/3" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ) : insights ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-violet-500 shrink-0"
                >
                  <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
                </svg>
                <span className="text-sm font-medium text-foreground">Recent Trends</span>
              </div>
              <div className="flex items-start gap-2 pl-[22px]">
                <p className="text-sm text-foreground">{insights.summary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[22px] text-sm text-muted-foreground">
                {insights.going_well.map((item, i) => (
                  <span key={`g${i}`}>
                    <span className="text-green-500">&#x2713;</span> {item}
                  </span>
                ))}
                {insights.to_improve.map((item, i) => (
                  <span key={`i${i}`}>
                    <span className="text-amber-500">&#x25B8;</span> {item}
                  </span>
                ))}
                <Link
                  href="/insights"
                  className="text-violet-600 hover:text-violet-700 font-medium"
                >
                  Full report &rarr;
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Unable to load insights.{" "}
              <Link href="/advisor" className="text-primary hover:underline">
                Chat with your advisor
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Cashflow Chart Dialog */}
      <Dialog open={chartOpen} onOpenChange={setChartOpen}>
        <DialogContent className="sm:max-w-[750px] backdrop-blur-md border-white/50" style={{ background: "rgba(255,255,255,0.4)" }}>
          <DialogHeader>
            <DialogTitle>Income vs Expenses</DialogTitle>
          </DialogHeader>
          {chartData.length > 0 && (
            <div className="glass-chart h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 20, right: 12, left: 12, bottom: 0 }}
                  barSize={60}
                  barGap={-60}
                >
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#6B7280" }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#9CA3AF" }}
                    tickFormatter={(v: number) => {
                      if (v === 0) return "$0";
                      const abs = Math.abs(v);
                      const label = abs >= 1000 ? `$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k` : `$${abs}`;
                      return v < 0 ? `-${label}` : label;
                    }}
                    width={52}
                  />
                  <ReferenceLine y={0} stroke="#D1D5DB" strokeWidth={1} />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload as IncomeExpenseTrendItem & { label: string };
                      if (!d) return null;
                      return (
                        <div className="bg-white border rounded-lg shadow-sm px-3 py-2 text-sm">
                          <p className="font-medium mb-1">{d.label} {d.month.slice(0, 4)}</p>
                          <p className="text-muted-foreground">Income: <span className="text-[#6BAF8D]">{fmt(d.income)}</span></p>
                          <p className="text-muted-foreground">Expenses: <span className="text-[#E8927C]">{fmt(d.expenses)}</span></p>
                          <p className="text-muted-foreground">
                            Net: <span className={d.savings >= 0 ? "text-[#6BAF8D]" : "text-red-500"}>{fmt(d.savings)}</span>
                          </p>
                          {d.income > 0 && (
                            <p className="text-muted-foreground">Savings rate: <span className="text-foreground">{d.savingsRate}%</span></p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="income"
                    fill="#6BAF8D"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="negExpenses"
                    fill="#E8927C"
                    radius={[0, 0, 3, 3]}
                  />
                  <Line
                    type="monotone"
                    dataKey="savings"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#3B82F6", strokeWidth: 0 }}
                    label={({ x, y, index }: { x?: string | number; y?: string | number; index?: number }) => {
                      if (x == null || y == null || index == null) return null;
                      const d = incomeExpenseTrend[index];
                      if (!d || d.income <= 0) return null;
                      const nx = Number(x), ny = Number(y);
                      const fmtShort = (v: number) => {
                        const abs = Math.abs(v);
                        const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${Math.round(abs)}`;
                        return v < 0 ? `-${s}` : s;
                      };
                      return (
                        <text
                          x={nx}
                          y={ny - 10}
                          textAnchor="middle"
                          fontSize={11}
                          fill="#6B7280"
                        >
                          {fmtShort(d.savings)} ({d.savingsRate}%)
                        </text>
                      );
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Net Worth Chart Dialog */}
      <Dialog open={netWorthChartOpen} onOpenChange={setNetWorthChartOpen}>
        <DialogContent className="sm:max-w-[750px] backdrop-blur-md border-white/50" style={{ background: "rgba(255,255,255,0.4)" }}>
          <DialogHeader>
            <DialogTitle>Net Worth Over Time</DialogTitle>
          </DialogHeader>
          {netWorthChartData.length > 0 && (
            <div className="glass-chart h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={netWorthChartData}
                  margin={{ top: 20, right: 12, left: 12, bottom: 0 }}
                  barSize={60}
                  barGap={-60}
                >
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#6B7280" }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "#9CA3AF" }}
                    tickFormatter={(v: number) => {
                      if (v === 0) return "$0";
                      const abs = Math.abs(v);
                      const label = abs >= 1000 ? `$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k` : `$${abs}`;
                      return v < 0 ? `-${label}` : label;
                    }}
                    width={52}
                  />
                  <ReferenceLine y={0} stroke="#D1D5DB" strokeWidth={1} />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload as { label: string; date: string; assets: number; liabilities: number; netWorth: number };
                      if (!d) return null;
                      return (
                        <div className="bg-white border rounded-lg shadow-sm px-3 py-2 text-sm">
                          <p className="font-medium mb-1">{d.label} {d.date.slice(0, 4)}</p>
                          <p className="text-muted-foreground">Assets: <span className="text-[#6BAF8D]">{fmt(d.assets)}</span></p>
                          <p className="text-muted-foreground">Liabilities: <span className="text-[#E8927C]">{fmt(d.liabilities)}</span></p>
                          <p className="text-muted-foreground">
                            Net Worth: <span className={d.netWorth >= 0 ? "text-[#3B82F6]" : "text-red-500"}>{fmt(d.netWorth)}</span>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="assets"
                    fill="#6BAF8D"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="negLiabilities"
                    fill="#E8927C"
                    radius={[0, 0, 3, 3]}
                  />
                  <Line
                    type="monotone"
                    dataKey="netWorth"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#3B82F6", strokeWidth: 0 }}
                    label={({ x, y, index }: { x?: string | number; y?: string | number; index?: number }) => {
                      if (x == null || y == null || index == null) return null;
                      const d = netWorthChartData[index];
                      if (!d) return null;
                      const nx = Number(x), ny = Number(y);
                      const fmtShort = (v: number) => {
                        const abs = Math.abs(v);
                        const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${Math.round(abs)}`;
                        return v < 0 ? `-${s}` : s;
                      };
                      return (
                        <text
                          x={nx}
                          y={ny - 10}
                          textAnchor="middle"
                          fontSize={11}
                          fill="#6B7280"
                        >
                          {fmtShort(d.netWorth)}
                        </text>
                      );
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Action Items */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Action Items</CardTitle>
          <CardDescription>
            Recommendations from your AI advisor
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actionItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending action items.{" "}
              <Link href="/advisor" className="text-primary hover:underline">
                Chat with your advisor
              </Link>{" "}
              to get personalized recommendations.
            </p>
          ) : (
            <div className="space-y-3">
              {actionItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-lg border"
                >
                  <Badge
                    variant={
                      item.status === "pending" ? "default" : "secondary"
                    }
                    className="mt-0.5"
                  >
                    {item.status}
                  </Badge>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Link
            href="/advisor"
            className="text-sm text-primary hover:underline inline-flex items-center gap-2"
          >
            Open AI Advisor
            {pendingQuestionCount > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0.5 min-w-[20px] justify-center">
                {pendingQuestionCount}
              </Badge>
            )}
          </Link>
        </CardFooter>
      </Card>

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link href="/transactions">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="pt-6 text-center">
              <p className="font-medium">Transactions</p>
              <p className="text-sm text-muted-foreground">View & manage</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/import">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="pt-6 text-center">
              <p className="font-medium">Import</p>
              <p className="text-sm text-muted-foreground">CSV upload</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/fi-tracker">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="pt-6 text-center">
              <p className="font-medium">FI Tracker</p>
              <p className="text-sm text-muted-foreground">
                Financial independence
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/home-buying">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="pt-6 text-center">
              <p className="font-medium">Home Buying</p>
              <p className="text-sm text-muted-foreground">Readiness check</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
