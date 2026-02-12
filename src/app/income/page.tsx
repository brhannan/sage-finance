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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface IncomeRecord {
  id: number;
  date: string;
  employer: string | null;
  gross_pay: number;
  net_pay: number;
  federal_tax: number | null;
  state_tax: number | null;
  social_security: number | null;
  medicare: number | null;
  retirement_401k: number | null;
  health_insurance: number | null;
}

interface ParsedPaystub {
  date?: string;
  employer?: string;
  gross_pay?: number;
  net_pay?: number;
  federal_tax?: number;
  state_tax?: number;
  social_security?: number;
  medicare?: number;
  retirement_401k?: number;
  health_insurance?: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);

const fmtShort = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export default function IncomePage() {
  const [records, setRecords] = useState<IncomeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload pay stub
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [parsedData, setParsedData] = useState<ParsedPaystub | null>(null);
  const [reviewMode, setReviewMode] = useState(false);

  // Manual entry
  const [manualOpen, setManualOpen] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    employer: "",
    gross_pay: "",
    net_pay: "",
    federal_tax: "",
    state_tax: "",
    social_security: "",
    medicare: "",
    retirement_401k: "",
    health_insurance: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/income");
      if (res.ok) setRecords(await res.json());
    } catch (err) {
      console.error("Failed to fetch income records:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setParsing(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const mediaType = uploadFile.type || "image/png";
        const res = await fetch("/api/advisor/parse-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentType: "paystub",
            image: base64,
            mediaType,
          }),
        });
        if (res.ok) {
          const result = await res.json();
          const data = result.data || result;
          setParsedData(data);
          // Pre-fill form with parsed data
          setForm({
            date: data.date || new Date().toISOString().slice(0, 10),
            employer: data.employer || "",
            gross_pay: data.gross_pay ? String(data.gross_pay) : "",
            net_pay: data.net_pay ? String(data.net_pay) : "",
            federal_tax: data.federal_tax ? String(data.federal_tax) : "",
            state_tax: data.state_tax ? String(data.state_tax) : "",
            social_security: data.social_security
              ? String(data.social_security)
              : "",
            medicare: data.medicare ? String(data.medicare) : "",
            retirement_401k: data.retirement_401k
              ? String(data.retirement_401k)
              : "",
            health_insurance: data.health_insurance
              ? String(data.health_insurance)
              : "",
          });
          setReviewMode(true);
          setUploadOpen(false);
          setManualOpen(true);
        } else {
          const errData = await res.json().catch(() => ({}));
          console.error("Parse failed:", res.status, errData);
          alert(`Parse failed: ${errData.error || res.statusText}`);
        }
        setParsing(false);
      };
      reader.readAsDataURL(uploadFile);
    } catch (err) {
      console.error("Upload failed:", err);
      setParsing(false);
    }
  };

  const handleSave = async () => {
    if (!form.date || !form.gross_pay || !form.net_pay) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        date: form.date,
        employer: form.employer || null,
        gross_pay: parseFloat(form.gross_pay),
        net_pay: parseFloat(form.net_pay),
      };
      if (form.federal_tax) body.federal_tax = parseFloat(form.federal_tax);
      if (form.state_tax) body.state_tax = parseFloat(form.state_tax);
      if (form.social_security)
        body.social_security = parseFloat(form.social_security);
      if (form.medicare) body.medicare = parseFloat(form.medicare);
      if (form.retirement_401k)
        body.retirement_401k = parseFloat(form.retirement_401k);
      if (form.health_insurance)
        body.health_insurance = parseFloat(form.health_insurance);

      const res = await fetch("/api/income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setManualOpen(false);
        setReviewMode(false);
        setParsedData(null);
        setForm({
          date: new Date().toISOString().slice(0, 10),
          employer: "",
          gross_pay: "",
          net_pay: "",
          federal_tax: "",
          state_tax: "",
          social_security: "",
          medicare: "",
          retirement_401k: "",
          health_insurance: "",
        });
        fetchRecords();
      }
    } catch (err) {
      console.error("Failed to save income record:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Chart data: group by month
  const chartData = records.reduce<
    Array<{ month: string; gross: number; net: number }>
  >((acc, r) => {
    const m = r.date.slice(0, 7);
    const existing = acc.find((d) => d.month === m);
    if (existing) {
      existing.gross += r.gross_pay;
      existing.net += r.net_pay;
    } else {
      acc.push({ month: m, gross: r.gross_pay, net: r.net_pay });
    }
    return acc;
  }, []);
  chartData.sort((a, b) => a.month.localeCompare(b.month));

  const totalDeductions = (r: IncomeRecord) =>
    (r.federal_tax || 0) +
    (r.state_tax || 0) +
    (r.social_security || 0) +
    (r.medicare || 0) +
    (r.retirement_401k || 0) +
    (r.health_insurance || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Income Tracking</h1>
        <div className="flex gap-2">
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Upload Pay Stub</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Pay Stub</DialogTitle>
                <DialogDescription>
                  Upload a pay stub image or PDF to automatically extract data.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setUploadOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={!uploadFile || parsing}
                >
                  {parsing ? "Parsing..." : "Upload & Parse"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={manualOpen} onOpenChange={setManualOpen}>
            <DialogTrigger asChild>
              <Button>+ Add Manual Entry</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>
                  {reviewMode
                    ? "Review Parsed Pay Stub"
                    : "Add Income Record"}
                </DialogTitle>
                <DialogDescription>
                  {reviewMode
                    ? "Review and edit the parsed data before saving."
                    : "Manually enter income details."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-4 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
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
                    <Label>Employer</Label>
                    <Input
                      placeholder="Company name"
                      value={form.employer}
                      onChange={(e) =>
                        setForm({ ...form, employer: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Gross Pay *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.gross_pay}
                      onChange={(e) =>
                        setForm({ ...form, gross_pay: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Net Pay *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.net_pay}
                      onChange={(e) =>
                        setForm({ ...form, net_pay: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Federal Tax</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.federal_tax}
                      onChange={(e) =>
                        setForm({ ...form, federal_tax: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>State Tax</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.state_tax}
                      onChange={(e) =>
                        setForm({ ...form, state_tax: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Social Security</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.social_security}
                      onChange={(e) =>
                        setForm({ ...form, social_security: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Medicare</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.medicare}
                      onChange={(e) =>
                        setForm({ ...form, medicare: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>401(k)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.retirement_401k}
                      onChange={(e) =>
                        setForm({ ...form, retirement_401k: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Health Insurance</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.health_insurance}
                      onChange={(e) =>
                        setForm({ ...form, health_insurance: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setManualOpen(false);
                    setReviewMode(false);
                    setParsedData(null);
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={submitting}>
                  {submitting ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Monthly Income Trend Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly Income Trend</CardTitle>
            <CardDescription>Gross vs. net pay over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number | undefined) => fmtShort(value ?? 0)} />
                  <Legend />
                  <Bar dataKey="gross" name="Gross Pay" fill="#3B82F6" />
                  <Bar dataKey="net" name="Net Pay" fill="#10B981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Income Records Table */}
      <Card>
        <CardHeader>
          <CardTitle>Income Records</CardTitle>
          <CardDescription>{records.length} records</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-center py-8">
              Loading income records...
            </p>
          ) : records.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No income records yet. Add your first one above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead className="text-right">Gross Pay</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.date}</TableCell>
                      <TableCell>{r.employer || "--"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {fmt(r.gross_pay)}
                      </TableCell>
                      <TableCell className="text-right text-green-600 font-medium">
                        {fmt(r.net_pay)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {fmt(totalDeductions(r))}
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
