import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check } from "lucide-react";
import { AnimatedSteps } from "@/components/AnimatedSteps";
import { CircularSearchLoader } from "@/components/CircularSearchLoader";
import { ValueHistorySection } from "@/components/ValueHistorySection";
import {
  readIntake,
  updateIntake,
  classifyAndStoreDocument,
  currency,
  UPLOAD_LIMITS,
  type IntakeState,
  type PropertyKind,
} from "@/lib/intake-store";
import { cadLookup, type CadRecord } from "@/lib/cad-lookup";
import { classifyPropertyCategory } from "@/lib/texas-tax-rates";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { useAuth } from "@/lib/auth";
import { addProperty, findExistingProperty, type PropertyRecord } from "@/lib/properties";
import { estimateSavings, type SavingsEstimate } from "@/lib/savings-estimate";
import { SampleNoticeDialog } from "@/components/SampleNoticeDialog";
import { HouseIllustration } from "@/assets/illustrations/house";
import { useFileDrop } from "@/hooks/use-file-drop";

export const Route = createFileRoute("/intake")({
  head: () => ({
    meta: [
      { title: "Property Intake — CorvusPT.ai" },
      {
        name: "description",
        content:
          "Validate your Texas commercial or residential property and start your free AI review.",
      },
      { property: "og:title", content: "Property Intake" },
      { property: "og:description", content: "Address, notice, and CAD validation." },
    ],
  }),
  component: Intake,
});

type Step =
  | "address"
  | "validating"
  | "notice"
  | "savings"
  | "confirm"
  | "notfound"
  | "classifying"
  | "residential-blocked";

