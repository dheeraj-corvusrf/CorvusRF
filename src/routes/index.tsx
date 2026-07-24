import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Upload, Wallet, Send, Sparkles } from "lucide-react";
import { updateIntake, resetIntake, classifyAndStoreDocument } from "@/lib/intake-store";
import { askRouter } from "@/lib/ask-router";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { SampleNoticeDialog } from "@/components/SampleNoticeDialog";
import { HeroBackground } from "@/components/HeroBackground";
import { MicButton } from "@/components/MicButton";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CorvusRF.ai — Texas Property Tax Management, Powered by AI" },
      {
        name: "description",
        content:
          "Upload your Texas appraisal notice or enter your commercial property. AI checks your county value, protest deadline, evidence gaps, and savings opportunity.",
      },
      { property: "og:title", content: "CorvusRF.ai — Texas Property Tax, Powered by AI" },
      {
        property: "og:description",
        content:
          "AI-powered Texas property tax platform: protest, BPP rendition, payments, refunds, and savings tracking in one place.",
      },
    ],
  }),
  component: Home,
});

const PROMPT_CHIPS = [
  "My appraisal is too high",
  "I missed my deadline",
  "I need my EPIN",
  "I own a daycare",
  "I want to protest my value",
  "I need to pay taxes",
];

function Home() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [uploading, setUploading] = useState(false);
  const [askQuery, setAskQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<{ destination: string; message: string } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    resetIntake();
    updateIntake({ address: address.trim() });
    navigate({ to: "/intake" });
  };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await classifyAndStoreDocument(f);
      navigate({ to: "/document-review" });
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Could not read this document. Please try again.",
      );
      setUploading(false);
    }
  }

  async function submitAsk(query: string) {
    if (!query.trim()) return;
    setAsking(true);
    setAskResult(null);
    try {
      const result = await askRouter(query.trim());
      setAskResult(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process that. Please try again.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="relative overflow-hidden min-h-[70vh]">
      <HeroBackground />
      <div className="container-page pt-8 pb-16 md:pt-12 md:pb-24">
      <div className="mx-auto max-w-3xl text-center">
        <span className="badge-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI Powered Property Tax Assistant
        </span>
        <h1 className="mt-5 font-serif text-4xl md:text-6xl font-semibold leading-[1.1]">
          AI-Powered Property Tax
          <br />
          <span className="text-accent">&amp; Protest Management</span>
          <br />
          From Notice to Savings.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Upload your notice or enter your property address. Check value. File BPP. Protest
          overvaluation. Track your savings — all in one place.
        </p>

        <form
          onSubmit={submit}
          className="mt-8 flex flex-col sm:flex-row sm:items-center gap-2 bg-card p-2 rounded-xl shadow-elev border border-border"
        >
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            placeholder="Enter a commercial property address in Texas"
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground px-4 py-3 outline-none rounded-lg"
            ariaLabel="Commercial property address"
          />
          <MicButton onResult={setAddress} />
          <button type="submit" className="btn-accent">
            Start Free AI Property Review
          </button>
        </form>

        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <label
            className={`btn-outline inline-flex items-center gap-2 cursor-pointer ${
              uploading ? "opacity-60 pointer-events-none" : ""
            }`}
          >
            <Upload className="h-4 w-4" />
            <input
              type="file"
              className="hidden"
              accept=".pdf,image/*"
              disabled={uploading}
              onChange={onFile}
            />
            Upload Appraisal Notice
          </label>
          <Link
            to="/intake"
            onClick={() => resetIntake()}
            className="btn-outline inline-flex items-center gap-2"
          >
            <Wallet className="h-4 w-4" />
            Check My Property Taxes
          </Link>
        </div>

        <div className="mt-3 flex justify-center">
          <SampleNoticeDialog />
        </div>

        <div className="mt-10 card-elev p-2 flex items-center gap-2 text-left">
          <span className="ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/20 text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitAsk(askQuery);
            }}
            className="flex flex-1 items-center gap-2"
          >
            <input
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              placeholder="Ask AI what to do with your property tax notice."
              className="flex-1 bg-transparent px-1 py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={asking || !askQuery.trim()}
              className="btn-accent px-3 py-2 disabled:opacity-50"
              aria-label="Ask AI"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {PROMPT_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => {
                setAskQuery(chip);
                submitAsk(chip);
              }}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm hover:text-foreground hover:border-accent transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>

        {asking && (
          <div className="mt-4 card-elev p-4 text-left text-sm text-muted-foreground">
            AI is thinking…
          </div>
        )}
        {askResult && !asking && (
          <div className="mt-4 card-elev p-4 text-left">
            <p className="text-sm">{askResult.message}</p>
            <Link
              to={askResult.destination}
              className="btn-primary btn-primary-hover mt-3 inline-flex text-sm py-2"
            >
              Continue
            </Link>
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
