"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

interface FIData {
  fiNumber: number;
  yearsToFI: number;
  fiDate: string;
  currentSavings: number;
}

export default function FITrackerPage() {
  const [loading, setLoading] = useState(true);
  const [, setFiData] = useState<FIData | null>(null);

  // Configurable inputs
  const [annualExpenses, setAnnualExpenses] = useState("50000");
  const [monthlySavings, setMonthlySavings] = useState("2000");
  const [expectedReturn, setExpectedReturn] = useState("7");
  const [currentInvested, setCurrentInvested] = useState("50000");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/fi-tracker");
      if (res.ok) {
        const data = await res.json();
        setFiData(data);
        if (data.annualExpenses)
          setAnnualExpenses(String(data.annualExpenses));
        if (data.monthlySavings)
          setMonthlySavings(String(data.monthlySavings));
        if (data.expectedReturn)
          setExpectedReturn(String(data.expectedReturn * 100));
        if (data.currentSavings)
          setCurrentInvested(String(data.currentSavings));
      }
    } catch (err) {
      console.error("Failed to fetch FI data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Compute FI projections locally
  const projection = useMemo(() => {
    const expenses = parseFloat(annualExpenses) || 0;
    const monthly = parseFloat(monthlySavings) || 0;
    const returnRate = (parseFloat(expectedReturn) || 7) / 100;
    const current = parseFloat(currentInvested) || 0;
    const fiNumber = expenses * 25;
    const monthlyReturn = returnRate / 12;

    // Build projection data
    const data: Array<{ year: string; balance: number }> = [];
    let balance = current;
    let months = 0;
    const maxMonths = 600;
    let fiReached = false;
    let fiMonths = 0;

    const now = new Date();
    data.push({ year: now.getFullYear().toString(), balance: Math.round(balance) });

    while (months < maxMonths && !fiReached) {
      balance = balance * (1 + monthlyReturn) + monthly;
      months++;

      if (months % 12 === 0) {
        const yr = new Date(
          now.getFullYear(),
          now.getMonth() + months,
          1
        ).getFullYear();
        data.push({ year: yr.toString(), balance: Math.round(balance) });
      }

      if (balance >= fiNumber && !fiReached) {
        fiReached = true;
        fiMonths = months;
      }
    }

    // Make sure we have at least some data past FI
    if (fiReached) {
      const extraYears = 5;
      for (let i = 0; i < extraYears * 12; i++) {
        balance = balance * (1 + monthlyReturn) + monthly;
        months++;
        if (months % 12 === 0) {
          const yr = new Date(
            now.getFullYear(),
            now.getMonth() + months,
            1
          ).getFullYear();
          data.push({ year: yr.toString(), balance: Math.round(balance) });
        }
      }
    }

    const fiDate = new Date();
    fiDate.setMonth(fiDate.getMonth() + fiMonths);
    const yearsToFI = Math.round((fiMonths / 12) * 10) / 10;
    const progress = fiNumber > 0 ? Math.min(100, (current / fiNumber) * 100) : 0;

    return { fiNumber, yearsToFI, fiDate, data, progress, fiMonths };
  }, [annualExpenses, monthlySavings, expectedReturn, currentInvested]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-lg">
          Loading FI tracker...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">FI Tracker</h1>

      {/* FI Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">FI Number</p>
            <p className="text-3xl font-bold text-primary mt-1">
              {fmt(projection.fiNumber)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              25x annual expenses
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">Projected FI Date</p>
            <p className="text-3xl font-bold mt-1">
              {projection.fiMonths < 600
                ? projection.fiDate.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                  })
                : "50+ years"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {projection.yearsToFI} years to go
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">Current Progress</p>
            <p className="text-3xl font-bold mt-1">
              {Math.round(projection.progress)}%
            </p>
            <Progress value={projection.progress} className="h-3 mt-3" />
            <p className="text-xs text-muted-foreground mt-2">
              {fmt(parseFloat(currentInvested) || 0)} of{" "}
              {fmt(projection.fiNumber)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Inputs */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Adjust these inputs to see how they affect your FI timeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Annual Expenses</Label>
              <Input
                type="number"
                value={annualExpenses}
                onChange={(e) => setAnnualExpenses(e.target.value)}
                placeholder="50000"
              />
            </div>
            <div className="space-y-2">
              <Label>Monthly Savings</Label>
              <Input
                type="number"
                value={monthlySavings}
                onChange={(e) => setMonthlySavings(e.target.value)}
                placeholder="2000"
              />
            </div>
            <div className="space-y-2">
              <Label>Expected Return (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={expectedReturn}
                onChange={(e) => setExpectedReturn(e.target.value)}
                placeholder="7"
              />
            </div>
            <div className="space-y-2">
              <Label>Current Invested Amount</Label>
              <Input
                type="number"
                value={currentInvested}
                onChange={(e) => setCurrentInvested(e.target.value)}
                placeholder="50000"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Projection Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Net Worth Projection</CardTitle>
          <CardDescription>
            Growth trajectory toward your FI number
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projection.data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis
                  tickFormatter={(v) =>
                    v >= 1000000
                      ? `$${(v / 1000000).toFixed(1)}M`
                      : `$${(v / 1000).toFixed(0)}k`
                  }
                />
                <Tooltip
                  formatter={(value: number | undefined) => [fmt(value ?? 0), "Balance"]}
                />
                <defs>
                  <linearGradient
                    id="colorBalance"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop
                      offset="95%"
                      stopColor="#3B82F6"
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  fill="url(#colorBalance)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
