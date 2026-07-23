import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { readIntake, classifyAndStoreDocument, type IntakeState } from "@/lib/intake-store";

const STEP_LABELS = [
  "Start",
  "Identify County",
  "Find Property",
  "Upload Documents",
  "AI Review",
  "Choose Service",
  "Prepare Filing",
  "Submit",
  "Track",
  "Decision",
  "Savings",
] as const;

// Only the first 5 steps map to anything the app actually does today. 6-11 describe
// a protest-filing workflow (choose a service, file, track, get a decision, see
// savings) that doesn't exist yet — they render locked, never marked complete.
const REAL_STEP_COUNT = 5;
const TOTAL_STEPS = STEP_LABELS.length;

type Action = { label: string; to?: string; upload?: boolean };
type StepMessage = { title: string; actions?: Action[] };

function computeSteps(state: IntakeState): boolean[] {
  const hasStarted = !!(state.address || state.extraction || state.noticeFileName);
  const hasCounty = !!(state.cad || state.extraction?.county || state.extraction?.cadName);
  const hasProperty = !!(
    (state.accountNumber && state.ownerName) ||
    state.extraction?.accountNumber ||
    state.confirmed
  );
  const hasDocument = !!(state.noticeFileName || state.extraction);
  const hasReview = !!state.extractionConfirmed;
  return [hasStarted, hasCounty, hasProperty, hasDocument, hasReview];
}

function getMessage(currentStep: number): StepMessage | null {
  switch (currentStep) {
    case 0:
      return {
        title: "Start by entering your property address or uploading your notice.",
        actions: [
          { label: "Enter Address", to: "/intake" },
          { label: "Upload Notice", upload: true },
        ],
      };
    case 1:
      return {
        title: "AI is identifying your county and CAD records.",
        actions: [{ label: "Edit Address", to: "/intake" }],
      };
    case 2:
      return {
        title: "AI needs a valid property address to find your CAD record.",
        actions: [{ label: "Edit Address", to: "/intake" }],
      };
    case 3:
      return {
        title: "Upload your appraisal notice so AI can extract deadlines and values.",
        actions: [{ label: "Upload Notice", upload: true }],
      };
    case 4:
      return {
        title: "Review AI's extraction and confirm the details.",
        actions: [{ label: "Review Document", to: "/document-review" }],
      };
    default:
      return { title: "You're all caught up for now — filing workflows are coming soon." };
  }
}

export function JourneyTracker() {
  const navigate = useNavigate();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setState(readIntake());
  }, []);

  const steps = computeSteps(state);
  const completedCount = steps.filter(Boolean).length;
  const firstIncomplete = steps.findIndex((done) => !done);
  const currentStep = firstIncomplete === -1 ? REAL_STEP_COUNT : firstIncomplete;
  const progress = Math.round((completedCount / TOTAL_STEPS) * 100);
  const message = getMessage(currentStep);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      await classifyAndStoreDocument(f);
      navigate({ to: "/document-review" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read this document.");
      setUploading(false);
    }
  }

  return (
    <section className="card-elev p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="badge-soft">Your Journey</span>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Overall progress</div>
          <div className="text-lg font-semibold">{progress}%</div>
        </div>
      </div>
      <h2 className="mt-3 font-serif text-xl font-semibold">
        Step {currentStep + 1} of {TOTAL_STEPS}: {STEP_LABELS[currentStep]}
      </h2>

      <ol className="mt-5 flex items-start gap-2 overflow-x-auto pb-1">
        {STEP_LABELS.map((label, i) => {
          const isReal = i < REAL_STEP_COUNT;
          const done = isReal && steps[i];
          const active = i === currentStep;
          return (
            <li key={label} className="flex items-center gap-2 shrink-0">
              <div className="flex flex-col items-center gap-1 w-[72px]">
                <span
                  className={`h-8 w-8 rounded-full grid place-items-center text-xs font-semibold ${
                    done
                      ? "bg-success text-success-foreground"
                      : active
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                  } ${!isReal ? "opacity-50" : ""}`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`text-[11px] text-center leading-tight ${
                    active ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
                {!isReal && <span className="text-[9px] text-muted-foreground">Coming soon</span>}
              </div>
              {i < TOTAL_STEPS - 1 && <span className="w-4 h-px bg-border mt-4" />}
            </li>
          );
        })}
      </ol>

      {message && (
        <div className="mt-5 rounded-lg bg-secondary/50 p-4">
          <p className="text-sm font-medium">{message.title}</p>
          {message.actions && (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.actions.map((a) =>
                a.upload ? (
                  <label
                    key={a.label}
                    className="btn-primary btn-primary-hover text-sm py-2 cursor-pointer"
                  >
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,image/*"
                      disabled={uploading}
                      onChange={onFile}
                    />
                    {uploading ? "Reading document…" : a.label}
                  </label>
                ) : (
                  <Link key={a.label} to={a.to!} className="btn-outline text-sm py-2">
                    {a.label}
                  </Link>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
