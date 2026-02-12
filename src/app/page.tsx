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
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface NetWorthData {
  total: number;
  assets: number;
  liabilities: number;
  history: Array<{ date: string; amount: number }>;
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
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

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
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Net Worth</CardDescription>
            <CardTitle className="text-3xl">
              {netWorth ? fmt(netWorth.total) : "$--"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {netWorth && netWorth.history.length > 1 && (
              <div className="h-[60px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={netWorth.history}>
                    <Line
                      type="monotone"
                      dataKey="amount"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Tooltip
                      formatter={(value: number | undefined) => [fmt(value ?? 0), "Net Worth"]}
                      labelFormatter={(label) => String(label)}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
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
        </Card>

        {/* Savings Rate */}
        <Card>
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
            className="text-sm text-primary hover:underline"
          >
            Open AI Advisor
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
