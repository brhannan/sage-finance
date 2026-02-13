"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface InsightsData {
  summary: string;
  going_well: string[];
  to_improve: string[];
  detailed_report?: string;
}

function renderMarkdown(md: string) {
  // Simple markdown renderer for headings, bold, lists, paragraphs
  const lines = md.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const Tag = listType;
      elements.push(
        <Tag
          key={elements.length}
          className={`${listType === "ol" ? "list-decimal" : "list-disc"} ml-5 space-y-1 text-sm text-muted-foreground`}
        >
          {listItems.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inlineMd(item) }} />
          ))}
        </Tag>
      );
      listItems = [];
      listType = null;
    }
  };

  const inlineMd = (text: string) => {
    return text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h2
          key={elements.length}
          className="text-lg font-semibold mt-6 mb-2 first:mt-0"
        >
          {trimmed.slice(3)}
        </h2>
      );
    } else if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h3
          key={elements.length}
          className="text-base font-semibold mt-4 mb-1"
        >
          {trimmed.slice(4)}
        </h3>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(trimmed.replace(/^\d+\.\s/, ""));
    } else if (trimmed.startsWith("- ")) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushList();
    } else {
      flushList();
      elements.push(
        <p
          key={elements.length}
          className="text-sm text-muted-foreground mb-2"
          dangerouslySetInnerHTML={{ __html: inlineMd(trimmed) }}
        />
      );
    }
  }
  flushList();

  return <>{elements}</>;
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/insights")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setInsights(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-violet-500 animate-pulse"
          >
            <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
          </svg>
          <span className="text-lg">Generating financial report...</span>
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Financial Report</h1>
        <p className="text-muted-foreground">
          Unable to generate report.{" "}
          <Link href="/advisor" className="text-primary hover:underline">
            Chat with your advisor
          </Link>{" "}
          instead.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-violet-500"
          >
            <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
          </svg>
          <h1 className="text-3xl font-bold tracking-tight">
            Financial Report
          </h1>
        </div>
        <Link href="/advisor">
          <Button variant="outline" size="sm">
            Ask AI Advisor
          </Button>
        </Link>
      </div>

      {/* Quick summary */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <p className="text-sm font-medium">{insights.summary}</p>
          <Separator className="my-3" />
          <div className="flex gap-6 text-sm">
            <div className="space-y-1">
              {insights.going_well.map((item, i) => (
                <p key={i} className="text-muted-foreground">
                  <span className="text-green-500">&#x2713;</span> {item}
                </p>
              ))}
            </div>
            <div className="space-y-1">
              {insights.to_improve.map((item, i) => (
                <p key={i} className="text-muted-foreground">
                  <span className="text-amber-500">&#x25B8;</span> {item}
                </p>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Full report */}
      {insights.detailed_report && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Detailed Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            {renderMarkdown(insights.detailed_report)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
