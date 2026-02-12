"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface NetWorthData {
  total: number;
  assets: number;
  liabilities: number;
  history: Array<{ date: string; amount: number }>;
}

interface AccountWithBalance {
  id: number;
  name: string;
  type: string;
  institution: string | null;
  latest_balance: number | null;
  balance_date: string | null;
  is_active: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit_card", label: "Credit Card" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
  { value: "payroll", label: "Payroll" },
  { value: "other", label: "Other" },
];

export default function NetWorthPage() {
  const [netWorth, setNetWorth] = useState<NetWorthData | null>(null);
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Balance dialog
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balanceForm, setBalanceForm] = useState({
    account_id: "",
    date: new Date().toISOString().slice(0, 10),
    balance: "",
  });

  // Add Account dialog
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({
    name: "",
    type: "checking",
    institution: "",
  });

  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [metricsRes, acctRes] = await Promise.all([
        fetch("/api/metrics"),
        fetch("/api/accounts"),
      ]);
      if (metricsRes.ok) {
        const m = await metricsRes.json();
        setNetWorth(m.netWorth);
      }
      if (acctRes.ok) setAccounts(await acctRes.json());
    } catch (err) {
      console.error("Failed to load net worth data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddBalance = async () => {
    if (!balanceForm.account_id || !balanceForm.date || !balanceForm.balance)
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: Number(balanceForm.account_id),
          date: balanceForm.date,
          balance: parseFloat(balanceForm.balance),
        }),
      });
      if (res.ok) {
        setBalanceOpen(false);
        setBalanceForm({
          account_id: "",
          date: new Date().toISOString().slice(0, 10),
          balance: "",
        });
        fetchData();
      }
    } catch (err) {
      console.error("Failed to add balance:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddAccount = async () => {
    if (!accountForm.name || !accountForm.type) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: accountForm.name,
          type: accountForm.type,
          institution: accountForm.institution || null,
        }),
      });
      if (res.ok) {
        setAccountOpen(false);
        setAccountForm({ name: "", type: "checking", institution: "" });
        fetchData();
      }
    } catch (err) {
      console.error("Failed to add account:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const isLiability = (type: string) =>
    type === "credit_card" || type === "loan";

  const assetAccounts = accounts.filter((a) => !isLiability(a.type));
  const liabilityAccounts = accounts.filter((a) => isLiability(a.type));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-lg">
          Loading net worth data...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Net Worth</h1>
        <div className="flex gap-2">
          <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">+ Add Balance</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Balance Entry</DialogTitle>
                <DialogDescription>
                  Record an account balance for a specific date.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Account</Label>
                  <Select
                    value={balanceForm.account_id}
                    onValueChange={(v) =>
                      setBalanceForm({ ...balanceForm, account_id: v })
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
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={balanceForm.date}
                    onChange={(e) =>
                      setBalanceForm({ ...balanceForm, date: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Balance</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={balanceForm.balance}
                    onChange={(e) =>
                      setBalanceForm({
                        ...balanceForm,
                        balance: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setBalanceOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddBalance} disabled={submitting}>
                  {submitting ? "Saving..." : "Save Balance"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
            <DialogTrigger asChild>
              <Button>+ Add Account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Account</DialogTitle>
                <DialogDescription>
                  Create a new account to track.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Account Name</Label>
                  <Input
                    placeholder="e.g., Chase Checking"
                    value={accountForm.name}
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={accountForm.type}
                    onValueChange={(v) =>
                      setAccountForm({ ...accountForm, type: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Institution</Label>
                  <Input
                    placeholder="e.g., Chase, Fidelity"
                    value={accountForm.institution}
                    onChange={(e) =>
                      setAccountForm({
                        ...accountForm,
                        institution: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAccountOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleAddAccount} disabled={submitting}>
                  {submitting ? "Creating..." : "Create Account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Big Net Worth Number */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Current Net Worth</p>
            <p
              className={`text-5xl font-bold ${
                netWorth && netWorth.total >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {netWorth ? fmt(netWorth.total) : "$--"}
            </p>
            {netWorth && (
              <div className="flex justify-center gap-8 mt-4">
                <div>
                  <p className="text-sm text-muted-foreground">Assets</p>
                  <p className="text-xl font-semibold text-green-600">
                    {fmt(netWorth.assets)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Liabilities</p>
                  <p className="text-xl font-semibold text-red-600">
                    {fmt(netWorth.liabilities)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Net Worth Over Time */}
      {netWorth && netWorth.history.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Net Worth Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={netWorth.history}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip formatter={(value: number | undefined) => [fmt(value ?? 0), "Net Worth"]} />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ fill: "#3B82F6", r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Account Balances */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assets */}
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
            <CardDescription>
              {assetAccounts.length} accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assetAccounts.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No asset accounts. Add one above.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assetAccounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{a.name}</p>
                          {a.institution && (
                            <p className="text-xs text-muted-foreground">
                              {a.institution}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{a.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-green-600">
                        {a.latest_balance !== null
                          ? fmt(a.latest_balance)
                          : "--"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Liabilities */}
        <Card>
          <CardHeader>
            <CardTitle>Liabilities</CardTitle>
            <CardDescription>
              {liabilityAccounts.length} accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {liabilityAccounts.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No liability accounts. Great!
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liabilityAccounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{a.name}</p>
                          {a.institution && (
                            <p className="text-xs text-muted-foreground">
                              {a.institution}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive">{a.type}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-red-600">
                        {a.latest_balance !== null
                          ? fmt(Math.abs(a.latest_balance))
                          : "--"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
