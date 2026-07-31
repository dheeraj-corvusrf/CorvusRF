import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X, Send } from "lucide-react";
import { askRouter } from "@/lib/ask-router";
import { askAboutDocument } from "@/lib/document-ai";
import { buildUserContext } from "@/lib/ai-context";
import { useAuth } from "@/lib/auth";

type AskResult = { answer: string | null; destination: string | null };

// Floating, site-wide entry point that actually answers the question (via the
// same Gemini-backed answer engine used in document-review's "Ask AI" modal),
// with a secondary "Continue to X" link from route-intent underneath. The two
// calls run in parallel and degrade independently — a signed-in user's own
// properties/protests are included as context so the answer can reference
// their real deadlines/statuses, not just generic guidance. Still single-turn:
// no conversation memory.
export function AskAiWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);

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
    const q = query.trim();
    if (!q || asking) return;
    setAsking(true);
    setResult(null);
    try {
      const context = user ? await buildUserContext(user.id).catch(() => undefined) : undefined;
      const [answerRes, routeRes] = await Promise.allSettled([
        askAboutDocument({ question: q, context }),
        askRouter(q),
      ]);
      setResult({
        answer: answerRes.status === "fulfilled" ? answerRes.value.answer : null,
        destination: routeRes.status === "fulfilled" ? routeRes.value.destination : null,
      });
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
              <p className="text-sm whitespace-pre-wrap">
                {result.answer ?? "Sorry, I couldn't process that. Please try again."}
              </p>
              {result.destination && (
                <Link
                  to={result.destination}
                  onClick={close}
                  className="btn-primary btn-primary-hover mt-2 inline-flex text-xs py-1.5"
                >
                  Continue to this page
                </Link>
              )}
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
