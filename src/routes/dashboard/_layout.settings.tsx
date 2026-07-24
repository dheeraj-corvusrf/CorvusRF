import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getMyProfile, updateMyProfile } from "@/lib/profile";

export const Route = createFileRoute("/dashboard/_layout/settings")({
  component: Settings,
});

function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");

  useEffect(() => {
    if (!user) return;
    getMyProfile(user.id)
      .then((p) => {
        setEmail(p.email);
        setFirstName(p.firstName ?? "");
        setLastName(p.lastName ?? "");
        setPhone(p.phone ?? "");
        setCompanyName(p.companyName ?? "");
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load your profile."))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await updateMyProfile(user.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        companyName: companyName.trim() || null,
      });
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold">Settings</h1>
      <p className="text-muted-foreground text-sm">Your account details.</p>

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="mt-6 card-elev p-6 max-w-xl grid gap-4">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Email</span>
            <input
              disabled
              value={email}
              className="mt-1 w-full rounded-md border border-input bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">First name</span>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">Last name</span>
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Phone</span>
            <input
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Company name (optional)</span>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <button type="submit" disabled={saving} className="btn-primary btn-primary-hover w-fit disabled:opacity-60">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </form>
      )}
    </div>
  );
}
