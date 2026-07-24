import { createFileRoute, Link } from "@tanstack/react-router";
import { HeroBackground } from "@/components/HeroBackground";

export const Route = createFileRoute("/bpp-rendition")({
  head: () => ({
    meta: [
      { title: "BPP Rendition — CorvusRF.ai" },
      {
        name: "description",
        content:
          "AI-powered Business Personal Property rendition and protest: templates, asset categories, depreciation logic, and county-specific rules.",
      },
      { property: "og:title", content: "BPP Rendition & Protest" },
      { property: "og:description", content: "AI templates, asset extraction, and CorvusRF-filed BPP." },
    ],
  }),
  component: Page,
});

function Page() {
  const items = [
    ["Business type templates", "Start from a template built for your business type."],
    ["Asset extraction", "AI reads prior renditions to prefill asset categories."],
    ["Depreciation logic", "County-specific depreciation applied automatically."],
    ["County rules", "Hidden County Rule Engine handles filing requirements."],
  ];
  return (
    <div className="relative overflow-hidden min-h-[70vh]">
      <HeroBackground blurred />
      <div className="container-page py-16">
        <div className="max-w-3xl">
          <span className="badge-soft">BPP Rendition</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
            BPP rendition without the paperwork.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Upload a prior rendition or start with a template. AI extracts assets, applies
            county depreciation, and prepares the filing. CorvusRF files and defends it.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {items.map(([t, d]) => (
            <div key={t} className="card-elev p-6">
              <h3 className="font-semibold text-lg">{t}</h3>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link to="/" className="btn-primary btn-primary-hover">Start Free Review</Link>
        </div>
      </div>
    </div>
  );
}
