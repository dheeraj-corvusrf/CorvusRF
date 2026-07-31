import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
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
      <HeroBackground />
      <div className="container-page pt-8 pb-0 md:pt-12 md:pb-2">
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
            {uploading ? "Reading document…" : "Upload Appraisal Notice"}
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
            <SampleNoticeDialog />
          </div>
        )}
      </div>
      </div>
    </section>
  );
}
