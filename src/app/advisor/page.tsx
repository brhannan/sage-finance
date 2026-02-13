"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const MODEL_OPTIONS = [
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  conversation_type?: string;
  created_at: string;
}

interface QuickStats {
  netWorth?: number;
  savingsRate?: number;
}

interface LastResponse {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
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
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value);
  const [lastResponse, setLastResponse] = useState<LastResponse>({});
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [histRes, profileRes, metricsRes] = await Promise.all([
        fetch("/api/advisor"),
        fetch("/api/advisor/profile"),
        fetch("/api/metrics"),
      ]);

      if (histRes.ok) {
        const data = await histRes.json();
        setMessages(Array.isArray(data) ? data : []);
      }

      if (profileRes.ok) {
        const profile = await profileRes.json();
        setHasProfile(
          profile?.profile && Object.keys(profile.profile).length > 0
        );
      } else {
        setHasProfile(false);
      }

      const stats: QuickStats = {};
      if (metricsRes.ok) {
        const m = await metricsRes.json();
        stats.netWorth = m.netWorth?.total;
        stats.savingsRate = m.savingsRate?.rate;
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
    if ((!input.trim() && attachedFiles.length === 0) || sending) return;
    const userMessage = input.trim();
    const filesToSend = [...attachedFiles];
    setInput("");
    setAttachedFiles([]);
    setSending(true);

    // Optimistically add user message
    const fileNames = filesToSend.map((f) => f.name);
    const displayContent = filesToSend.length > 0
      ? `${userMessage ? userMessage + "\n" : ""}${fileNames.map((n) => `[Attached: ${n}]`).join("\n")}`
      : userMessage;
    const tempUserMsg: Message = {
      id: Date.now(),
      role: "user",
      content: displayContent,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      if (filesToSend.length > 0) {
        // Process each file sequentially
        for (const file of filesToSend) {
          const isPdf = file.name.toLowerCase().endsWith(".pdf");
          let fileData: string;
          if (isPdf) {
            // Read PDF as base64
            const buffer = await file.arrayBuffer();
            fileData = btoa(
              new Uint8Array(buffer).reduce(
                (data, byte) => data + String.fromCharCode(byte),
                ""
              )
            );
          } else {
            fileData = await file.text();
          }
          const res = await fetch("/api/advisor/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file: fileData,
              fileName: file.name,
              message: userMessage,
              model,
              fileType: isPdf ? "pdf" : "csv",
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.content) {
              const assistantMsg: Message = {
                id: Date.now() + filesToSend.indexOf(file) + 1,
                role: "assistant",
                content: data.content,
                created_at: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, assistantMsg]);
              setLastResponse({
                model: data.model,
                inputTokens: data.usage?.input_tokens,
                outputTokens: data.usage?.output_tokens,
                cost: data.cost,
              });
            }
          } else {
            const errData = await res.json().catch(() => null);
            const errMsg: Message = {
              id: Date.now() + filesToSend.indexOf(file) + 1,
              role: "assistant",
              content: `Failed to process **${file.name}**: ${errData?.error || "Unknown error"}`,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, errMsg]);
          }
        }
      } else {
        const res = await fetch("/api/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userMessage, model }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.content) {
            const assistantMsg: Message = {
              id: Date.now() + 1,
              role: "assistant",
              content: data.content,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setLastResponse({
              model: data.model,
              inputTokens: data.usage?.input_tokens,
              outputTokens: data.usage?.output_tokens,
              cost: data.cost,
            });
          }
        } else {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || "Request failed");
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      const errorMsg: Message = {
        id: Date.now() + 99,
        role: "assistant",
        content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : "Please try again."}`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      sendMessage();
    }
    // Ctrl/Cmd+Enter: default behavior inserts newline in textarea
  };

  const startOnboarding = () => {
    setInput(
      "Hi! I'd like to set up my financial profile. Can you help me get started?"
    );
    inputRef.current?.focus();
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const allFiles = Array.from(e.dataTransfer.files);
    const supported = allFiles.filter(
      (f) => f.name.endsWith(".csv") || f.name.endsWith(".pdf")
    );
    const skipped = allFiles.length - supported.length;
    if (supported.length > 0) {
      setAttachedFiles((prev) => [...prev, ...supported]);
    }
    if (skipped > 0) {
      const skippedNames = allFiles
        .filter((f) => !f.name.endsWith(".csv") && !f.name.endsWith(".pdf"))
        .map((f) => f.name)
        .join(", ");
      const errorMsg: Message = {
        id: Date.now() + 98,
        role: "assistant",
        content: `I can only process CSV and PDF files. Skipped: ${skippedNames}`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...files]);
    }
    // Reset so the same file can be re-selected
    e.target.value = "";
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
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessages([])}
              disabled={sending}
            >
              Clear Chat
            </Button>
          )}
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
        <div
          className={`flex-1 border rounded-lg overflow-hidden flex flex-col transition-colors ${
            dragOver ? "border-primary bg-primary/5" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            // Only handle leave when actually leaving the container
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOver(false);
            }
          }}
          onDrop={handleFileDrop}
        >
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
                          : msg.conversation_type === "proactive"
                            ? "bg-violet-50 border border-violet-200"
                            : "bg-muted"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1 prose-hr:my-2 prose-table:border-collapse prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-1.5 prose-th:bg-muted prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      )}
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
          <div className="p-4 space-y-2">
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, idx) => (
                  <div key={`${file.name}-${idx}`} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="truncate max-w-[200px]">{file.name}</span>
                    <button
                      onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-foreground ml-1"
                      aria-label={`Remove ${file.name}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-[140px] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="shrink-0 p-2 rounded-md border hover:bg-accent transition-colors disabled:opacity-50"
                title="Attach CSV or PDF files"
                aria-label="Attach CSV or PDF files"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.pdf"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={attachedFiles.length > 0 ? "Add a message about these files... (e.g., 'add this to my spending data')" : "Ask your financial advisor... (Ctrl+Enter for newline)"}
                disabled={sending}
                rows={1}
                className="flex-1 resize-none overflow-y-auto max-h-[120px]"
              />
              <Button onClick={sendMessage} disabled={sending || (!input.trim() && attachedFiles.length === 0)}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
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

        {lastResponse.model && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Last Response</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div>
                <p className="text-muted-foreground">Model</p>
                <p className="font-mono">{lastResponse.model}</p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground">Tokens</p>
                <p>
                  {lastResponse.inputTokens?.toLocaleString()} in /{" "}
                  {lastResponse.outputTokens?.toLocaleString()} out
                </p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground">Cost</p>
                <p>${lastResponse.cost?.toFixed(4)}</p>
              </div>
            </CardContent>
          </Card>
        )}

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
