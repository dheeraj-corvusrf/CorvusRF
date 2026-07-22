import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  checkIsAdmin,
  listAllUsers,
  updateUserPlan,
  deleteUserAccount,
  createUserAccount,
  PLAN_OPTIONS,
  type AdminUserRecord,
  type PlanValue,
} from "@/lib/admin";
import { listProperties, addProperty, deleteProperty, type PropertyRecord } from "@/lib/properties";
import { currency } from "@/lib/intake-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin — CorvusRF.ai" }],
  }),
  component: AdminPanel,
});

function AdminPanel() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/admin-login" });
      return;
    }
    checkIsAdmin(user.id).then((ok) => {
      if (!ok) {
        nav({ to: "/admin-login" });
        return;
      }
      setIsAdmin(true);
    });
  }, [loading, user, nav]);

  useEffect(() => {
    if (!isAdmin) return;
    listAllUsers()
      .then(setUsers)
      .catch((err) => setUsersError(err instanceof Error ? err.message : "Could not load users."))
      .finally(() => setUsersLoading(false));
  }, [isAdmin]);

  async function handlePlanChange(userId: string, plan: PlanValue) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, plan } : u)));
    try {
      await updateUserPlan(userId, plan);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Could not update plan.");
    }
  }

  async function handleDeleteUser(userId: string) {
    if (
      !window.confirm(
        "Delete this user? This removes their account, properties, and profile permanently.",
      )
    ) {
      return;
    }
    try {
      await deleteUserAccount(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : "Could not delete user.");
    }
  }

  if (loading || !user || !isAdmin) return null;

  return (
    <div className="container-page py-10">
      <span className="badge-soft">Admin</span>
      <h1 className="mt-2 font-serif text-3xl font-semibold">All Users</h1>
      <p className="text-muted-foreground">Manage every user, their properties, and their plan.</p>

      <AddUserForm onCreated={(u) => setUsers((prev) => [u, ...prev])} />

      {usersError && <p className="mt-4 text-sm text-destructive">{usersError}</p>}

      <div className="mt-6 grid gap-4">
        {usersLoading ? (
          <div className="card-elev p-8 text-center text-muted-foreground">Loading users…</div>
        ) : (
          users.map((u) => (
            <UserRow
              key={u.id}
              record={u}
              isSelf={u.id === user.id}
              expanded={expandedId === u.id}
              onToggleExpand={() => setExpandedId(expandedId === u.id ? null : u.id)}
              onPlanChange={(plan) => handlePlanChange(u.id, plan)}
              onDelete={() => handleDeleteUser(u.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AddUserForm({ onCreated }: { onCreated: (u: AdminUserRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createUserAccount({ email, password, firstName, lastName, phone });
      const updated = await listAllUsers();
      const created = updated.find((u) => u.email === email);
      if (created) onCreated(created);
      setOpen(false);
      setEmail("");
      setPassword("");
      setFirstName("");
      setLastName("");
      setPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary btn-primary-hover mt-6">
        Add User
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 card-elev p-6 grid gap-4 sm:grid-cols-2 max-w-2xl">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">First Name</span>
        <input
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Last Name</span>
        <input
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        <span className="font-medium">Email</span>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Phone</span>
        <input
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          required
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
      {error && <p className="sm:col-span-2 text-sm text-destructive">{error}</p>}
      <div className="sm:col-span-2 flex gap-2">
        <button disabled={submitting} className="btn-primary btn-primary-hover disabled:opacity-60">
          {submitting ? "Creating…" : "Create User"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-outline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function UserRow({
  record,
  isSelf,
  expanded,
  onToggleExpand,
  onPlanChange,
  onDelete,
}: {
  record: AdminUserRecord;
  isSelf: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onPlanChange: (plan: PlanValue) => void;
  onDelete: () => void;
}) {
  return (
    <div className="card-elev p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-serif text-lg font-semibold">
            {record.firstName} {record.lastName}
            {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
          </h3>
          <p className="text-sm text-muted-foreground">
            {record.email} • {record.phone}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Joined {new Date(record.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={record.plan}
            onChange={(e) => onPlanChange(e.target.value as PlanValue)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button onClick={onToggleExpand} className="btn-outline text-sm">
            {expanded ? "Hide properties" : "View properties"}
          </button>
          {!isSelf && (
            <button onClick={onDelete} className="btn-outline text-sm text-destructive">
              Delete User
            </button>
          )}
        </div>
      </div>
      {expanded && <UserProperties userId={record.id} />}
    </div>
  );
}

function UserProperties({ userId }: { userId: string }) {
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [propsLoading, setPropsLoading] = useState(true);
  const [propsError, setPropsError] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listProperties(userId)
      .then(setProperties)
      .catch((err) =>
        setPropsError(err instanceof Error ? err.message : "Could not load properties."),
      )
      .finally(() => setPropsLoading(false));
  }, [userId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newAddress.trim()) return;
    setAdding(true);
    try {
      const created = await addProperty(userId, { address: newAddress.trim() });
      setProperties((prev) => [created, ...prev]);
      setNewAddress("");
    } catch (err) {
      setPropsError(err instanceof Error ? err.message : "Could not add property.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this property?")) return;
    try {
      await deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setPropsError(err instanceof Error ? err.message : "Could not remove property.");
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      {propsError && <p className="mb-2 text-sm text-destructive">{propsError}</p>}
      <form onSubmit={handleAdd} className="flex gap-2 mb-3">
        <AddressAutocomplete
          value={newAddress}
          onChange={setNewAddress}
          placeholder="Add a property address"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button disabled={adding} className="btn-outline text-sm disabled:opacity-60">
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
      {propsLoading ? (
        <p className="text-sm text-muted-foreground">Loading properties…</p>
      ) : properties.length === 0 ? (
        <p className="text-sm text-muted-foreground">No properties.</p>
      ) : (
        <div className="grid gap-2">
          {properties.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{p.address}</div>
                <div className="text-xs text-muted-foreground">
                  {p.cad} {p.totalValue != null && `• ${currency(p.totalValue)}`}
                </div>
              </div>
              <button
                onClick={() => handleDelete(p.id)}
                className="text-destructive text-xs shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
