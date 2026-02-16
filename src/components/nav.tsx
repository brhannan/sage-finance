"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/advisor", label: "AI Advisor", accent: true },
  { href: "/transactions", label: "Transactions" },
  { href: "/spending", label: "Spending" },
  { href: "/income", label: "Income" },
  { href: "/net-worth", label: "Net Worth" },
  { href: "/goals", label: "Goals" },
  { href: "/fi-tracker", label: "FI Tracker" },
  { href: "/home-buying", label: "Home Buying" },
  { href: "/connected-accounts", label: "Connections" },
];

function SparklesIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block -mt-0.5"
    >
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M3 5h4" />
      <path d="M19 17v4" />
      <path d="M17 19h4" />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/demo/toggle")
      .then((r) => r.json())
      .then((data) => setDemoMode(data.mode === "demo"))
      .catch(() => {});
  }, []);

  const toggleDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/demo/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demo: !demoMode }),
      });
      const data = await res.json();
      setDemoMode(data.mode === "demo");
      window.location.reload();
    } catch {
      setLoading(false);
    }
  };

  return (
    <nav
      className={cn(
        "border-b bg-background",
        demoMode && "border-t-2 border-t-amber-500"
      )}
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14 gap-6">
          <Link href="/" className="font-bold text-lg shrink-0">
            Sage Finance
          </Link>
          {demoMode && (
            <span className="text-xs font-bold text-amber-600 bg-amber-100 dark:bg-amber-950 dark:text-amber-400 px-2 py-0.5 rounded">
              DEMO MODE
            </span>
          )}
          <div className="flex items-center gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const isAccent = 'accent' in item && item.accent;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                    isActive
                      ? isAccent
                        ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                        : "bg-primary text-primary-foreground"
                      : isAccent
                        ? "text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 hover:text-violet-700"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  {isAccent && <SparklesIcon />}{" "}
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="ml-auto shrink-0 flex items-center gap-2">
            <button
              onClick={toggleDemo}
              disabled={loading}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                loading && "opacity-50 cursor-not-allowed",
                demoMode
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              {loading ? "..." : demoMode ? "Exit Demo" : "Try Demo"}
            </button>
            <Link
              href="/import"
              className="px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Import CSV
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
