import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SignaturePad, type SignatureValue } from "@/components/SignaturePad";
import { requestProtest, type ProtestRecord } from "@/lib/protests";
import { createAuthorization } from "@/lib/protest-authorizations";
import type { PropertyRecord } from "@/lib/properties";

// The TDLR regulatory line is intentionally omitted until registration is
// confirmed. Fee (25%) and service scope were explicitly confirmed as
// CorvusRF's real terms.
export const AGREEMENT = {
  address: "18740 Wainsborough Ln, Dallas, TX",
  phone: "(469) 501-9362",
  email: "properties@srclandbuilding.com",
  venue: "Dallas County, Texas",
};

type Step = "owner" | "purchase" | "review";
const ENTITY_TYPES = ["LLC", "Corporation", "Partnership", "Estate", "Trust", "Other"] as const;

export function ProtestAuthorizationFlow({
  userId,
  property,
  userEmail,
  open,
  onOpenChange,
  onDone,
}: {
  userId: string;
  property: PropertyRecord;
  userEmail?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (protest: ProtestRecord) => void;
}) {
  const [step, setStep] = useState<Step>("owner");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(userEmail ?? "");
  const [phone, setPhone] = useState("");
  const [isEntity, setIsEntity] = useState(false);
  const [entityName, setEntityName] = useState("");
  const [entityRelationship, setEntityRelationship] = useState("");
  const [entityType, setEntityType] = useState<(typeof ENTITY_TYPES)[number] | "">("");
  const [purchasedRecently, setPurchasedRecently] = useState<boolean | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("owner");
    setFirstName("");
    setLastName("");
    setEmail(userEmail ?? "");
    setPhone("");
    setIsEntity(false);
    setEntityName("");
    setEntityRelationship("");
    setEntityType("");
    setPurchasedRecently(null);
    setAgreed(false);
    setSignature(null);
    setError(null);
    setSubmitting(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  const ownerValid =
    firstName.trim() && lastName.trim() && email.trim() && phone.trim() &&
    (!isEntity || (entityName.trim() && entityRelationship.trim() && entityType));

  async function handleSubmit() {
    if (!signature) return;
    setSubmitting(true);
    setError(null);
    try {
      const protest = await requestProtest(userId, property.id, {
        address: property.address,
        userEmail: email,
        originalValue: property.totalValue,
      });
      await createAuthorization(userId, {
        protestId: protest.id,
        propertyId: property.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        isEntity,
        entityName: entityName.trim(),
        entityRelationship: entityRelationship.trim(),
        entityType,
        purchasedRecently: purchasedRecently ?? false,
        signature,
      });
      toast.success("Authorization signed. CorvusRF staff will follow up.");
      onDone(protest);
      close();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not submit your authorization.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "owner" && "Property Owner Details"}
            {step === "purchase" && "One More Question"}
            {step === "review" && "Review & Sign"}
          </DialogTitle>
          <DialogDescription>{property.address}</DialogDescription>
        </DialogHeader>

        {step === "owner" && (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Provide your full legal name, including any suffix (Jr., Sr., II), to ensure it
              matches the county's records.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">First Name</span>
                <input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Last Name</span>
                <input
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Email Address</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Phone Number</span>
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">Is this property owned by a trust, LLC, or other entity?</span>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={isEntity} onChange={() => setIsEntity(true)} /> Yes
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={!isEntity} onChange={() => setIsEntity(false)} /> No
                </label>
              </div>
            </div>
            {isEntity && (
              <div className="grid gap-4 rounded-lg bg-secondary/40 p-4">
                <h3 className="font-semibold">Representative of Entity Details</h3>
                <p className="text-xs text-muted-foreground">
                  If your name does not match an authorized representative of the entity, CorvusRF
                  may be unable to proceed with your protest.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Entity Name</span>
                    <input
                      value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                      placeholder="Entity Name"
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">Relationship to Entity</span>
                    <input
                      value={entityRelationship}
                      onChange={(e) => setEntityRelationship(e.target.value)}
                      placeholder="Owner, Agent, Trustee, etc."
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                </div>
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Type of Entity</span>
                  <div className="mt-1 grid gap-1.5">
                    {ENTITY_TYPES.map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          checked={entityType === t}
                          onChange={() => setEntityType(t)}
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <button
              disabled={!ownerValid}
              onClick={() => setStep("purchase")}
              className="btn-primary btn-primary-hover w-fit disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}

        {step === "purchase" && (
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 p-4">
              <span className="text-sm">Did you purchase this property within the last 18 months?</span>
              <div className="flex gap-3 text-sm shrink-0">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={purchasedRecently === true}
                    onChange={() => setPurchasedRecently(true)}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={purchasedRecently === false}
                    onChange={() => setPurchasedRecently(false)}
                  />
                  No
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("owner")} className="btn-outline">
                Back
              </button>
              <button
                disabled={purchasedRecently === null}
                onClick={() => setStep("review")}
                className="btn-primary btn-primary-hover disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="grid gap-4">
            <div className="rounded-lg border border-border p-4 text-sm max-h-56 overflow-y-auto">
              <h3 className="font-semibold">CorvusRF Service Agreement</h3>
              <p className="mt-2">
                <strong>Service:</strong> During the term of this agreement, CorvusRF will evaluate
                your current property tax assessment for errors and available exemptions and
                perform a comparative market analysis. If CorvusRF determines your property
                assessment is incorrect, CorvusRF will prepare and file evidence supporting a
                reduction with your county tax assessor and/or review board, and will represent you
                at hearings and negotiate an assessment reduction on your behalf.
              </p>
              <p className="mt-2">
                <strong>Fee:</strong> There is no fee unless CorvusRF successfully obtains a
                reduction in your property's assessed value. If successful, CorvusRF's fee is 25%
                of the property tax savings obtained for the year in which the appeal is filed,
                plus any recovered tax overpayments (refunds) from previous years.
              </p>
              <p className="mt-2">
                <strong>Scope of Authorization:</strong> you authorize CorvusRF to execute and
                submit an Appointment of Agent for Property Tax Matters (or similar form) with your
                county appraisal district; obtain property, owner, and tax information on your
                behalf; represent and negotiate on your behalf with the appraisal district and
                review board; and present evidence at hearings.
              </p>
              <p className="mt-2">
                <strong>Termination:</strong> you may terminate this agreement at any time up to two
                months before the appeal filing deadline. You remain responsible for fees arising
                from services already provided before termination.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                CorvusRF, {AGREEMENT.address} · {AGREEMENT.phone} · {AGREEMENT.email}. Governed by
                the laws of the State of Texas; venue in {AGREEMENT.venue}.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5"
              />
              I have read and agree to the CorvusRF Service Agreement above, and authorize CorvusRF
              to act as my agent for this property's tax matters.
            </label>
            <div>
              <SignaturePad expectedName={property.ownerName} onChange={setSignature} />
            </div>
            <div className="rounded-lg bg-secondary/40 p-4 text-sm grid gap-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Parcel Number</span>
                <span>{property.accountNumber ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Full Name</span>
                <span>{firstName} {lastName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{phone}</span>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("purchase")} className="btn-outline">
                Back
              </button>
              <button
                disabled={!agreed || !signature || submitting}
                onClick={handleSubmit}
                className="btn-primary btn-primary-hover disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Sign & Submit"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
