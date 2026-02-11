"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#6366F1",
  "#14B8A6",
  "#F97316",
  "#D946EF",
];

interface SpendingCategory {
  name: string;
  amount: number;
  budget: number | null;
  color: string;
}

interface MonthlyTrend {
  month: string;
  categories: Record<string, number>;
  total: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export default function SpendingPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [spending, setSpending] = useState<SpendingCategory[]>([]);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [spendRes, trendRes] = await Promise.all([
        fetch(`/api/spending?month=${month}`),
        fetch("/api/spending/trend"),
      ]);

      if (spendRes.ok) setSpending(await spendRes.json());
      if (trendRes.ok) setTrend(await trendRes.json());
    } catch (err) {
      console.error("Failed to load spending data:", err);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalSpending = spending.reduce((sum, s) => sum + s.amount, 0);

  // Build stacked bar data: each month has keys for each category
  const allCategoryNames = Array.from(
    new Set(trend.flatMap((t) => Object.keys(t.categories)))
  );
  const barData = trend.map((t) => ({
    month: t.month,
    ...t.categories,
    total: t.total,
  }));

  // Pie data
  const pieData = spending.map((s, i) => ({
    name: s.name,
    value: s.amount,
    color: s.color || COLORS[i % COLORS.length],
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-lg">Loading spending data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          Spending & Budgets
        </h1>
        <div className="flex items-center gap-2">
          <Label htmlFor="spend-month">Month</Label>
          <Input
            id="spend-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-[180px]"
          />
        </div>
      </div>

      {/* Total */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Total Spending for {month}
            </p>
            <p className="text-4xl font-bold text-red-600 mt-1">
              {fmt(totalSpending)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Spending by Category</CardTitle>
            <CardDescription>Distribution for {month}</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No spending data for this month.
              </p>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={110}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }: { name?: string; percent?: number }) =>
                        `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                      }
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number | undefined) => fmt(value ?? 0)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stacked Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Spending Trend</CardTitle>
            <CardDescription>Last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            {barData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No trend data available.
              </p>
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: number | undefined) => fmt(value ?? 0)} />
                    <Legend />
                    {allCategoryNames.map((cat, i) => (
                      <Bar
                        key={cat}
                        dataKey={cat}
                        stackId="spending"
                        fill={COLORS[i % COLORS.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Budget vs Actual */}
      <Card>
        <CardHeader>
          <CardTitle>Budget vs Actual</CardTitle>
          <CardDescription>
            Category spending compared to budgets for {month}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {spending.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No spending data for this month.
            </p>
          ) : (
            <div className="space-y-4">
              {spending.map((cat, i) => {
                const budget = cat.budget || 0;
                const percent = budget > 0 ? (cat.amount / budget) * 100 : 0;
                const overBudget = budget > 0 && cat.amount > budget;

                return (
                  <div key={cat.name} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor:
                              cat.color || COLORS[i % COLORS.length],
                          }}
                        />
                        <span
                          className={`font-medium ${
                            overBudget ? "text-red-600" : ""
                          }`}
                        >
                          {cat.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={
                            overBudget
                              ? "text-red-600 font-semibold"
                              : "text-muted-foreground"
                          }
                        >
                          {fmt(cat.amount)}
                        </span>
                        {budget > 0 && (
                          <span className="text-muted-foreground">
                            / {fmt(budget)}
                          </span>
                        )}
                      </div>
                    </div>
                    {budget > 0 && (
                      <Progress
                        value={Math.min(percent, 100)}
                        className={`h-2 ${overBudget ? "[&>div]:bg-red-500" : ""}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
