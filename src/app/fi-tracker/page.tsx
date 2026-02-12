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
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

// Box-Muller transform for standard normal random variable
function randn(): number {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

interface FIData {
  fiNumber: number;
  yearsToFI: number;
  fiDate: string;
  currentSavings: number;
}

interface PercentileRow {
  year: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

const NUM_RUNS = 500;
const MAX_YEARS = 50;

export default function FITrackerPage() {
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [fiData, setFiData] = useState<FIData | null>(null);

  // Configurable inputs
  const [annualExpenses, setAnnualExpenses] = useState("50000");
  const [monthlySavings, setMonthlySavings] = useState("2000");
  const [expectedReturn, setExpectedReturn] = useState("7");
  const [volatility, setVolatility] = useState("16");
  const [currentInvested, setCurrentInvested] = useState("0");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/metrics");
      if (res.ok) {
        const data = await res.json();
        setFiData(data);
        if (data.netWorth?.total) {
          setCurrentInvested(String(Math.round(data.netWorth.total)));
        }
        if (data.savingsRate?.expenses && data.savingsRate.expenses > 0) {
          setAnnualExpenses(String(Math.round(data.savingsRate.expenses * 12)));
        }
        if (data.savingsRate?.income && data.savingsRate?.expenses) {
          const monthlySave = data.savingsRate.income - data.savingsRate.expenses;
          if (monthlySave > 0) setMonthlySavings(String(Math.round(monthlySave)));
        }
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

  const projection = useMemo(() => {
    const expenses = parseFloat(annualExpenses) || 0;
    const monthly = parseFloat(monthlySavings) || 0;
    const mu = (parseFloat(expectedReturn) || 7) / 100;
    const sigma = (parseFloat(volatility) || 16) / 100;
    const current = parseFloat(currentInvested) || 0;
    const fiNumber = expenses * 25;

    const now = new Date();
    const currentYear = now.getFullYear();
    const totalMonths = MAX_YEARS * 12;

    // Run Monte Carlo simulations
    // Store end-of-year balances for each run: runs[runIdx][yearIdx]
    const runs: number[][] = [];
    const fiMonthsPerRun: number[] = [];

    for (let r = 0; r < NUM_RUNS; r++) {
      let balance = current;
      let savings = monthly;
      const yearlyBalances: number[] = [balance];
      let fiMonth = totalMonths + 1; // default: never reached
      let jobLossMonthsLeft = 0;
      let preJobLossSavings = savings;

      for (let m = 1; m <= totalMonths; m++) {
        // Income/savings changes each January (month 12, 24, 36, ...)
        if (m % 12 === 1 && m > 1 && jobLossMonthsLeft === 0) {
          const roll = Math.random();
          if (roll < 0.03) {
            // Job loss: 3% chance
            preJobLossSavings = savings;
            savings = 0;
            jobLossMonthsLeft = 3 + Math.floor(Math.random() * 4); // 3-6 months
          } else if (roll < 0.13) {
            // Promotion: 10% chance
            savings *= 1 + 0.15 + Math.random() * 0.15; // +15-30%
          } else if (roll < 0.83) {
            // Normal raise: 70% chance
            savings *= 1 + 0.02 + Math.random() * 0.02; // +2-4%
          }
          // else: 17% no change
        }

        // Handle job loss recovery
        if (jobLossMonthsLeft > 0) {
          jobLossMonthsLeft--;
          if (jobLossMonthsLeft === 0) {
            savings = preJobLossSavings * 0.8;
          }
        }

        // Market return (log-normal)
        const monthlyMu = mu / 12 - (sigma * sigma) / 24;
        const monthlySigma = sigma / Math.sqrt(12);
        const logReturn = monthlyMu + monthlySigma * randn();
        balance = balance * Math.exp(logReturn) + savings;

        // Expense shocks
        const shockRoll = Math.random();
        if (shockRoll < 0.001) {
          // 0.1% chance: large expense $20k-$50k
          balance -= 20000 + Math.random() * 30000;
        } else if (shockRoll < 0.006) {
          // 0.5% chance: major expense $5k-$20k
          balance -= 5000 + Math.random() * 15000;
        }

        balance = Math.max(0, balance);

        if (balance >= fiNumber && fiMonth > totalMonths) {
          fiMonth = m;
        }

        if (m % 12 === 0) {
          yearlyBalances.push(Math.round(balance));
        }
      }

      runs.push(yearlyBalances);
      fiMonthsPerRun.push(fiMonth);
    }

    // Compute percentiles at each year
    const numYears = MAX_YEARS + 1; // including year 0
    const data: PercentileRow[] = [];

    for (let y = 0; y < numYears; y++) {
      const values = runs.map((run) => run[y] ?? run[run.length - 1]).sort(
        (a, b) => a - b
      );
      const p = (pct: number) => values[Math.floor(pct * values.length)] ?? 0;

      const yearLabel = (currentYear + y).toString();
      data.push({
        year: yearLabel,
        p10: p(0.1),
        p25: p(0.25),
        p50: p(0.5),
        p75: p(0.75),
        p90: p(0.9),
      });
    }

    // FI timing percentiles
    const sortedFiMonths = [...fiMonthsPerRun].sort((a, b) => a - b);
    const fiP10Months = sortedFiMonths[Math.floor(0.1 * NUM_RUNS)];
    const fiP50Months = sortedFiMonths[Math.floor(0.5 * NUM_RUNS)];
    const fiP90Months = sortedFiMonths[Math.floor(0.9 * NUM_RUNS)];

    const medianDate = new Date();
    medianDate.setMonth(medianDate.getMonth() + fiP50Months);
    const medianYears = Math.round((fiP50Months / 12) * 10) / 10;

    const optimisticYears = Math.round((fiP10Months / 12) * 10) / 10;
    const pessimisticYears = Math.round((fiP90Months / 12) * 10) / 10;

    const progress = fiNumber > 0 ? Math.min(100, (current / fiNumber) * 100) : 0;

    // Trim data to a reasonable range (stop 5 years past median FI or at max)
    const displayYears = Math.min(
      MAX_YEARS + 1,
      Math.ceil(fiP90Months / 12) + 5
    );
    const trimmedData = data.slice(0, Math.max(displayYears, 15));

    return {
      fiNumber,
      medianYears,
      medianDate,
      optimisticYears,
      pessimisticYears,
      fiP50Months,
      fiP90Months,
      data: trimmedData,
      progress,
    };
  }, [annualExpenses, monthlySavings, expectedReturn, volatility, currentInvested]);

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
            <p className="text-sm text-muted-foreground">Projected FI Date (Median)</p>
            <p className="text-3xl font-bold mt-1">
              {projection.fiP50Months <= MAX_YEARS * 12
                ? projection.medianDate.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                  })
                : "50+ years"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {projection.medianYears} years (median)
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Optimistic: {projection.optimisticYears} yrs | Pessimistic: {projection.pessimisticYears} yrs
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
              <Label>Volatility (%)</Label>
              <Input
                type="number"
                step="1"
                value={volatility}
                onChange={(e) => setVolatility(e.target.value)}
                placeholder="16"
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

      {/* Projection Fan Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Net Worth Projection (Monte Carlo)</CardTitle>
          <CardDescription>
            {NUM_RUNS} simulated paths — bands show P10 to P90 range of outcomes
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
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload as PercentileRow | undefined;
                    if (!d) return null;
                    return (
                      <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
                        <p className="font-semibold mb-1">{label}</p>
                        <p className="text-green-600">P90 (optimistic): {fmt(d.p90)}</p>
                        <p className="text-blue-500">P75: {fmt(d.p75)}</p>
                        <p className="text-blue-700 font-semibold">P50 (median): {fmt(d.p50)}</p>
                        <p className="text-blue-500">P25: {fmt(d.p25)}</p>
                        <p className="text-red-500">P10 (pessimistic): {fmt(d.p10)}</p>
                      </div>
                    );
                  }}
                />
                <defs>
                  <linearGradient id="bandPessimistic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F97316" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#F97316" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="bandLowerMid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="bandUpperMid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="bandOptimistic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22C55E" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#22C55E" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                {/* P10-P25 band (pessimistic) */}
                <Area
                  type="monotone"
                  dataKey="p10"
                  stackId="band"
                  stroke="none"
                  fill="transparent"
                  activeDot={false}
                />
                <Area
                  type="monotone"
                  dataKey="p25"
                  stackId="none"
                  stroke="none"
                  fill="url(#bandPessimistic)"
                  activeDot={false}
                  baseValue="dataMin"
                />
                {/* We use individual areas with custom rendering instead of stacking */}
                <Area
                  type="monotone"
                  dataKey="p75"
                  stackId="none"
                  stroke="none"
                  fill="url(#bandUpperMid)"
                  activeDot={false}
                  baseValue="dataMin"
                />
                <Area
                  type="monotone"
                  dataKey="p90"
                  stackId="none"
                  stroke="none"
                  fill="url(#bandOptimistic)"
                  activeDot={false}
                  baseValue="dataMin"
                />
                {/* Median line on top */}
                <Area
                  type="monotone"
                  dataKey="p50"
                  stroke="#3B82F6"
                  strokeWidth={2.5}
                  fill="url(#bandLowerMid)"
                  activeDot={false}
                  baseValue="dataMin"
                />
                <ReferenceLine
                  y={projection.fiNumber}
                  stroke="#EF4444"
                  strokeDasharray="6 4"
                  strokeWidth={2}
                  label={{
                    value: `FI: ${fmt(projection.fiNumber)}`,
                    position: "insideTopRight",
                    fill: "#EF4444",
                    fontSize: 12,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
