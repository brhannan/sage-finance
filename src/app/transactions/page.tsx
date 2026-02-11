"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface Transaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  type: string;
  category_id: number | null;
  category_name: string | null;
  account_id: number | null;
  account_name: string | null;
  notes: string | null;
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
    minimumFractionDigits: 2,
  }).format(n);

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [month, setMonth] = useState(getCurrentMonth());
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [search, setSearch] = useState("");

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "",
    amount: "",
    type: "expense",
    category_id: "",
    account_id: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // Inline category editing
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(
    null
  );

  const fetchCategories = useCallback(async () => {
    const res = await fetch("/api/categories");
    if (res.ok) setCategories(await res.json());
  }, []);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts(await res.json());
  }, []);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (filterCategory) params.set("category", filterCategory);
    if (filterAccount) params.set("account", filterAccount);
    if (search) params.set("search", search);

    try {
      const res = await fetch(`/api/transactions?${params}`);
      if (res.ok) setTransactions(await res.json());
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [month, filterCategory, filterAccount, search]);

  useEffect(() => {
    fetchCategories();
    fetchAccounts();
  }, [fetchCategories, fetchAccounts]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleAdd = async () => {
    if (!form.date || !form.description || !form.amount) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amount: parseFloat(form.amount),
          category_id: form.category_id ? Number(form.category_id) : undefined,
          account_id: form.account_id ? Number(form.account_id) : undefined,
        }),
      });
      if (res.ok) {
        setAddOpen(false);
        setForm({
          date: new Date().toISOString().slice(0, 10),
          description: "",
          amount: "",
          type: "expense",
          category_id: "",
          account_id: "",
          notes: "",
        });
        fetchTransactions();
      }
    } catch (err) {
      console.error("Failed to add transaction:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCategoryChange = async (txId: number, categoryId: string) => {
    try {
      const res = await fetch(`/api/transactions/${txId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_id: Number(categoryId) }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTransactions((prev) =>
          prev.map((t) => (t.id === txId ? updated : t))
        );
      }
    } catch (err) {
      console.error("Failed to update category:", err);
    }
    setEditingCategoryId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>+ Add Transaction</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add Transaction</DialogTitle>
              <DialogDescription>
                Enter the details for a new transaction.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(e) =>
                      setForm({ ...form, date: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm({ ...form, type: v })}
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
                <Label>Description</Label>
                <Input
                  placeholder="Description..."
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) =>
                      setForm({ ...form, amount: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={form.category_id}
                    onValueChange={(v) =>
                      setForm({ ...form, category_id: v })
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
                <Label>Account</Label>
                <Select
                  value={form.account_id}
                  onValueChange={(v) => setForm({ ...form, account_id: v })}
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
                <Label>Notes</Label>
                <Textarea
                  placeholder="Optional notes..."
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={submitting}>
                {submitting ? "Adding..." : "Add Transaction"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Month</Label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={filterCategory}
                onValueChange={setFilterCategory}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account</Label>
              <Select value={filterAccount} onValueChange={setFilterAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                placeholder="Search descriptions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Transactions{" "}
            <span className="text-muted-foreground font-normal text-base">
              ({transactions.length} records)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">
              Loading transactions...
            </p>
          ) : transactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No transactions found for the selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Account</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap">
                        {tx.date}
                      </TableCell>
                      <TableCell className="max-w-[250px] truncate">
                        {tx.description}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium whitespace-nowrap ${
                          tx.type === "income"
                            ? "text-green-600"
                            : tx.type === "expense"
                            ? "text-red-600"
                            : "text-muted-foreground"
                        }`}
                      >
                        {tx.type === "income" ? "+" : tx.type === "expense" ? "-" : ""}
                        {fmt(Math.abs(tx.amount))}
                      </TableCell>
                      <TableCell>
                        {editingCategoryId === tx.id ? (
                          <Select
                            value={
                              tx.category_id ? String(tx.category_id) : ""
                            }
                            onValueChange={(v) =>
                              handleCategoryChange(tx.id, v)
                            }
                          >
                            <SelectTrigger className="h-8 w-[140px]">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <button
                            className="text-left hover:underline text-sm"
                            onClick={() => setEditingCategoryId(tx.id)}
                            title="Click to change category"
                          >
                            {tx.category_name || (
                              <span className="text-muted-foreground italic">
                                Uncategorized
                              </span>
                            )}
                          </button>
                        )}
                      </TableCell>
                      <TableCell>
                        {tx.account_name || (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