function Intake() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState<IntakeState>({ previewsUsed: [] });
  const [step, setStep] = useState<Step>("address");
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  // True for the ~1-2s window after picking a Google suggestion, while its
  // Place Details follow-up call is upgrading the provisional (sometimes
  // mid-word-abbreviated, e.g. "Market Pl Blvd" vs the real "Market Place
  // Boulevard") value to the real address CAD lookup needs. Blocks
  // "Validate address" during that window — without it, a fast click-through
  // right after selecting submits the still-provisional text and produces
  // the same false "couldn't locate this property" as the abbreviation bug
  // itself, just reachable through timing instead of every time.
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [propertyKind, setPropertyKind] = useState<PropertyKind>("commercial");
  const [noticeName, setNoticeName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [alreadySaved, setAlreadySaved] = useState<PropertyRecord | null>(null);
  const [nearby, setNearby] = useState<CadRecord[]>([]);
  // Bumped on every new lookup and by cancelValidation() — an in-flight
  // request checks this before ever touching state, so hitting Cancel (or
  // starting a second search) can't have a stale response silently repaint
  // the screen out from under whatever the user is looking at now.
  const requestIdRef = useRef(0);
  // See estimateSavings() for the comps -> AI -> baseline cascade. null only
  // means we don't even have an assessed value to estimate from yet (the
  // savings step is skipped straight to confirm in that case).
  const [savings, setSavings] = useState<SavingsEstimate>(null);

  useEffect(() => {
    const s = readIntake();
    setState(s);
    if (s.propertyKind) setPropertyKind(s.propertyKind);
    // Only resume straight into validation for an in-progress intake (address
    // set, not yet confirmed). Once a property has already been confirmed and
    // saved, a fresh visit to /intake should start a new search — otherwise the
    // page silently jumps to the old Confirm step on every revisit, hiding the
    // commercial/residential toggle (which only renders on the address step)
    // behind an "Edit Address" click the user has no reason to expect.
    if (s.address && !s.confirmed) {
      setAddress(s.address);
      runValidation(s.address);
    }
  }, []);

  // Shared by a real cadLookup() match and by picking one of the "nearby"
  // suggestions on the notfound step (which already has a full real CadRecord
  // in hand — no reason to make a second network round-trip for the same data).
  async function applyCadRecord(record: CadRecord, requestId: number) {
    // The commercial/residential toggle above is just the user's own guess
    // — the CAD record is authoritative. Block here too (not just at the
    // toggle) since someone can still reach this page with an address that
    // turns out to be a true single-family home the county itself codes as
    // residential (state code "A"/"C1" or descriptive text like "Single
    // Family") — classifyPropertyCategory() already does this exact
    // classification for the savings-estimate formula tier, so reuse it
    // rather than inventing a second, possibly-inconsistent check.
    if (requestIdRef.current !== requestId) return;
    if (classifyPropertyCategory(record.propertyType) === "residential") {
      setState(
        updateIntake({
          address: record.propertyAddress,
          cad: record.cad,
          propertyType: record.propertyType ?? undefined,
        }),
      );
      setStep("residential-blocked");
      return;
    }
    const next = updateIntake({
      address: record.propertyAddress,
      cad: record.cad,
      accountNumber: record.accountNumber ?? undefined,
      ownerName: record.ownerName ?? undefined,
      propertyType: record.propertyType ?? undefined,
      landValue: record.landValue ?? undefined,
      improvementValue: record.improvementValue ?? undefined,
      totalValue: record.totalValue ?? undefined,
      taxYear: record.taxYear ?? undefined,
      legalDescription: record.legalDescription ?? undefined,
      subdivision: record.subdivision ?? undefined,
      geoId: record.geoId ?? undefined,
      mailingAddress: record.mailingAddress ?? undefined,
      ownershipPct: record.ownershipPct ?? undefined,
      protestStatus: record.protestStatus ?? undefined,
      valueHistory: record.valueHistory ?? undefined,
      deeds: record.deeds ?? undefined,
    });
    setState(next);

    // See estimateSavings() for the comps -> formula cascade — both tiers are
    // fully deterministic (no AI call), so the same property always produces
    // the same number. Only null (no assessed value at all) skips the
    // savings step straight to confirm.
    //
    // Still cached against this exact property (cad+accountNumber, or
    // address when no account number exists) so refreshing the page or
    // re-validating the same address mid-intake reuses the prior result
    // instead of re-running the comps lookup for nothing — a performance
    // nicety now, not a correctness requirement, since the estimate would
    // come out identical either way.
    const savingsKey =
      next.cad && next.accountNumber ? `${next.cad}::${next.accountNumber}` : next.address;
    let nextSavings: SavingsEstimate;
    if (savingsKey && next.cachedSavingsKey === savingsKey && next.cachedSavings !== undefined) {
      nextSavings = next.cachedSavings;
    } else {
      nextSavings = await estimateSavings({
        cad: next.cad,
        accountNumber: next.accountNumber,
        address: next.address,
        propertyType: next.propertyType,
        landValue: next.landValue,
        improvementValue: next.improvementValue,
        totalValue: next.totalValue,
        taxYear: next.taxYear,
        valueHistory: next.valueHistory,
      });
      updateIntake({ cachedSavings: nextSavings, cachedSavingsKey: savingsKey });
    }
    if (requestIdRef.current !== requestId) return;
    setSavings(nextSavings);
    setStep(nextSavings ? "savings" : "confirm");
    // Check whether this exact CAD record is already on the user's account —
    // shown as a notice on the confirm screen instead of letting them hit
    // "Confirm Property" again for something already saved.
    if (user && next.address) {
      findExistingProperty(user.id, {
        address: next.address,
        cad: next.cad,
        accountNumber: next.accountNumber,
      })
        .then(setAlreadySaved)
        .catch((err) => console.error(err));
    }
  }

  async function runValidation(addr: string) {
    const requestId = ++requestIdRef.current;
    setStep("validating");
    setError(null);
    setAlreadySaved(null);
    setNearby([]);
    try {
      const res = await cadLookup(addr);
      if (requestIdRef.current !== requestId) return;
      if (!res.matched) {
        setNearby(res.nearby);
        setStep("notfound");
        return;
      }
      await applyCadRecord(res.record, requestId);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      console.error(err);
      const message =
        err instanceof Error ? err.message : "Could not look up this property. Please try again.";
      toast.error(message);
      setStep("address");
    }
  }

  async function selectNearby(record: CadRecord) {
    const requestId = ++requestIdRef.current;
    setStep("validating");
    setError(null);
    setAlreadySaved(null);
    try {
      await applyCadRecord(record, requestId);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      console.error(err);
      const message =
        err instanceof Error ? err.message : "Could not use this property. Please try again.";
      toast.error(message);
      setStep("notfound");
    }
  }

  // Bails out of an in-flight lookup — invalidates it (see requestIdRef
  // above) so its eventual response can never repaint the screen after the
  // user has already left, and returns straight to an editable address field
  // rather than the notfound/residential-blocked dead ends.
  function cancelValidation() {
    requestIdRef.current++;
    setStep("address");
  }

  async function onFile(f: File) {
    setError(null);
    setNoticeName(f.name);
    setStep("classifying");

    try {
      await classifyAndStoreDocument(f);
      nav({ to: "/document-review" });
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Could not read this document. Please enter the property address above instead.";
      setError(message);
      toast.error(message);
      setStep("address");
    }
  }

  const { isDragging, dropHandlers } = useFileDrop(onFile);

  return (
    <div className={`container-page py-12 ${step === "confirm" ? "max-w-5xl" : "max-w-3xl"}`}>
      <Stepper step={step} />

      {step === "address" && (
        <section className="mt-8 card-elev p-6">
          <h1 className="font-serif text-2xl font-semibold capitalize">
            Enter your {propertyKind} property.
          </h1>
          <p className="mt-1 text-muted-foreground">
            Enter an address, or upload your Texas appraisal notice.
          </p>

          <div className="mt-4 inline-flex rounded-full border border-border bg-secondary/40 p-1">
            {(["commercial", "residential"] as const).map((kind) =>
              kind === "residential" ? (
                <button
                  key={kind}
                  type="button"
                  disabled
                  title="Residential — coming soon"
                  className="rounded-full px-3 py-1 text-xs font-medium capitalize text-muted-foreground/40 cursor-not-allowed"
                >
                  {kind}
                </button>
              ) : (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    setPropertyKind(kind);
                    updateIntake({ propertyKind: kind });
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    propertyKind === kind
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {kind}
                </button>
              ),
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!address.trim() || resolvingAddress) return;
              updateIntake({ address: address.trim(), propertyKind });
              runValidation(address.trim());
            }}
            className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]"
          >
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              onResolving={setResolvingAddress}
              // Picking a suggestion directly validates — no separate click on
              // "Validate address" needed. Takes the address as a parameter
              // (not read from `address` state) since onPlaceSelected already
              // hands over the final, fully-resolved value.
              onPlaceSelected={(addr) => {
                updateIntake({ address: addr, propertyKind });
                runValidation(addr);
              }}
              placeholder="e.g. 500 Main St, Houston, TX 77002"
              className="rounded-md border border-input bg-background px-4 py-3"
            />
            <button
              type="submit"
              disabled={resolvingAddress}
              className="btn-primary btn-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resolvingAddress ? "Resolving…" : "Validate address"}
            </button>
          </form>

          <div
            className={`mt-6 rounded-lg border border-dashed p-5 text-center transition-colors ${
              isDragging ? "border-accent bg-accent/5" : "border-border"
            }`}
            {...dropHandlers}
          >
            <p className="text-sm font-medium">
              {isDragging ? "Drop to upload" : "Have your appraisal notice?"}
            </p>
            <p className="text-xs text-muted-foreground">
              PDF / PNG / JPG, up to {Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB, up
              to {UPLOAD_LIMITS.maxPages} pages.
            </p>
            <label className="mt-3 btn-outline cursor-pointer inline-flex">
              <input
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
              Upload Appraisal Notice
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              <SampleNoticeDialog />
            </p>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            {noticeName && (
              <p className="mt-2 text-xs text-muted-foreground">Selected: {noticeName}</p>
            )}
          </div>
        </section>
      )}

      {step === "validating" && (
        <section className="mt-8 card-elev p-10 text-center relative">
          <button
            type="button"
            onClick={cancelValidation}
            className="btn-outline absolute left-4 top-4 gap-1.5 text-xs py-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Cancel
          </button>
          <CircularSearchLoader className="h-48 w-48 mx-auto" />
          <h2 className="mt-6 font-serif text-2xl font-semibold">Searching for your property…</h2>
          {address && <p className="mt-2 text-muted-foreground">{address}</p>}
        </section>
      )}

      {step === "classifying" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold">AI is reading your document…</h2>
          <AnimatedSteps
            steps={[
              { label: "OCR & text extraction", status: "done" },
              { label: "Classifying document type", status: "active" },
              { label: "Extracting owner, values, and deadlines", status: "active" },
            ]}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            This usually takes a few seconds. Do not close this tab.
          </p>
        </section>
      )}

      {step === "notfound" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold capitalize">
            We couldn't locate this {propertyKind} property.
          </h2>
          <p className="mt-1 text-muted-foreground">
            Please enter a valid property address, or upload your appraisal notice instead.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep("address")} className="btn-outline">
              Edit Address
            </button>
            <button onClick={() => setStep("address")} className="btn-primary btn-primary-hover">
              Search Again
            </button>
          </div>

          {nearby.length > 0 && (
            <div className="mt-6 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">
                We didn't find that exact address, but found these nearby:
              </h3>
              <div className="mt-3 grid gap-2">
                {nearby.map((r, i) => {
                  // The county's own record is authoritative, same check
                  // applyCadRecord() itself makes — this app only serves
                  // commercial properties, so a residential one is shown but
                  // disabled rather than left clickable into a dead end.
                  const category = classifyPropertyCategory(r.propertyType);
                  const isResidential = category === "residential";
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => !isResidential && selectNearby(r)}
                      disabled={isResidential}
                      title={
                        isResidential
                          ? "Residential — CorvusPT currently serves commercial properties only"
                          : undefined
                      }
                      className={`row-hover flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-left ${
                        isResidential ? "opacity-50 grayscale cursor-not-allowed" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{r.propertyAddress}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.cad}
                          {r.totalValue != null && <> · Assessed {currency(r.totalValue)}</>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                            isResidential
                              ? "bg-secondary text-muted-foreground"
                              : category === "commercial"
                                ? "badge-soft"
                                : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {category === "unknown" ? "Type unknown" : category}
                        </span>
                        {!isResidential && (
                          <span className="text-sm font-semibold text-accent">Check this →</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {step === "residential-blocked" && (
        <section className="mt-8 card-elev p-6">
          <h2 className="font-serif text-xl font-semibold">This is a residential property.</h2>
          <p className="mt-1 text-muted-foreground">
            The county's own records classify {state.address ?? "this address"} as residential
            {state.propertyType ? ` (${state.propertyType})` : ""}. CorvusPT currently serves
            commercial properties only.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep("address")} className="btn-outline">
              Search a Different Address
            </button>
          </div>
        </section>
      )}

      {step === "savings" && state.address && savings && (
        <section className="mt-8 card-elev overflow-hidden">
          <div className="bg-accent/10 px-6 pt-10 pb-8 text-center">
            <p className="text-sm font-medium text-muted-foreground">Potential Protest Savings*</p>
            <p className="mt-1 font-serif text-5xl font-bold text-accent">
              {currency(savings.amount)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{state.address}</p>
            {state.accountNumber && (
              <p className="text-xs font-medium text-muted-foreground">
                PARCEL: {state.accountNumber}
              </p>
            )}

            {/* The savings figure alone doesn't answer "how much do I actually
                pay" — these two ground it in real dollars: what the county's
                current assessed value implies you owe this year, and what
                that would drop to if the protest succeeds. Same effective tax
                rate savings.amount was computed with, just applied to the
                full assessed value instead of only the contested portion. */}
            <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-4 border-t border-accent/20 pt-6">
              <div>
                <div className="text-xs text-muted-foreground">Est. Tax Bill This Year</div>
                <div className="mt-0.5 font-serif text-xl font-semibold">
                  {currency((state.totalValue ?? 0) * (savings.effectiveTaxRatePct / 100))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Est. Bill After Protest</div>
                <div className="mt-0.5 font-serif text-xl font-semibold text-success">
                  {currency(
                    (state.totalValue ?? 0) * (savings.effectiveTaxRatePct / 100) - savings.amount,
                  )}
                </div>
              </div>
            </div>

            <HouseIllustration className="mx-auto mt-6 h-32 w-auto" />
          </div>
          <div className="p-6">
            {savings.basis === "comps" && (
              <div className="mb-5 grid gap-3 sm:grid-cols-2 text-sm">
                <Field label="Comparable Properties Used" value={savings.compsCount.toString()} />
                <Field label="Comps Median Value" value={currency(savings.compsMedian)} />
                <Field label="Your Assessed Value" value={currency(state.totalValue)} bold />
                <Field
                  label="Value Above Median"
                  value={currency((state.totalValue ?? 0) - savings.compsMedian)}
                  bold
                />
                <Field label="Effective Tax Rate Used" value={`${savings.effectiveTaxRatePct}%`} />
              </div>
            )}
            {savings.basis === "formula" && (
              <div className="mb-5 grid gap-3 sm:grid-cols-2 text-sm">
                <span className="badge-soft sm:col-span-2 w-fit">
                  Modeled from real Texas protest data — no direct comps available
                </span>
                <Field
                  label="Typical Reduction for This Property"
                  value={`${savings.reductionPct}%`}
                />
                <Field label="Effective Tax Rate Used" value={`${savings.effectiveTaxRatePct}%`} />
                <Field label="Your Assessed Value" value={currency(state.totalValue)} bold />
                <div className="sm:col-span-2">
                  <Field label="Basis" value={savings.rationale} />
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setStep("confirm")} className="btn-primary btn-primary-hover">
                Continue
              </button>
              <button onClick={() => setStep("address")} className="btn-outline">
                Search a Different Address
              </button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {savings.basis === "comps"
                ? `*Estimated from ${savings.compsCount} real comparable properties in your subdivision, at your county's ~${savings.effectiveTaxRatePct}% effective tax rate. Your actual result depends on the hearing outcome and county-specific factors.`
                : "*Modeled from real, published Texas protest-outcome data for this property's county and category — no directly comparable properties were available for this address, so this isn't a specific analysis of your property. Your actual result depends on the hearing outcome and county-specific factors."}{" "}
              Tax bill figures use your county's estimated effective tax rate applied to the CAD's
              assessed value — not a bill pulled from the county, and before any exemptions (e.g.
              homestead) you may qualify for.
            </p>
          </div>
        </section>
      )}

      {step === "confirm" && state.address && (
        <section className="mt-8 card-elev p-6">
          <div className="flex items-center gap-2">
            <span className="badge-soft">Official CAD Record</span>
            <span className="text-xs text-muted-foreground">Source: County Appraisal District</span>
          </div>
          <h2 className="mt-3 font-serif text-2xl font-semibold">Confirm your property</h2>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-sm">
            <Field label="Owner Name" value={state.ownerName} />
            <Field label="Property Address" value={state.address} />
            <Field label="County / CAD" value={state.cad} />
            <Field label="CAD Account Number" value={state.accountNumber} />
            <Field label="Property Type" value={state.propertyType} />
            <Field label="Tax Year" value={state.taxYear?.toString()} />
            <Field label="Land Value" value={currency(state.landValue)} />
            <Field label="Improvement Value" value={currency(state.improvementValue)} />
            <Field label="Total Appraised Value" value={currency(state.totalValue)} bold />
            {state.legalDescription && (
              <Field label="Legal Description" value={state.legalDescription} />
            )}
            {state.subdivision && <Field label="Subdivision" value={state.subdivision} />}
            {state.geoId && <Field label="Geographic ID" value={state.geoId} />}
            {state.mailingAddress && (
              <Field label="Owner Mailing Address" value={state.mailingAddress} />
            )}
            {state.ownershipPct != null && (
              <Field label="% Ownership" value={`${state.ownershipPct}%`} />
            )}
            {state.protestStatus && <Field label="Protest Status" value={state.protestStatus} />}
          </dl>
          {state.totalValue == null && (
            <p className="mt-3 text-xs text-muted-foreground">
              Value data is not published in this county's public records.
            </p>
          )}

          <ValueHistorySection history={state.valueHistory ?? []} />

          {state.deeds && state.deeds.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Deed History</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 pr-4">Date</th>
                      <th className="py-1 pr-4">Type</th>
                      <th className="py-1 pr-4">Seller</th>
                      <th className="py-1 pr-4">Buyer</th>
                      <th className="py-1 pr-4">Instrument #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.deeds.map((d, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 pr-4">{d.date?.slice(0, 10) ?? "—"}</td>
                        <td className="py-1 pr-4">{d.description ?? d.type ?? "—"}</td>
                        <td className="py-1 pr-4">{d.seller ?? "—"}</td>
                        <td className="py-1 pr-4">{d.buyer ?? "—"}</td>
                        <td className="py-1 pr-4">{d.instrumentNum ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {alreadySaved && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
              <Check className="h-4 w-4 shrink-0 text-accent" />
              <span>This property is already in your account — no need to confirm it again.</span>
            </div>
          )}
          {saveError && <p className="mt-4 text-sm text-destructive">{saveError}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              disabled={saving}
              onClick={async () => {
                setSaveError(null);
                if (user && !alreadySaved) {
                  setSaving(true);
                  try {
                    await addProperty(user.id, {
                      address: state.address!,
                      cad: state.cad,
                      accountNumber: state.accountNumber,
                      ownerName: state.ownerName,
                      propertyType: state.propertyType,
                      landValue: state.landValue,
                      improvementValue: state.improvementValue,
                      totalValue: state.totalValue,
                      taxYear: state.taxYear,
                      estimatedSavings: savings?.amount,
                      savingsBasis: savings?.basis,
                      valueHistory: state.valueHistory,
                    });
                  } catch (err) {
                    setSaving(false);
                    const message =
                      err instanceof Error
                        ? err.message
                        : "Could not save this property. Please try again.";
                    setSaveError(message);
                    toast.error(message);
                    return;
                  }
                  setSaving(false);
                  toast.success("Property saved.");
                }
                updateIntake({ confirmed: true });
                nav({ to: "/ai-report" });
              }}
              className="btn-primary btn-primary-hover disabled:opacity-60"
            >
              {saving ? "Saving…" : alreadySaved ? "View AI Report" : "Confirm Property"}
            </button>
            <button onClick={() => setStep("address")} className="btn-outline">
              Edit Address
            </button>
            <label
              className={`btn-outline cursor-pointer ${isDragging ? "ring-2 ring-accent" : ""}`}
              {...dropHandlers}
            >
              <input
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
              {isDragging ? "Drop to upload" : "Upload Another Notice"}
            </label>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const items = [
    ["Address", ["address"]],
    ["Validate", ["validating", "notfound", "residential-blocked"]],
    ["Savings", ["savings"]],
    ["Confirm", ["confirm"]],
  ] as const;
  return (
    <ol className="flex w-full items-center text-xs font-medium">
      {items.map(([label, keys], i) => {
        const active = (keys as readonly string[]).includes(step);
        const isLast = i === items.length - 1;
        return (
          <li
            key={label}
            className={`flex items-center gap-1.5 sm:gap-2 ${isLast ? "" : "flex-1"}`}
          >
            <span
              className={`h-6 w-6 shrink-0 rounded-full grid place-items-center ${
                active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            {/* Full labels once there's room (sm+); numbers-only on narrow
                phones so 4 steps fit without pushing the page into
                horizontal scroll. */}
            <span
              className={`hidden sm:inline ${active ? "text-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </span>
            {/* Connector grows to fill the gap to the next step, so the whole
                stepper spans the same width as the card below it instead of
                sitting in a compact cluster with dead space to the right. */}
            {!isLast && <span className="h-px flex-1 shrink-0 bg-border mx-1" />}
          </li>
        );
      })}
    </ol>
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
