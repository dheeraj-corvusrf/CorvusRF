import { useState } from "react";
import { toast } from "sonner";
import type { CadRecord } from "@/lib/cad-lookup";
import { addProperty } from "@/lib/properties";
import { currency } from "@/lib/intake-store";

export function OwnerMatchModal({
  userId,
  companyName,
  matches,
  onDone,
}: {
  userId: string;
  companyName: string;
  matches: CadRecord[];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(matches.map((_, i) => i)));
  const [saving, setSaving] = useState(false);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function addSelected() {
    setSaving(true);
    let added = 0;
    for (const i of selected) {
      const m = matches[i];
      try {
        await addProperty(userId, {
          address: m.propertyAddress,
          cad: m.cad,
          accountNumber: m.accountNumber ?? undefined,
          ownerName: m.ownerName ?? undefined,
          propertyType: m.propertyType ?? undefined,
          landValue: m.landValue ?? undefined,
          improvementValue: m.improvementValue ?? undefined,
          totalValue: m.totalValue ?? undefined,
          taxYear: m.taxYear ?? undefined,
        });
        added++;
      } catch (err) {
        console.error(err);
      }
    }
    setSaving(false);
    toast.success(`Added ${added} propert${added === 1 ? "y" : "ies"} to your dashboard.`);
    onDone();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-primary/60 backdrop-blur-sm"
      onClick={onDone}
    >
      <div className="card-elev p-6 w-full max-w-xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif text-xl font-semibold">
          We found {matches.length} propert{matches.length === 1 ? "y" : "ies"} under "{companyName}"
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Matched against public county appraisal records. Uncheck any that aren't yours.
        </p>
        <div className="mt-4 grid gap-2">
          {matches.map((m, i) => (
            <label
              key={i}
              className="flex items-start gap-3 rounded-md border border-border p-3 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggle(i)}
                className="mt-1"
              />
              <div>
                <div className="font-medium">{m.propertyAddress || "Address not published"}</div>
                <div className="text-xs text-muted-foreground">
                  {m.cad}
                  {m.accountNumber ? ` • Acct ${m.accountNumber}` : ""}
                  {m.totalValue != null ? ` • ${currency(m.totalValue)}` : ""}
                </div>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            onClick={addSelected}
            disabled={saving || selected.size === 0}
            className="btn-primary btn-primary-hover disabled:opacity-60"
          >
            {saving ? "Adding…" : `Add ${selected.size || ""} to My Properties`}
          </button>
          <button onClick={onDone} className="btn-outline">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
