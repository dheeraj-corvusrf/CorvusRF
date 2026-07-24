import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { listBppAccounts, addBppAccount, deleteBppAccount, type BppAccountRecord } from "@/lib/bpp-accounts";

export const Route = createFileRoute("/dashboard/_layout/bpp-accounts")({
  component: BppAccounts,
});

function BppAccounts() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<BppAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [cad, setCad] = useState("");
  const [locationAddress, setLocationAddress] = useState("");

  useEffect(() => {
    if (!user) return;
    listBppAccounts(user.id)
      .then(setAccounts)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load BPP accounts."))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !businessName.trim()) return;
    setSaving(true);
    try {
      const created = await addBppAccount(user.id, {
        businessName: businessName.trim(),
        accountNumber: accountNumber.trim() || undefined,
        cad: cad.trim() || undefined,
        locationAddress: locationAddress.trim() || undefined,
      });
      setAccounts((prev) => [created, ...prev]);
      setBusinessName("");
      setAccountNumber("");
      setCad("");
      setLocationAddress("");
      setShowForm(false);
      toast.success("BPP account added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add this BPP account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this BPP account?")) return;
    setDeletingId(id);
    try {
      await deleteBppAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      toast.success("BPP account removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this BPP account.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">BPP Accounts</h1>
          <p className="text-muted-foreground text-sm">
            Business Personal Property tax accounts — separate from real estate you own.
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary btn-primary-hover">
          {showForm ? "Cancel" : "Add BPP Account"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="mt-6 card-elev p-6 grid gap-3 sm:grid-cols-2">
          <input
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Business name"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="CAD account number (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={cad}
            onChange={(e) => setCad(e.target.value)}
            placeholder="County / CAD (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={locationAddress}
            onChange={(e) => setLocationAddress(e.target.value)}
            placeholder="Business location address (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm sm:col-span-2"
          />
          <button type="submit" disabled={saving} className="btn-accent w-fit disabled:opacity-60">
            {saving ? "Saving…" : "Save BPP Account"}
          </button>
        </form>
      )}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : accounts.length > 0 ? (
          <div className="grid gap-4">
            {accounts.map((a) => (
              <div key={a.id} className="card-elev p-5 flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="font-semibold">{a.businessName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {[a.cad, a.accountNumber ? `Acct ${a.accountNumber}` : null, a.locationAddress]
                      .filter(Boolean)
                      .join(" • ") || "No additional details"}
                  </p>
                </div>
                <button
                  disabled={deletingId === a.id}
                  onClick={() => handleDelete(a.id)}
                  className="btn-outline text-destructive text-sm disabled:opacity-60"
                >
                  {deletingId === a.id ? "Removing…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="card-elev p-8 text-center">
            <h3 className="font-serif text-xl font-semibold">No BPP accounts yet.</h3>
            <p className="text-muted-foreground mt-1">
              Add a business personal property account to start tracking its rendition.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
