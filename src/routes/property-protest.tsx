import { createFileRoute, Link } from "@tanstack/react-router";
import { HeroBackground } from "@/components/HeroBackground";

export const Route = createFileRoute("/property-protest")({
  head: () => ({
    meta: [
      { title: "Property Protest — CorvusRF.ai" },
      {
        name: "description",
        content:
          "AI-driven Texas real property protest: comp analysis, evidence packet, deadline tracking, and CorvusRF-managed filing and hearings.",
      },
      { property: "og:title", content: "AI-driven Texas Property Protest" },
      { property: "og:description", content: "AI evidence + human-managed filing and hearings." },
    ],
  }),
  component: Page,
});

function Page() {
  const bullets = [
    "AI reviews CAD value against comparable sales and equity comps.",
    "AI Evidence Builder assembles a hearing-ready packet.",
    "CorvusRF staff files, communicates with county, and represents at hearings.",
    "Deadline engine tracks your protest window automatically.",
  ];
  return (
    <div className="relative overflow-hidden min-h-[70vh]">
      <HeroBackground blurred />
      <div className="container-page py-16">
        <div className="max-w-3xl">
          <span className="badge-soft">Real Property Protest</span>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold">
            Protest with AI evidence. Filed and defended by humans.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            AI handles research, comps, and evidence. CorvusRF handles filing, county
            communication, hearings, and settlement.
          </p>
          <ul className="mt-6 grid gap-3">
            {bullets.map((b) => (
              <li key={b} className="flex gap-2 text-foreground/90">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent" /> {b}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex gap-3">
            <Link to="/" className="btn-primary btn-primary-hover">Start Free Review</Link>
            <Link to="/pricing" className="btn-outline">Pricing</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
