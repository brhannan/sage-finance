"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Progress } from "@/components/ui/progress";
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CreditScore {
  id: number;
  date: string;
  score: number;
  source: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export default function HomeBuyingPage() {
  const [creditScores, setCreditScores] = useState<CreditScore[]>([]);
  const [loading, setLoading] = useState(true);

  // Inputs
  const [targetPrice, setTargetPrice] = useState("400000");
  const [downPaymentPct, setDownPaymentPct] = useState("20");
  const [currentSavings, setCurrentSavings] = useState("30000");
  const [monthlyIncome, setMonthlyIncome] = useState("8000");
  const [monthlyDebts, setMonthlyDebts] = useState("500");
  const [monthlySavingsRate, setMonthlySavingsRate] = useState("2000");

  // Add credit score dialog
  const [scoreOpen, setScoreOpen] = useState(false);
  const [scoreForm, setScoreForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    score: "",
    source: "credit_karma",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/credit-scores");
      if (res.ok) setCreditScores(await res.json());
    } catch (err) {
      console.error("Failed to fetch credit scores:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddScore = async () => {
    if (!scoreForm.date || !scoreForm.score) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/credit-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: scoreForm.date,
          score: parseInt(scoreForm.score),
          source: scoreForm.source,
        }),
      });
      if (res.ok) {
        setScoreOpen(false);
        setScoreForm({
          date: new Date().toISOString().slice(0, 10),
          score: "",
          source: "credit_karma",
        });
        fetchData();
      }
    } catch (err) {
      console.error("Failed to add credit score:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Calculations
  const calc = useMemo(() => {
    const price = parseFloat(targetPrice) || 0;
    const dpPct = parseFloat(downPaymentPct) || 20;
    const savings = parseFloat(currentSavings) || 0;
    const income = parseFloat(monthlyIncome) || 0;
    const debts = parseFloat(monthlyDebts) || 0;
    const monthlySave = parseFloat(monthlySavingsRate) || 0;

    const downPaymentNeeded = price * (dpPct / 100);
    const downPaymentProgress =
      downPaymentNeeded > 0
        ? Math.min(100, (savings / downPaymentNeeded) * 100)
        : 0;

    const dti = income > 0 ? (debts / income) * 100 : 0;

    // Mortgage calculation (30-year fixed at 7%)
    const loanAmount = price - downPaymentNeeded;
    const rate = 0.07 / 12;
    const n = 360;
    const monthlyPayment =
      loanAmount > 0
        ? (loanAmount * (rate * Math.pow(1 + rate, n))) /
          (Math.pow(1 + rate, n) - 1)
        : 0;

    // Add taxes & insurance (~1.5% of home price annually)
    const monthlyTaxInsurance = (price * 0.015) / 12;
    const totalMonthlyPayment = monthlyPayment + monthlyTaxInsurance;

    // Max affordable based on 28% rule
    const maxHousingPayment = Math.max(0, income * 0.28 - debts);
    const maxLoan =
      maxHousingPayment > 0
        ? (maxHousingPayment - monthlyTaxInsurance) *
          ((Math.pow(1 + rate, n) - 1) / (rate * Math.pow(1 + rate, n)))
        : 0;
    const affordablePrice = Math.max(0, maxLoan / (1 - dpPct / 100));

    // Projected ready date (months to save down payment)
    const remaining = Math.max(0, downPaymentNeeded - savings);
    const monthsToReady =
      monthlySave > 0 ? Math.ceil(remaining / monthlySave) : Infinity;
    const readyDate = new Date();
    readyDate.setMonth(readyDate.getMonth() + monthsToReady);

    return {
      downPaymentNeeded,
      downPaymentProgress: Math.round(downPaymentProgress * 10) / 10,
      dti: Math.round(dti * 10) / 10,
      monthlyPayment: Math.round(totalMonthlyPayment),
      affordablePrice: Math.round(affordablePrice),
      monthsToReady,
      readyDate,
    };
  }, [
    targetPrice,
    downPaymentPct,
    currentSavings,
    monthlyIncome,
    monthlyDebts,
    monthlySavingsRate,
  ]);

  const latestScore =
    creditScores.length > 0 ? creditScores[creditScores.length - 1] : null;

  const scoreColor = (score: number) => {
    if (score >= 740) return "text-green-600";
    if (score >= 670) return "text-yellow-600";
    return "text-red-600";
  };

  const scoreLabel = (score: number) => {
    if (score >= 800) return "Excellent";
    if (score >= 740) return "Very Good";
    if (score >= 670) return "Good";
    if (score >= 580) return "Fair";
    return "Poor";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          Home Buying Readiness
        </h1>
        <Dialog open={scoreOpen} onOpenChange={setScoreOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">+ Add Credit Score</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Credit Score</DialogTitle>
              <DialogDescription>
                Record your latest credit score.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={scoreForm.date}
                  onChange={(e) =>
                    setScoreForm({ ...scoreForm, date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Score</Label>
                <Input
                  type="number"
                  min="300"
                  max="850"
                  placeholder="750"
                  value={scoreForm.score}
                  onChange={(e) =>
                    setScoreForm({ ...scoreForm, score: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Source</Label>
                <Input
                  placeholder="e.g., Credit Karma"
                  value={scoreForm.source}
                  onChange={(e) =>
                    setScoreForm({ ...scoreForm, source: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setScoreOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleAddScore} disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Inputs */}
      <Card>
        <CardHeader>
          <CardTitle>Your Situation</CardTitle>
          <CardDescription>
            Adjust these to see your home buying readiness.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Target Home Price</Label>
              <Input
                type="number"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Down Payment %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={downPaymentPct}
                onChange={(e) => setDownPaymentPct(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Current Savings for Down Payment</Label>
              <Input
                type="number"
                value={currentSavings}
                onChange={(e) => setCurrentSavings(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Monthly Gross Income</Label>
              <Input
                type="number"
                value={monthlyIncome}
                onChange={(e) => setMonthlyIncome(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Monthly Debt Payments</Label>
              <Input
                type="number"
                value={monthlyDebts}
                onChange={(e) => setMonthlyDebts(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Monthly Savings toward Down Payment</Label>
              <Input
                type="number"
                value={monthlySavingsRate}
                onChange={(e) => setMonthlySavingsRate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">Down Payment</p>
            <p className="text-2xl font-bold mt-1">
              {fmt(calc.downPaymentNeeded)}
            </p>
            <Progress
              value={calc.downPaymentProgress}
              className="h-2 mt-3"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {calc.downPaymentProgress}% saved
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">DTI Ratio</p>
            <p
              className={`text-2xl font-bold mt-1 ${
                calc.dti > 43
                  ? "text-red-600"
                  : calc.dti > 36
                  ? "text-yellow-600"
                  : "text-green-600"
              }`}
            >
              {calc.dti}%
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {calc.dti <= 36
                ? "Good - within conventional limits"
                : calc.dti <= 43
                ? "Borderline - may limit options"
                : "High - may need to reduce debt"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Est. Monthly Payment
            </p>
            <p className="text-2xl font-bold mt-1">
              {fmt(calc.monthlyPayment)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              P&I + taxes & insurance
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Affordable Home Price
            </p>
            <p
              className={`text-2xl font-bold mt-1 ${
                calc.affordablePrice >= parseFloat(targetPrice)
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {fmt(calc.affordablePrice)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Based on 28% income rule
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Projected Ready Date */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Projected Ready Date
            </p>
            <p className="text-4xl font-bold mt-2">
              {calc.monthsToReady === Infinity
                ? "N/A"
                : calc.monthsToReady <= 0
                ? "Ready Now!"
                : calc.readyDate.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                  })}
            </p>
            {calc.monthsToReady > 0 && calc.monthsToReady < Infinity && (
              <p className="text-muted-foreground mt-1">
                {calc.monthsToReady} months away (at {fmt(parseFloat(monthlySavingsRate))}/month savings)
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Credit Score Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Credit Score</CardTitle>
            <CardDescription>
              Your credit score history
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latestScore ? (
              <div className="text-center mb-6">
                <p
                  className={`text-5xl font-bold ${scoreColor(
                    latestScore.score
                  )}`}
                >
                  {latestScore.score}
                </p>
                <Badge variant="secondary" className="mt-2">
                  {scoreLabel(latestScore.score)}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  as of {latestScore.date}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No credit scores recorded yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credit Score Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {creditScores.length < 2 ? (
              <p className="text-muted-foreground text-center py-8">
                Add at least 2 credit scores to see the trend.
              </p>
            ) : (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={creditScores}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[300, 850]} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#8B5CF6"
                      strokeWidth={2}
                      dot={{ fill: "#8B5CF6", r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
