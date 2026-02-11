"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

interface QuickStats {
  netWorth?: number;
  savingsRate?: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export default function AdvisorPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasProfile, setHasProfile] = useState(true);
  const [quickStats, setQuickStats] = useState<QuickStats>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [histRes, profileRes, nwRes, srRes] = await Promise.all([
        fetch("/api/advisor/history"),
        fetch("/api/advisor/profile"),
        fetch("/api/dashboard/net-worth"),
        fetch("/api/dashboard/savings-rate"),
      ]);

      if (histRes.ok) {
        const data = await histRes.json();
        setMessages(Array.isArray(data) ? data : []);
      }

      if (profileRes.ok) {
        const profile = await profileRes.json();
        setHasProfile(
          profile && Object.keys(profile).length > 0
        );
      } else {
        setHasProfile(false);
      }

      const stats: QuickStats = {};
      if (nwRes.ok) {
        const nw = await nwRes.json();
        stats.netWorth = nw.total;
      }
      if (srRes.ok) {
        const sr = await srRes.json();
        stats.savingsRate = sr.rate;
      }
      setQuickStats(stats);
    } catch (err) {
      console.error("Failed to load advisor data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput("");
    setSending(true);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: Date.now(),
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages);
        } else if (data.reply) {
          const assistantMsg: Message = {
            id: Date.now() + 1,
            role: "assistant",
            content: data.reply,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      const errorMsg: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content:
          "Sorry, I encountered an error. Please try again.",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startOnboarding = () => {
    setInput(
      "Hi! I'd like to set up my financial profile. Can you help me get started?"
    );
    inputRef.current?.focus();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground text-lg">
          Loading AI Advisor...
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-120px)]">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold tracking-tight">AI Advisor</h1>
        </div>

        {/* Onboarding prompt */}
        {!hasProfile && messages.length === 0 && (
          <Card className="mb-4">
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <p className="text-lg font-medium">Welcome to your AI Financial Advisor</p>
                <p className="text-muted-foreground">
                  It looks like you haven&apos;t set up your financial profile yet.
                  Let&apos;s get started with a quick onboarding conversation.
                </p>
                <Button onClick={startOnboarding}>
                  Start Onboarding
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Messages */}
        <div className="flex-1 border rounded-lg overflow-hidden flex flex-col">
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.length === 0 && hasProfile && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">
                    Start a conversation with your AI financial advisor.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Ask about budgeting, savings strategies, FI planning, or
                    anything financial.
                  </p>
                </div>
              )}

              {messages
                .filter((m) => m.role !== "system")
                .map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-3 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">
                        {msg.content}
                      </p>
                      <p
                        className={`text-xs mt-1 ${
                          msg.role === "user"
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-4 py-3">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" />
                      <div
                        className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <div
                        className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input Area */}
          <Separator />
          <div className="p-4 flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your financial advisor..."
              disabled={sending}
              className="flex-1"
            />
            <Button onClick={sendMessage} disabled={sending || !input.trim()}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </div>

      {/* Sidebar - Quick Stats */}
      <div className="hidden lg:block w-64 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quick Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Net Worth</p>
              <p className="text-lg font-semibold">
                {quickStats.netWorth !== undefined
                  ? fmt(quickStats.netWorth)
                  : "--"}
              </p>
            </div>
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground">Savings Rate</p>
              <p className="text-lg font-semibold">
                {quickStats.savingsRate !== undefined
                  ? `${quickStats.savingsRate}%`
                  : "--%"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Suggestions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              "Review my spending this month",
              "How am I doing on my goals?",
              "What should I prioritize?",
              "Help me create a budget",
              "Am I ready to buy a home?",
            ].map((suggestion) => (
              <button
                key={suggestion}
                className="w-full text-left text-xs p-2 rounded border hover:bg-accent transition-colors"
                onClick={() => {
                  setInput(suggestion);
                  inputRef.current?.focus();
                }}
              >
                {suggestion}
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
