import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import heroImage from "@/assets/hero.jpg";
import { updateIntake, resetIntake, classifyAndStoreDocument } from "@/lib/intake-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

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

function Home() {
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [uploading, setUploading] = useState(false);

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

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <img
          src={heroImage}
          alt="Aerial view of a Texas commercial property district"
          width={1600}
          height={1000}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-brand/85 via-brand/75 to-brand/95" />
      </div>

      <div className="container-page py-20 md:py-28 text-brand-foreground">
        <div className="max-w-3xl">
          <span className="badge-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Texas • All 254 counties
          </span>
          <h1 className="mt-4 font-serif text-4xl md:text-6xl font-semibold leading-[1.05]">
            Texas property tax help, <span className="text-accent">powered by AI.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-brand-foreground/85">
            Upload your notice or enter your property. AI checks your county value, BPP filing
            needs, protest deadline, possible overvaluation, evidence gaps, and savings opportunity
            — before you even sign in.
          </p>

          <form
            onSubmit={submit}
            className="mt-8 flex flex-col sm:flex-row gap-2 bg-background/95 p-2 rounded-xl shadow-elev"
          >
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              placeholder="Enter a commercial property address in Texas"
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground px-4 py-3 outline-none rounded-lg"
              ariaLabel="Commercial property address"
            />
            <button type="submit" className="btn-accent">
              Start Free AI Property Review
            </button>
          </form>

          <div className="mt-6 flex flex-wrap gap-3">
            <label className="btn-outline bg-brand-foreground/10 border-white/30 text-brand-foreground hover:bg-brand-foreground/20 cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                disabled={uploading}
                onChange={onFile}
              />
              {uploading ? "Reading document…" : "Upload Appraisal Notice"}
            </label>
            <Link
              to="/intake"
              onClick={() => resetIntake()}
              className="btn-outline bg-brand-foreground/10 border-white/30 text-brand-foreground hover:bg-brand-foreground/20"
            >
              Check My Property Taxes
            </Link>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-3 max-w-2xl">
            {[
              "Reads your county's rules automatically",
              "Finds evidence humans usually miss",
              "Tracks deadlines, filings & savings",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-brand-foreground/90">
                <CheckIcon /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="mt-0.5 h-4 w-4 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
