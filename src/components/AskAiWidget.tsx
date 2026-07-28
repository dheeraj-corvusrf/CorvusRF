import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X, Send } from "lucide-react";
import { toast } from "sonner";
import { askRouter, type RouteIntentResult } from "@/lib/ask-router";

// Floating, site-wide entry point for the same route-intent assistant already
// used inline on the homepage and dashboard — one question in, one short answer
// and a suggested page out. No conversation memory and no access to the user's
// own data; see route-intent's fixed DESTINATIONS list for what it can point to.
export function AskAiWidget() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<RouteIntentResult | null>(null);

  function reset() {
    setQuery("");
    setResult(null);
    setAsking(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || asking) return;
    setAsking(true);
    setResult(null);
    try {
      const r = await askRouter(query.trim());
      setResult(r);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process that. Please try again.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="print:hidden fixed bottom-5 right-5 z-40">
      {open && (
        <div className="mb-3 w-80 card-elev p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Sparkles className="h-4 w-4 text-accent" />
              Ask AI
            </div>
            <button
              onClick={close}
              aria-label="Close Ask AI"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Ask about protests, BPP, deadlines, or payments — I'll point you to the right place.
          </p>
          <form onSubmit={submit} className="mt-3 flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe the situation…"
              disabled={asking}
              autoFocus
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={asking || !query.trim()}
              aria-label="Send"
              className="btn-accent px-2.5 py-1.5 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          {asking && <p className="mt-3 text-xs text-muted-foreground">AI is thinking…</p>}
          {result && !asking && (
            <div className="mt-3 rounded-md bg-secondary/50 p-3">
              <p className="text-sm">{result.message}</p>
              <Link
                to={result.destination}
                onClick={close}
                className="btn-primary btn-primary-hover mt-2 inline-flex text-xs py-1.5"
              >
                Continue
              </Link>
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close Ask AI" : "Open Ask AI"}
        className="grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-foreground shadow-lg transition-opacity hover:opacity-90"
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>
    </div>
  );
}
