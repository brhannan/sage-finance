"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface PlaidSyncStatusProps {
  lastSyncedAt?: string | null;
  onSyncComplete?: () => void;
  itemId?: number;
}

export function PlaidSyncStatus({ lastSyncedAt, onSyncComplete, itemId }: PlaidSyncStatusProps) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/plaid/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { item_id: itemId } : {}),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");

      if (itemId) {
        setResult(`+${data.added} ~${data.modified} -${data.removed}`);
      } else {
        const total = data.results?.length || 0;
        const errors = data.results?.filter((r: { error?: string }) => r.error).length || 0;
        setResult(`Synced ${total} connection${total !== 1 ? "s" : ""}${errors > 0 ? ` (${errors} error${errors !== 1 ? "s" : ""})` : ""}`);
      }

      onSyncComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {lastSyncedAt && (
        <span className="text-sm text-muted-foreground">
          Last synced: {new Date(lastSyncedAt + "Z").toLocaleString()}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
        {syncing ? "Syncing..." : "Sync Now"}
      </Button>
      {result && <span className="text-sm text-green-600">{result}</span>}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
