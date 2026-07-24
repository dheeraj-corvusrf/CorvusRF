import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { readIntake, updateIntake, currency, type IntakeState } from "@/lib/intake-store";
import { MODULES, type Module } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { getMyBilling } from "@/lib/billing";
import { getHealthScore, type HealthScoreResult } from "@/lib/ai-health-score";
import { getModuleAnalysis, type BatchModuleId, type ModuleResultMap } from "@/lib/ai-report-modules";

type ModuleAsyncState = {
  data: unknown;
  loading: boolean;
  error: string | null;
};

export const Route = createFileRoute("/ai-report")({
  head: () => ({
    meta: [
      { title: "AI Property Review — CorvusRF.ai" },
      { name: "description", content: "AI-generated property tax review with 10 premium modules." },
      { property: "og:title", content: "AI Property Review" },
      { property: "og:description", content: "AI analysis of your Texas commercial property." },
    ],
  }),
  component: Report,
});

const MAX_PREVIEWS = 3;

function Report() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });
  const [analyzing, setAnalyzing] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showWall, setShowWall] = useState(false);
  const [hasFullAccess, setHasFullAccess] = useState(false);
  // AI content for every module (health + the 8 batch modules) is fetched lazily —
  // only when the user clicks "Unlock preview" on that specific module, via
  // loadModule() below — rather than all up front, so tokens are only spent on
  // modules the user actually opens.
  const [moduleData, setModuleData] = useState<Record<string, ModuleAsyncState>>({});

  useEffect(() => {
    const s = readIntake();
    setState(s);
    if (!s.confirmed) {
      nav({ to: "/intake" });
      return;
    }
    const t = setTimeout(() => setAnalyzing(false), 1800);
    return () => clearTimeout(t);
  }, [nav]);

  function loadModule(id: string) {
    const existing = moduleData[id];
    if ((existing && (existing.loading || existing.data)) || !state.totalValue) return;
    setModuleData((prev) => ({ ...prev, [id]: { data: null, loading: true, error: null } }));
    const input = {
      address: state.address,
      cad: state.cad,
      propertyType: state.propertyType,
      landValue: state.landValue,
      improvementValue: state.improvementValue,
      totalValue: state.totalValue,
      taxYear: state.taxYear,
    };
    const promise = id === "health" ? getHealthScore(input) : getModuleAnalysis(id as BatchModuleId, input);
    promise
      .then((data) => setModuleData((prev) => ({ ...prev, [id]: { data, loading: false, error: null } })))
      .catch((err) =>
        setModuleData((prev) => ({
          ...prev,
          [id]: {
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : "Could not generate this analysis.",
          },
        })),
      );
  }

  useEffect(() => {
    if (!user) return;
    getMyBilling(user.id)
      .then(({ plan }) =>
        setHasFullAccess(
          plan === "owner_managed" ||
            plan === "corvusrf_managed" ||
            plan === "ai_report" ||
            plan === "managed_protest",
        ),
      )
      .catch(() => setHasFullAccess(false));
  }, [user]);

  const previewsUsed = state.previewsUsed ?? [];
  const savingsData = moduleData.savings?.data as ModuleResultMap["savings"] | undefined;
  // Prefers the AI-estimated reduction/rate once the user has unlocked the Savings
  // module; falls back to a fixed 12% reduction / 2.5% effective rate until then (or
  // if that call fails), so the summary banner always shows a number.
  const estimated = useMemo(() => {
    if (!state.totalValue) return { reduction: 0, savings: 0 };
    const reductionPct = savingsData ? savingsData.reductionPct / 100 : 0.12;
    const ratePct = savingsData ? savingsData.effectiveTaxRatePct / 100 : 0.025;
    const reduction = Math.round(state.totalValue * reductionPct);
    const savings = Math.round(reduction * ratePct);
    return { reduction, savings };
  }, [state.totalValue, savingsData]);

  function openModule(m: Module) {
    if (hasFullAccess || previewsUsed.includes(m.id)) {
      setOpenId(m.id);
      if (!m.requiresUserData) loadModule(m.id);
      return;
    }
    if (previewsUsed.length >= MAX_PREVIEWS) {
      setShowWall(true);
      return;
    }
    const next = updateIntake({ previewsUsed: [...previewsUsed, m.id] });
    setState(next);
    setOpenId(m.id);
    if (!m.requiresUserData) loadModule(m.id);
  }

  const openModel = MODULES.find((m) => m.id === openId) ?? null;

  return (
    <div className="container-page py-10">
      {/* Summary */}
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="card-elev p-6">
          <div className="flex items-center gap-2">
            <span className="badge-soft">Property Summary</span>
            <span className="text-xs text-muted-foreground">Source: Official CAD Record</span>
          </div>
          <h1 className="mt-3 font-serif text-3xl font-semibold">{state.address}</h1>
          <p className="text-muted-foreground text-sm">{state.cad}</p>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3 text-sm">
            <Field label="Owner" value={state.ownerName} />
            <Field label="Account #" value={state.accountNumber} />
            <Field label="Type" value={state.propertyType} />
            <Field label="Land" value={currency(state.landValue)} />
            <Field label="Improvement" value={currency(state.improvementValue)} />
            <Field label="Total" value={currency(state.totalValue)} bold />
          </dl>
        </div>
        <div className="card-elev overflow-hidden">
          <iframe
            title="Property Map"
            className="w-full h-64 lg:h-full min-h-[240px]"
            src={`https://www.google.com/maps?q=${encodeURIComponent(state.address ?? "Texas")}&output=embed`}
            loading="lazy"
          />
        </div>
      </section>

      {/* Analysis banner */}
      <section className="mt-6 card-elev p-5 flex flex-wrap items-center justify-between gap-3 bg-primary text-primary-foreground">
        <div>
          <p className="text-sm text-primary-foreground/80">
            {analyzing ? "AI is analyzing your commercial property..." : "AI analysis completed."}
          </p>
          <p className="font-serif text-xl">
            {analyzing
              ? "Preparing your property valuation review..."
              : `Estimated tax savings this year: ${currency(estimated.savings)}`}
          </p>
        </div>
        <div className="text-right text-sm">
          {hasFullAccess ? (
            <div className="text-primary-foreground/70 text-xs">AI Report subscription active</div>
          ) : (
            <>
              <div>
                Preview {Math.min(previewsUsed.length, MAX_PREVIEWS)} of {MAX_PREVIEWS}
              </div>
              <div className="text-primary-foreground/70 text-xs">
                Complimentary AI insight previews
              </div>
            </>
          )}
        </div>
      </section>

      {/* Modules */}
      <section className="mt-8">
        <h2 className="font-serif text-2xl font-semibold">10 Premium AI Modules</h2>
        <p className="text-muted-foreground text-sm">
          {hasFullAccess
            ? "All modules unlocked with your AI Report subscription."
            : "Tap any module to unlock a preview. Subscribe for the full report."}
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <ModuleCard
              key={m.id}
              m={m}
              analyzing={analyzing}
              unlocked={hasFullAccess || previewsUsed.includes(m.id)}
              onOpen={() => openModule(m)}
            />
          ))}
        </div>
      </section>

      {/* Preview modal */}
      {openModel && (
        <Modal onClose={() => setOpenId(null)}>
          <div className="flex items-center justify-between">
            <span className="badge-soft">
              {hasFullAccess
                ? "Unlocked"
                : `Preview ${previewsUsed.indexOf(openModel.id) + 1} of ${MAX_PREVIEWS}`}
            </span>
            <button
              onClick={() => setOpenId(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <h3 className="mt-2 font-serif text-2xl font-semibold">{openModel.title}</h3>
          <p className="text-muted-foreground">{openModel.question}</p>
          <ModulePreviewBody
            m={openModel}
            estimated={estimated}
            state={state}
            moduleState={moduleData[openModel.id]}
            onRetry={() => loadModule(openModel.id)}
          />
          <div className="mt-6 flex gap-2 justify-end">
            <button onClick={() => setOpenId(null)} className="btn-outline">
              Return to Property Summary
            </button>
            {!hasFullAccess && (
              <Link to="/pricing" className="btn-accent">
                Subscribe & Unlock Full Report
              </Link>
            )}
          </div>
        </Modal>
      )}

      {/* Subscription wall */}
      {showWall && (
        <Modal onClose={() => setShowWall(false)}>
          <h3 className="font-serif text-2xl font-semibold">
            Unlock Your Complete AI Property Analysis
          </h3>
          <p className="text-muted-foreground mt-2">
            You have viewed your three complimentary AI insight previews. Subscribe to unlock all
            ten modules and the complete commercial property analysis.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Link to="/sign-in" className="btn-primary btn-primary-hover">
              Create Account and Continue
            </Link>
            <Link to="/pricing" className="btn-accent">
              Subscribe & Unlock Full Report
            </Link>
            <Link to="/pricing" className="btn-outline">
              Compare Plans
            </Link>
            <button onClick={() => setShowWall(false)} className="btn-outline">
              Return to Property Summary
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ModuleCard({
  m,
  analyzing,
  unlocked,
  onOpen,
}: {
  m: Module;
  analyzing: boolean;
  unlocked: boolean;
  onOpen: () => void;
}) {
  const status = analyzing ? "Analyzing" : m.status;
  return (
    <div className="card-elev p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">Module {m.n}</div>
          <h3 className="font-semibold">{m.title}</h3>
        </div>
        <StatusChip status={status} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{m.question}</p>
      <div className={`mt-3 text-sm ${!unlocked ? "locked-blur" : ""}`}>{m.teaser}</div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {unlocked ? (
          <span className="text-xs font-medium text-success">Preview unlocked</span>
        ) : (
          <span className="text-xs text-muted-foreground">Locked</span>
        )}
        <button onClick={onOpen} className="btn-outline text-sm py-2">
          {unlocked ? "View preview" : "Unlock preview"}
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: Module["status"] }) {
  const map: Record<Module["status"], string> = {
    Analyzing: "bg-secondary text-muted-foreground",
    Completed: "bg-success/15 text-success",
    "Additional Data Needed": "bg-warning/20 text-warning-foreground",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${map[status]}`}>
      {status}
    </span>
  );
}

function ModulePreviewBody({
  m,
  estimated,
  state,
  moduleState,
  onRetry,
}: {
  m: Module;
  estimated: { reduction: number; savings: number };
  state: IntakeState;
  moduleState: ModuleAsyncState | undefined;
  onRetry: () => void;
}) {
  if (m.requiresUserData) {
    return (
      <div className="mt-4 card-elev p-4 bg-secondary/60">
        <p className="text-sm">
          This module requires private financial data (P&L, rent roll, or operating statement) to
          complete. Upload once you subscribe — AI will run the income approach and compare to your
          assessed value.
        </p>
      </div>
    );
  }

  const loading = !moduleState || moduleState.loading;
  const error = moduleState?.error;

  // Savings always has a number to show — `estimated` (computed by the caller)
  // already falls back to a fixed 12%/2.5% assumption until this module is
  // unlocked (or if the call fails), so this renders its own loading/error copy
  // inline rather than going blank.
  if (m.id === "savings") {
    const savings = moduleState?.data as ModuleResultMap["savings"] | undefined;
    return (
      <div className="mt-4 grid gap-2">
        <p className="text-sm">
          Estimated value reduction: <strong>{currency(estimated.reduction)}</strong>
        </p>
        <p className="text-sm">
          Estimated tax savings: <strong>{currency(estimated.savings)}</strong>
        </p>
        <p className="text-xs text-muted-foreground">
          Based on assessed value {currency(state.totalValue)} —{" "}
          {savings?.rationale ??
            (loading ? "AI is refining this estimate…" : "typical Texas commercial effective tax rate.")}
        </p>
        {error && <ErrorWithRetry message={error} onRetry={onRetry} />}
      </div>
    );
  }

  if (loading) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {m.id === "health" ? "AI is scoring this property…" : "AI is generating this analysis…"}
      </p>
    );
  }
  if (error) {
    return <ErrorWithRetry message={error} onRetry={onRetry} />;
  }
  if (!moduleState?.data) return null;

  if (m.id === "health") {
    const data = moduleState.data as HealthScoreResult;
    return (
      <div className="mt-4 grid gap-2">
        <ScoreBar score={data.score} />
        <p className="text-sm text-muted-foreground">{data.summary}</p>
        {data.factors.length > 0 && (
          <ul className="text-sm space-y-1">
            {data.factors.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  switch (m.id) {
    case "strategy": {
      const d = moduleState.data as ModuleResultMap["strategy"];
      return (
        <p className="mt-4 text-sm">
          Recommended path: <strong>{d.recommendation}</strong>. {d.rationale}
        </p>
      );
    }
    case "comps": {
      const d = moduleState.data as ModuleResultMap["comps"];
      return (
        <div className="mt-4 grid gap-2">
          <p className="text-sm">{d.guidance}</p>
          <ul className="text-sm space-y-1">
            {d.checklist.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      );
    }
    case "site": {
      const d = moduleState.data as ModuleResultMap["site"];
      return (
        <div className="mt-4 grid gap-2">
          <p className="text-sm">{d.guidance}</p>
          <ul className="text-sm space-y-1">
            {d.checklist.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      );
    }
    case "improvement": {
      const d = moduleState.data as ModuleResultMap["improvement"];
      return (
        <div className="mt-4 grid gap-2">
          <p className="text-sm">{d.guidance}</p>
          <ul className="text-sm space-y-1">
            {d.checklist.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      );
    }
    case "zoning": {
      const d = moduleState.data as ModuleResultMap["zoning"];
      return <p className="mt-4 text-sm">{d.assessment}</p>;
    }
    case "evidence": {
      const d = moduleState.data as ModuleResultMap["evidence"];
      return (
        <ul className="mt-4 text-sm space-y-1">
          {d.checklist.map((c, i) => (
            <li key={i}>• {c}</li>
          ))}
        </ul>
      );
    }
    case "executive": {
      const d = moduleState.data as ModuleResultMap["executive"];
      return (
        <div className="mt-4 grid gap-2 text-sm">
          <p>
            <strong>Recommendation:</strong> {d.recommendation}
          </p>
          <p>
            <strong>Basis:</strong> {d.basis}
          </p>
          <p>
            <strong>Next step:</strong> {d.nextStep}
          </p>
        </div>
      );
    }
  }

  return <p className="mt-4 text-sm">{m.teaser}</p>;
}

function ErrorWithRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 grid gap-2">
      <p className="text-sm text-destructive">{message}</p>
      <button onClick={onRetry} className="btn-outline w-fit text-sm py-1.5">
        Retry
      </button>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Protest opportunity</span>
        <span>{score}/100</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-secondary overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function Field({ label, value, bold }: { label: string; value?: string; bold?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 ${bold ? "text-lg font-semibold" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-primary/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card-elev p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
