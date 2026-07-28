import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getMyProfile, updateMyProfile, deleteMyAccount } from "@/lib/profile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/dashboard/_layout/settings")({
  component: Settings,
});

function Settings() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

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

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteMyAccount();
      // Navigate away from /dashboard/* and WAIT for it to finish before signing
      // out — otherwise the dashboard layout's own "no user -> /sign-in" guard,
      // still mounted while this promise is in flight, reacts to the auth state
      // change first and wins the race to /sign-in instead of landing on "/".
      await nav({ to: "/" });
      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete your account.");
      setDeleting(false);
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

      {!loading && (
        <div className="mt-8 card-elev max-w-xl border-destructive/30 p-6">
          <h2 className="font-semibold text-destructive">Danger Zone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently delete your account and everything under it — properties, BPP accounts,
            documents, and protest history. This cannot be undone.
          </p>
          <button
            onClick={() => setDeleteOpen(true)}
            className="btn-outline mt-4 border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Delete Account
          </button>
        </div>
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteConfirmText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account, every property, BPP account, document, and
              protest case on file. There is no way to recover this data afterward.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Type DELETE to confirm
            </span>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoFocus
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setDeleteOpen(false)} className="btn-outline">
              Cancel
            </button>
            <button
              disabled={deleteConfirmText !== "DELETE" || deleting}
              onClick={handleDeleteAccount}
              className="btn-primary bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Permanently Delete Account"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
