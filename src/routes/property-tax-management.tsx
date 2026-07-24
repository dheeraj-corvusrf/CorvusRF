import { createFileRoute, Link } from "@tanstack/react-router";
import { HeroBackground } from "@/components/HeroBackground";

export const Route = createFileRoute("/property-tax-management")({
  head: () => ({
    meta: [
      { title: "Property Tax Management — CorvusRF.ai" },
      {
        name: "description",
        content:
          "One AI-powered platform for Texas real property protest, BPP rendition, tax bill tracking, payments, refunds, evidence, and annual savings.",
      },
      { property: "og:title", content: "Property Tax Management" },
      { property: "og:description", content: "Everything for Texas property tax in one connected flow." },
    ],
  }),
  component: Page,
});

const CAPS = [
  ["Real Property Protest", "AI comps, evidence, and CorvusRF-filed protest."],
  ["BPP Rendition & Protest", "Business-type templates, asset categories, and depreciation."],
  ["Tax Bill Tracking", "Every county bill, every account, one dashboard."],
  ["Payment Tracking", "Never miss a payment or discount deadline."],
  ["Refund Tracking", "Follow refund status from settlement to check."],
  ["Evidence Library", "AI-extracted, tagged, and packaged for hearings."],
  ["Deadline Engine", "County-aware deadlines with reminders and escalations."],
  ["Annual Savings Report", "Year‑over‑year savings, ROI, and next-year strategy."],
];

function Page() {
  return (
    <div className="relative overflow-hidden min-h-[70vh]">
      <HeroBackground blurred />
      <div className="container-page py-16">
        <div className="max-w-3xl">
          <span className="badge-soft">Platform</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
            One platform. One property record. One savings journey.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Property protest, BPP rendition, tax bill tracking, payment tracking, and savings —
            all connected through one owner profile, one property record, one document library,
            one deadline engine, and one dashboard.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {CAPS.map(([t, d]) => (
            <div key={t} className="card-elev p-5">
              <div className="h-9 w-9 rounded-md bg-accent/20 text-accent flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="mt-3 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link to="/" className="btn-primary btn-primary-hover">Start Free AI Property Review</Link>
          <Link to="/how-it-works" className="btn-outline">How It Works</Link>
        </div>
      </div>
    </div>
  );
}
