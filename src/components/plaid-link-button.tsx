"use client";

import { useState, useCallback } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";

interface PlaidLinkButtonProps {
  onSuccess?: () => void;
  itemId?: number; // For update mode (re-linking)
  children?: React.ReactNode;
}

export function PlaidLinkButton({ onSuccess, children }: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLinkToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/create-link-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create link token");
      setLinkToken(data.link_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link token");
      setLoading(false);
    }
  };

  const handleSuccess = useCallback(
    async (publicToken: string, metadata: { institution?: { name?: string; institution_id?: string } | null }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token: publicToken,
            institution: metadata.institution
              ? { name: metadata.institution.name, id: metadata.institution.institution_id }
              : null,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to exchange token");
        }
        setLinkToken(null);
        onSuccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect account");
      } finally {
        setLoading(false);
      }
    },
    [onSuccess]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: () => {
      setLinkToken(null);
      setLoading(false);
    },
  });

  // Auto-open when link token is ready
  if (linkToken && ready) {
    open();
  }

  return (
    <div>
      <Button
        onClick={fetchLinkToken}
        disabled={loading}
      >
        {loading ? "Connecting..." : children || "Connect Bank Account"}
      </Button>
      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  );
}
