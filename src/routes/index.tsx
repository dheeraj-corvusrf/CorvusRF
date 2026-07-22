import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import heroImage from "@/assets/hero.jpg";
import { updateIntake } from "@/lib/intake-store";
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    updateIntake({ address: address.trim() });
    navigate({ to: "/intake" });
  };

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
        <div className="absolute inset-0 bg-gradient-to-b from-hero-overlay/85 via-hero-overlay/75 to-hero-overlay/95" />
      </div>

      <div className="container-page py-20 md:py-28 text-hero-foreground">
        <div className="max-w-3xl">
          <span className="badge-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Texas • All 254 counties
          </span>
          <h1 className="mt-4 font-serif text-4xl md:text-6xl font-semibold leading-[1.05]">
            Texas property tax help,{" "}
            <span className="text-accent">powered by AI.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-hero-foreground/85">
            Upload your notice or enter your property. AI checks your county value, BPP filing
            needs, protest deadline, possible overvaluation, evidence gaps, and savings
            opportunity — before you even sign in.
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
            <Link to="/intake" className="btn-outline bg-hero-foreground/10 border-white/30 text-hero-foreground hover:bg-hero-foreground/20">
              Upload Appraisal Notice
            </Link>
            <Link to="/intake" className="btn-outline bg-hero-foreground/10 border-white/30 text-hero-foreground hover:bg-hero-foreground/20">
              Check My Property Taxes
            </Link>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-3 max-w-2xl">
            {[
              "Reads your county's rules automatically",
              "Finds evidence humans usually miss",
              "Tracks deadlines, filings & savings",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-hero-foreground/90">
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
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
