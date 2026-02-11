"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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

interface Goal {
  id: number;
  name: string;
  type: string;
  target_amount: number;
  current_amount: number;
  target_date: string | null;
  description: string | null;
  is_active: number;
  progress: number;
}

const GOAL_TYPES = [
  { value: "fi", label: "Financial Independence" },
  { value: "home_purchase", label: "Home Purchase" },
  { value: "savings", label: "Savings" },
  { value: "debt_payoff", label: "Debt Payoff" },
  { value: "custom", label: "Custom" },
];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const typeLabel = (type: string) =>
  GOAL_TYPES.find((t) => t.value === type)?.label || type;

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "savings",
    target_amount: "",
    current_amount: "",
    target_date: "",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/goals");
      if (res.ok) setGoals(await res.json());
    } catch (err) {
      console.error("Failed to fetch goals:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  const openAdd = () => {
    setEditingGoal(null);
    setForm({
      name: "",
      type: "savings",
      target_amount: "",
      current_amount: "",
      target_date: "",
      description: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (goal: Goal) => {
    setEditingGoal(goal);
    setForm({
      name: goal.name,
      type: goal.type,
      target_amount: String(goal.target_amount),
      current_amount: String(goal.current_amount),
      target_date: goal.target_date || "",
      description: goal.description || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.target_amount) return;
    setSubmitting(true);

    const body = {
      name: form.name,
      type: form.type,
      target_amount: parseFloat(form.target_amount),
      current_amount: form.current_amount
        ? parseFloat(form.current_amount)
        : 0,
      target_date: form.target_date || null,
      description: form.description || null,
    };

    try {
      const url = editingGoal
        ? `/api/goals/${editingGoal.id}`
        : "/api/goals";
      const method = editingGoal ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setDialogOpen(false);
        setEditingGoal(null);
        fetchGoals();
      }
    } catch (err) {
      console.error("Failed to save goal:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this goal?")) return;
    try {
      const res = await fetch(`/api/goals/${id}`, { method: "DELETE" });
      if (res.ok) fetchGoals();
    } catch (err) {
      console.error("Failed to delete goal:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-lg">Loading goals...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAdd}>+ Add Goal</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                {editingGoal ? "Edit Goal" : "Add Goal"}
              </DialogTitle>
              <DialogDescription>
                {editingGoal
                  ? "Update your goal details."
                  : "Set a new financial goal to track."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Goal Name *</Label>
                <Input
                  placeholder="e.g., Emergency Fund"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
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
                    {GOAL_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target Amount *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="50000"
                    value={form.target_amount}
                    onChange={(e) =>
                      setForm({ ...form, target_amount: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Current Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0"
                    value={form.current_amount}
                    onChange={(e) =>
                      setForm({ ...form, current_amount: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target Date</Label>
                <Input
                  type="date"
                  value={form.target_date}
                  onChange={(e) =>
                    setForm({ ...form, target_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="What is this goal for?"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={submitting}>
                {submitting
                  ? "Saving..."
                  : editingGoal
                  ? "Update Goal"
                  : "Create Goal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {goals.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center py-8">
              No goals yet. Create your first goal to start tracking progress.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {goals.map((goal) => (
            <Card key={goal.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{goal.name}</CardTitle>
                    <CardDescription className="mt-1">
                      <Badge variant="secondary">{typeLabel(goal.type)}</Badge>
                      {goal.target_date && (
                        <span className="ml-2 text-xs">
                          Target: {goal.target_date}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {goal.description && (
                  <p className="text-sm text-muted-foreground mb-4">
                    {goal.description}
                  </p>
                )}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">
                      {fmt(goal.current_amount)}
                    </span>
                    <span className="text-muted-foreground">
                      {fmt(goal.target_amount)}
                    </span>
                  </div>
                  <Progress value={goal.progress} className="h-3" />
                  <p className="text-center text-sm font-medium">
                    {Math.round(goal.progress)}% complete
                  </p>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(goal)}
                >
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(goal.id)}
                >
                  Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
