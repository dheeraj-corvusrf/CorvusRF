import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { readIntake, classifyAndStoreDocument, type IntakeState } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProtests, type ProtestRecord, type ProtestStatus } from "@/lib/protests";
import { listProperties, type PropertyRecord } from "@/lib/properties";

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

const TOTAL_STEPS = STEP_LABELS.length;

// Steps 6-11 used to render permanently locked ("coming soon") because the
// filing workflow they describe didn't exist yet. It does now — protests.status
// moves through this exact pipeline (advanced by CorvusRF staff via the admin
// panel), so those steps are driven by the signed-in user's real cases instead.
const STATUS_RANK: Record<ProtestStatus, number> = {
  requested: 1,
  filed: 2,
  under_review: 3,
  hearing_scheduled: 4,
  resolved: 5,
};

type Action = { label: string; to?: string; upload?: boolean };
type StepMessage = { title: string; actions?: Action[] };

// `state` reflects only the CURRENT browser session's intake flow, which resets
// every time a new property is started (resetIntake() on the homepage) — a
// returning user beginning their second property would otherwise look like
// they'd regressed on steps already completed for their first one. `hasSavedProperty`
// (a real, persisted, account-wide signal) is OR'd in so completing the pipeline
// once keeps steps 1-5 checked forever, while a fresh in-progress session still
// fills in normally for a first-time user.
function computeIntakeSteps(state: IntakeState, hasSavedProperty: boolean): boolean[] {
  const hasStarted = !!(state.address || state.extraction || state.noticeFileName);
  const hasCounty = !!(state.cad || state.extraction?.county || state.extraction?.cadName);
  const hasProperty = !!(
    (state.accountNumber && state.ownerName) ||
    state.extraction?.accountNumber ||
    state.confirmed
  );
  const hasDocument = !!(state.noticeFileName || state.extraction);
  const hasReview = !!state.extractionConfirmed;
  return [hasStarted, hasCounty, hasProperty, hasDocument, hasReview].map(
    (done) => done || hasSavedProperty,
  );
}

function computeFilingSteps(rank: number): boolean[] {
  return [
    rank >= 1, // Choose Service — a protest has been requested
    rank >= 1, // Prepare Filing — same signal; nothing more granular than "requested" exists yet
    rank >= 2, // Submit — filed with the county
    rank >= 3, // Track — under county review
    rank >= 4, // Decision — hearing scheduled or a decision reached
    rank >= 5, // Savings — resolved
  ];
}

function getMessage(currentStep: number, allDone: boolean): StepMessage | null {
  if (allDone) {
    return {
      title: "Your case is resolved. Check your dashboard for the outcome and savings.",
      actions: [{ label: "View Dashboard", to: "/dashboard" }],
    };
  }
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
    case 5:
    case 6:
      return {
        title: "Ready to save on your property taxes? Choose a service to get started.",
        actions: [
          { label: "Protest My Property", to: "/property-protest" },
          { label: "File BPP Rendition", to: "/bpp-rendition" },
        ],
      };
    case 7:
      return { title: "CorvusRF staff is filing your protest with the county." };
    case 8:
      return {
        title: "Your protest has been filed. CorvusRF is tracking it for updates.",
        actions: [{ label: "View My Cases", to: "/dashboard" }],
      };
    case 9:
      return { title: "Your protest is under county review." };
    case 10:
      return { title: "Your hearing is scheduled. Awaiting the county's decision." };
    default:
      return null;
  }
}

export function JourneyTracker() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setState(readIntake());
  }, []);

  useEffect(() => {
    if (!user) return;
    listProtests(user.id).then(setProtests).catch((err) => console.error(err));
    listProperties(user.id).then(setProperties).catch((err) => console.error(err));
  }, [user]);

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

  const hasSavedProperty = properties.length > 0;
  const intakeSteps = computeIntakeSteps(state, hasSavedProperty);

  // Nobody has a saved property yet — one generic tracker driven purely by
  // whatever the current browser session's in-progress intake flow has done so
  // far, since there's no per-property case to show progress for.
  if (!hasSavedProperty) {
    return (
      <JourneyCard
        steps={[...intakeSteps, false, false, false, false, false, false]}
        uploading={uploading}
        onFile={onFile}
      />
    );
  }

  // One full tracker per property — each driven by that specific property's own
  // protest (if any), rather than blending every case the user has into a single
  // bar. A property with no protest yet simply sits at "Choose Service".
  return (
    <div className="grid gap-4">
      {properties.map((p) => {
        const protest = protests.find((pr) => pr.propertyId === p.id);
        const rank = protest ? STATUS_RANK[protest.status] : 0;
        return (
          <JourneyCard
            key={p.id}
            title={p.address}
            steps={[...intakeSteps, ...computeFilingSteps(rank)]}
            uploading={uploading}
            onFile={onFile}
          />
        );
      })}
    </div>
  );
}

function JourneyCard({
  title,
  steps,
  uploading,
  onFile,
}: {
  title?: string;
  steps: boolean[];
  uploading: boolean;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const completedCount = steps.filter(Boolean).length;
  const firstIncomplete = steps.findIndex((done) => !done);
  const allDone = firstIncomplete === -1;
  const currentStep = allDone ? TOTAL_STEPS - 1 : firstIncomplete;
  const progress = Math.round((completedCount / TOTAL_STEPS) * 100);
  const message = getMessage(currentStep, allDone);

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
        {allDone ? "All steps complete" : `Step ${currentStep + 1} of ${TOTAL_STEPS}: ${STEP_LABELS[currentStep]}`}
      </h2>
      {title && <p className="text-sm text-muted-foreground">{title}</p>}

      <ol className="mt-5 flex items-start gap-2 overflow-x-auto pb-1">
        {STEP_LABELS.map((label, i) => {
          const done = steps[i];
          const active = i === currentStep && !allDone;
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
                  }`}
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
