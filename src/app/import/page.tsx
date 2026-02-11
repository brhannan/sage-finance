"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";
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

interface Account {
  id: number;
  name: string;
}

interface SavedMapping {
  id: number;
  institution: string;
  account_id: number | null;
  mapping: string;
}

interface ImportResult {
  imported: number;
  duplicates: number;
  errors: string[];
}

export default function ImportPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [savedMappings, setSavedMappings] = useState<SavedMapping[]>([]);
  // File state
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Mapping
  const [dateCol, setDateCol] = useState("");
  const [amountCol, setAmountCol] = useState("");
  const [descCol, setDescCol] = useState("");

  // Options
  const [accountId, setAccountId] = useState("");
  const [institution, setInstitution] = useState("");
  const [selectedMappingId, setSelectedMappingId] = useState("");

  // Import results
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);

  // Drag state
  const [dragOver, setDragOver] = useState(false);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts(await res.json());
  }, []);

  const fetchMappings = useCallback(async () => {
    const res = await fetch("/api/import/mappings");
    if (res.ok) setSavedMappings(await res.json());
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchMappings();
  }, [fetchAccounts, fetchMappings]);

  const parseFile = (f: File) => {
    setFile(f);
    setResult(null);
    Papa.parse(f, {
      complete: (results) => {
        const data = results.data as string[][];
        if (data.length > 0) {
          setCsvHeaders(data[0]);
          const rows = data.slice(1).filter((row) => row.some((cell) => cell.trim()));
          setCsvData(rows);
          setPreviewRows(rows.slice(0, 5));
        }
      },
      error: (err) => {
        console.error("CSV parse error:", err);
      },
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith(".csv")) parseFile(f);
  };

  const handleLoadMapping = (mappingId: string) => {
    setSelectedMappingId(mappingId);
    const mapping = savedMappings.find((m) => String(m.id) === mappingId);
    if (mapping) {
      try {
        const parsed = JSON.parse(mapping.mapping);
        if (parsed.date) setDateCol(parsed.date);
        if (parsed.amount) setAmountCol(parsed.amount);
        if (parsed.description) setDescCol(parsed.description);
        if (mapping.account_id) setAccountId(String(mapping.account_id));
        if (mapping.institution) setInstitution(mapping.institution);
      } catch {
        console.error("Failed to parse mapping");
      }
    }
  };

  const handleSaveMapping = async () => {
    if (!institution || !dateCol || !amountCol || !descCol) return;
    setSavingMapping(true);
    try {
      const res = await fetch("/api/import/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institution,
          account_id: accountId ? Number(accountId) : null,
          mapping: JSON.stringify({
            date: dateCol,
            amount: amountCol,
            description: descCol,
          }),
        }),
      });
      if (res.ok) {
        fetchMappings();
      }
    } catch (err) {
      console.error("Failed to save mapping:", err);
    } finally {
      setSavingMapping(false);
    }
  };

  const handleImport = async () => {
    if (!dateCol || !amountCol || !descCol || csvData.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const dateIdx = csvHeaders.indexOf(dateCol);
      const amountIdx = csvHeaders.indexOf(amountCol);
      const descIdx = csvHeaders.indexOf(descCol);

      const transactions = csvData.map((row) => ({
        date: row[dateIdx],
        amount: row[amountIdx],
        description: row[descIdx],
        account_id: accountId ? Number(accountId) : undefined,
      }));

      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions,
          institution: institution || undefined,
        }),
      });

      if (res.ok) {
        setResult(await res.json());
      } else {
        const err = await res.json();
        setResult({ imported: 0, duplicates: 0, errors: [err.error || "Import failed"] });
      }
    } catch (err) {
      console.error("Import error:", err);
      setResult({ imported: 0, duplicates: 0, errors: ["Network error"] });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Import Transactions</h1>

      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Upload CSV File</CardTitle>
          <CardDescription>
            Drag and drop a CSV file or click to browse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {csvData.length} rows detected
                </p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-medium">
                  Drop your CSV file here
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse files
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview and Mapping */}
      {csvHeaders.length > 0 && (
        <>
          {/* Preview Table */}
          <Card>
            <CardHeader>
              <CardTitle>Preview (First 5 Rows)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {csvHeaders.map((h, i) => (
                        <TableHead key={i}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, j) => (
                          <TableCell key={j} className="max-w-[200px] truncate">
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Column Mapping */}
          <Card>
            <CardHeader>
              <CardTitle>Column Mapping</CardTitle>
              <CardDescription>
                Map your CSV columns to the required fields.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="space-y-2">
                  <Label>Date Column *</Label>
                  <Select value={dateCol} onValueChange={setDateCol}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {csvHeaders.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount Column *</Label>
                  <Select value={amountCol} onValueChange={setAmountCol}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {csvHeaders.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Description Column *</Label>
                  <Select value={descCol} onValueChange={setDescCol}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      {csvHeaders.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Account (optional)</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
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
                  <Label>Institution Name (optional)</Label>
                  <Input
                    placeholder="e.g., Chase, Amex..."
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Load Saved Mapping</Label>
                  <Select
                    value={selectedMappingId}
                    onValueChange={handleLoadMapping}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a mapping" />
                    </SelectTrigger>
                    <SelectContent>
                      {savedMappings.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.institution}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button
                onClick={handleImport}
                disabled={importing || !dateCol || !amountCol || !descCol}
              >
                {importing ? "Importing..." : `Import ${csvData.length} Rows`}
              </Button>
              <Button
                variant="outline"
                onClick={handleSaveMapping}
                disabled={savingMapping || !institution || !dateCol}
              >
                {savingMapping ? "Saving..." : "Save Mapping"}
              </Button>
            </CardFooter>
          </Card>
        </>
      )}

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Import Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <Badge
                variant="default"
                className="text-base px-4 py-2 bg-green-600"
              >
                Imported: {result.imported}
              </Badge>
              <Badge
                variant="secondary"
                className="text-base px-4 py-2"
              >
                Duplicates: {result.duplicates}
              </Badge>
              {result.errors.length > 0 && (
                <Badge
                  variant="destructive"
                  className="text-base px-4 py-2"
                >
                  Errors: {result.errors.length}
                </Badge>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-sm font-medium text-red-600">Errors:</p>
                {result.errors.map((err, i) => (
                  <p key={i} className="text-sm text-red-600">
                    {err}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
