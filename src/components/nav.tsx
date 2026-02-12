"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/transactions", label: "Transactions" },
  { href: "/spending", label: "Spending" },
  { href: "/income", label: "Income" },
  { href: "/net-worth", label: "Net Worth" },
  { href: "/goals", label: "Goals" },
  { href: "/fi-tracker", label: "FI Tracker" },
  { href: "/home-buying", label: "Home Buying" },
  { href: "/advisor", label: "AI Advisor" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b bg-background">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-14 gap-6">
          <Link href="/" className="font-bold text-lg shrink-0">
            Sage Finance
          </Link>
          <div className="flex items-center gap-1 overflow-x-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                  pathname === item.href
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto shrink-0">
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
