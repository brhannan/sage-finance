"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaidLinkButton } from "@/components/plaid-link-button";
import { PlaidSyncStatus } from "@/components/plaid-sync-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PlaidStatus {
  configured: boolean;
  environment: string;
  item_count: number;
  active_item_count: number;
}

interface PlaidItem {
  id: number;
  item_id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  last_synced_at: string | null;
  account_count: number;
  account_names: string | null;
  created_at: string;
}

interface SyncLog {
  id: number;
  plaid_item_id: number;
  institution_name: string | null;
  status: string;
  transactions_added: number;
  transactions_modified: number;
  transactions_removed: number;
  error_message: string | null;
  created_at: string;
}

export default function ConnectedAccountsPage() {
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    const [statusRes, itemsRes, logsRes] = await Promise.all([
      fetch("/api/plaid/status"),
      fetch("/api/plaid/items"),
      fetch("/api/plaid/sync"),
    ]);
    const [statusData, itemsData, logsData] = await Promise.all([
      statusRes.json(),
      itemsRes.json(),
      logsRes.json(),
    ]);
    setStatus(statusData);
    setItems(Array.isArray(itemsData) ? itemsData : []);
    setSyncLogs(Array.isArray(logsData) ? logsData : []);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDisconnect = async (itemId: number) => {
    if (!confirm("Are you sure you want to disconnect this account? Transaction history will be preserved.")) return;
    setDisconnecting(itemId);
    try {
      await fetch(`/api/plaid/items?id=${itemId}`, { method: "DELETE" });
      fetchData();
    } finally {
      setDisconnecting(null);
    }
  };

  if (!status) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Connected Accounts</h1>
          <p className="text-muted-foreground">
            Manage bank connections for automatic transaction syncing
          </p>
        </div>
        {status.configured && (
          <PlaidLinkButton onSuccess={fetchData}>Connect Bank Account</PlaidLinkButton>
        )}
      </div>

      {!status.configured && (
        <Card>
          <CardHeader>
            <CardTitle>Setup Required</CardTitle>
            <CardDescription>
              Plaid is not configured. Add your Plaid API keys to enable automatic bank syncing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Sign up at <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noopener noreferrer" className="text-primary underline">dashboard.plaid.com</a></li>
              <li>Get your API keys from Team Settings &gt; Keys</li>
              <li>Add to your <code className="bg-muted px-1 rounded">.env.local</code> file:</li>
            </ol>
            <pre className="bg-muted p-3 rounded text-sm font-mono">
{`PLAID_CLIENT_ID=your-client-id
PLAID_SECRET=your-secret
PLAID_ENV=sandbox`}
            </pre>
            <p className="text-sm text-muted-foreground">
              Start with <strong>sandbox</strong> for testing (use <code className="bg-muted px-1 rounded">user_good</code> / <code className="bg-muted px-1 rounded">pass_good</code>), then apply for <strong>development</strong> access for real accounts.
            </p>
          </CardContent>
        </Card>
      )}

      {status.configured && (
        <>
          {/* Status Overview */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Sync Status</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{status.environment}</Badge>
                  <Badge variant="secondary">
                    {status.active_item_count} active connection{status.active_item_count !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <PlaidSyncStatus onSyncComplete={fetchData} />
            </CardContent>
          </Card>

          {/* Connected Items */}
          {items.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Connections</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Institution</TableHead>
                      <TableHead>Accounts</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Synced</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.institution_name || "Unknown Institution"}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {item.account_names || `${item.account_count} account${item.account_count !== 1 ? "s" : ""}`}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.status === "active" ? "default" :
                              item.status === "error" ? "destructive" : "secondary"
                            }
                          >
                            {item.status}
                          </Badge>
                          {item.error_message && (
                            <p className="text-xs text-destructive mt-1">{item.error_message}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.last_synced_at
                            ? new Date(item.last_synced_at + "Z").toLocaleString()
                            : "Never"}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <PlaidSyncStatus itemId={item.id} onSyncComplete={fetchData} />
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDisconnect(item.id)}
                            disabled={disconnecting === item.id}
                          >
                            {disconnecting === item.id ? "..." : "Disconnect"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground mb-4">No bank accounts connected yet.</p>
                <PlaidLinkButton onSuccess={fetchData}>Connect Your First Account</PlaidLinkButton>
              </CardContent>
            </Card>
          )}

          {/* Sync History */}
          {syncLogs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Sync History</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Institution</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncLogs.slice(0, 20).map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm">
                          {new Date(log.created_at + "Z").toLocaleString()}
                        </TableCell>
                        <TableCell>{log.institution_name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={log.status === "success" ? "default" : "destructive"}>
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.status === "success"
                            ? `+${log.transactions_added} added, ~${log.transactions_modified} modified, -${log.transactions_removed} removed`
                            : log.error_message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
