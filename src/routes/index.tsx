import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Upload, Home as HomeIcon, Sparkles, TrendingDown, Scale, Briefcase, Receipt, PiggyBank, ArrowRight } from "lucide-react";
import {
  updateIntake,
  resetIntake,
  classifyAndStoreDocument,
  type PropertyKind,
} from "@/lib/intake-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { SampleNoticeDialog } from "@/components/SampleNoticeDialog";
import { HeroBackground } from "@/components/HeroBackground";
import { MicButton } from "@/components/MicButton";
import { AnimatedSteps } from "@/components/AnimatedSteps";
import { ScrollReveal } from "@/components/ScrollReveal";
import { HouseIllustration } from "@/assets/illustrations/house";
import { useFileDrop } from "@/hooks/use-file-drop";
import { ICON_COLORS } from "@/lib/icon-colors";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CorvusRF.ai — Texas Property Tax Management, Powered by AI" },
      {
        name: "description",
        content:
          "Upload your Texas appraisal notice or enter your commercial or residential property. AI checks your county value, protest deadline, evidence gaps, and savings opportunity.",
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

function Home() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [propertyKind, setPropertyKind] = useState<PropertyKind>("commercial");
  const [uploading, setUploading] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    resetIntake();
    updateIntake({ address: address.trim(), propertyKind });
    navigate({ to: "/intake" });
  };

  async function onFile(f: File) {
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

  const { isDragging, dropHandlers } = useFileDrop(onFile, uploading);

  return (
    <>
    <section className="relative overflow-hidden min-h-[calc(100dvh-4rem)] flex flex-col justify-center">
      <HeroBackground />
      <div className="container-page pt-8 pb-0 md:pt-12 md:pb-2">
      <div className="mx-auto max-w-3xl text-center">
        <span className="badge-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> AI Powered Property Tax Assistant
        </span>
        <h1 className="mt-5 font-serif text-3xl sm:text-4xl md:text-6xl font-semibold leading-[1.15] md:leading-[1.1]">
          AI-Powered Property Tax
          <br className="hidden md:block" />{" "}
          <span className="text-accent">&amp; Protest Management</span>
          <br className="hidden md:block" />{" "}
          From Notice to Savings.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Upload your notice or enter your property address. Check value. File BPP. Protest
          overvaluation. Track your savings — all in one place.
        </p>

        <div className="mt-8 flex justify-center" role="radiogroup" aria-label="Property type">
          <div className="inline-flex rounded-full border border-border bg-card p-1 shadow-sm">
            {(["commercial", "residential"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={propertyKind === kind}
                onClick={() => setPropertyKind(kind)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                  propertyKind === kind
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {kind}
              </button>
            ))}
          </div>
        </div>

        <form
          onSubmit={submit}
          className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 bg-card p-2 rounded-xl shadow-elev border border-border"
        >
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            placeholder={`Enter a ${propertyKind} property address in Texas`}
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground px-4 py-3 outline-none rounded-lg"
            ariaLabel={`${propertyKind === "commercial" ? "Commercial" : "Residential"} property address`}
          />
          <MicButton onResult={setAddress} />
          <button type="submit" className="btn-accent">
            Start Free AI Property Review
          </button>
        </form>

        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <label
            className={`btn-outline inline-flex items-center gap-2 cursor-pointer bg-card shadow-elev ${
              uploading ? "opacity-60 pointer-events-none" : ""
            } ${isDragging ? "ring-2 ring-accent" : ""}`}
            style={{ backgroundColor: "var(--color-card)" }}
            {...dropHandlers}
          >
            <Upload className="h-4 w-4" />
            <input
              type="file"
              className="hidden"
              accept=".pdf,image/*"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            {isDragging ? "Drop to upload" : uploading ? "Reading document…" : "Upload Appraisal Notice"}
          </label>
        </div>

        {uploading ? (
          <div className="mt-6 mx-auto max-w-md card-elev p-5 text-left">
            <h3 className="font-serif text-base font-semibold">AI is reading your document…</h3>
            <AnimatedSteps
              steps={[
                { label: "OCR & text extraction", status: "done" },
                { label: "Classifying document type", status: "active" },
                { label: "Extracting owner, values, and deadlines", status: "active" },
              ]}
            />
          </div>
        ) : (
          <div className="mt-3 flex justify-center">
            <SampleNoticeDialog triggerClassName="rounded-full bg-card px-3 py-1.5 shadow-elev text-foreground hover:text-accent" />
          </div>
        )}
      </div>
      </div>
    </section>

    {/* From Notice to Savings in 3 Steps — a condensed summary of the full
        6-step breakdown on /how-it-works, not a restatement of it. */}
    <section className="container-page py-14 md:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="badge-soft">How It Works</span>
        <h2 className="mt-3 font-serif text-3xl md:text-4xl font-semibold">
          From Notice to Savings in 3 Steps
        </h2>
      </div>
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {PROCESS_STEPS.map((step, i) => (
          <ScrollReveal key={step.title} delay={i * 150} className="text-center">
            <span className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${step.color.bg} ${step.color.text}`}>
              <step.icon className="h-6 w-6" />
            </span>
            <h3 className="mt-4 font-serif text-lg font-semibold">{step.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
          </ScrollReveal>
        ))}
      </div>
      <div className="mt-10 text-center">
        <Link
          to="/how-it-works"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          See the full process <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>

    {/* How CorvusRF Helps You Save — real, existing services only (no stats,
        no testimonials — see plan notes on why those are out of scope). */}
    <section className="bg-secondary/30 py-14 md:py-20">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <span className="badge-soft">What You Get</span>
          <h2 className="mt-3 font-serif text-3xl md:text-4xl font-semibold">
            How CorvusRF Helps You Save
          </h2>
        </div>
        <div className="mt-12 grid items-center gap-6 md:grid-cols-3">
          <div className="order-2 grid gap-6 md:order-1">
            {SAVE_FEATURES.slice(0, 2).map((f, i) => (
              <FeatureCard key={f.title} feature={f} delay={i * 150} />
            ))}
          </div>
          <div className="order-1 md:order-2 relative mx-auto grid place-items-center py-8">
            <span className="radiate-ring absolute h-40 w-40 rounded-full border-2 border-accent/30" />
            <span
              className="radiate-ring absolute h-40 w-40 rounded-full border-2 border-accent/30"
              style={{ animationDelay: "1s" }}
            />
            <span
              className="radiate-ring absolute h-40 w-40 rounded-full border-2 border-accent/30"
              style={{ animationDelay: "2s" }}
            />
            <HouseIllustration className="relative h-40 w-auto" />
          </div>
          <div className="order-3 grid gap-6">
            {SAVE_FEATURES.slice(2, 4).map((f, i) => (
              <FeatureCard key={f.title} feature={f} delay={(i + 2) * 150} />
            ))}
          </div>
        </div>
      </div>
    </section>
    </>
  );
}

const PROCESS_STEPS = [
  {
    title: "Tell us about your property",
    description: "Enter your address or upload a notice — AI matches your county's official record.",
    icon: HomeIcon,
    color: ICON_COLORS[0], // blue — start
  },
  {
    title: "AI reviews your case",
    description:
      "Ten AI modules analyze value, comps, and evidence, while CorvusRF staff handle filing and the county.",
    icon: Sparkles,
    color: ICON_COLORS[1], // violet — AI at work
  },
  {
    title: "Track your savings",
    description: "One dashboard for deadlines, payments, refunds, and savings — always up to date.",
    icon: TrendingDown,
    color: ICON_COLORS[5], // green — done/positive
  },
] as const;

const SAVE_FEATURES = [
  {
    title: "Property Tax Protest",
    description: "AI-backed evidence and CorvusRF staff filing to challenge an overvalued assessment.",
    icon: Scale,
    to: "/property-protest",
    color: ICON_COLORS[0],
  },
  {
    title: "BPP Rendition",
    description: "Business personal property accounts tracked and rendered correctly, every year.",
    icon: Briefcase,
    to: "/bpp-rendition",
    color: ICON_COLORS[1],
  },
  {
    title: "Tax Payment Tracking",
    description: "Know what's due, when, and what's already been paid — for every property you own.",
    icon: Receipt,
    to: "/tax-payment",
    color: ICON_COLORS[2],
  },
  {
    title: "Property Tax Management",
    description: "One place for deadlines, documents, and savings across your whole portfolio.",
    icon: PiggyBank,
    to: "/property-tax-management",
    color: ICON_COLORS[3],
  },
] as const;

function FeatureCard({
  feature,
  delay,
}: {
  feature: (typeof SAVE_FEATURES)[number];
  delay: number;
}) {
  return (
    <ScrollReveal delay={delay}>
      <Link to={feature.to} className="card-elev flex gap-4 p-5 hover:bg-secondary/40">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${feature.color.bg} ${feature.color.text}`}>
          <feature.icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-serif text-base font-semibold">{feature.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
        </div>
      </Link>
    </ScrollReveal>
  );
}
