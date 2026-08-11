import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  checkIsAdmin,
  listAllUsers,
  updateUserPlan,
  updateUserAdminStatus,
  deleteUserAccount,
  createUserAccount,
  listAllProtests,
  updateProtestStatus,
  updateProtestNotes,
  listDocumentsForProperty,
  getCaseSummary,
  toProtestRecord,
  toPropertyRecordStub,
  PLAN_OPTIONS,
  PROTEST_STATUS_OPTIONS,
  type AdminUserRecord,
  type PlanValue,
  type AdminProtestRecord,
  type AdminDocumentRecord,
  type CaseSummaryResult,
} from "@/lib/admin";
import type { ProtestRecord, ProtestStatus } from "@/lib/protests";
import { listProperties, addProperty, deleteProperty, type PropertyRecord } from "@/lib/properties";
import { currency } from "@/lib/intake-store";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { AdminCaseProgressModal } from "@/components/AdminCaseProgressModal";
import { Skeleton } from "@/components/ui/skeleton";

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

  const [protests, setProtests] = useState<AdminProtestRecord[]>([]);
  const [protestsLoading, setProtestsLoading] = useState(true);
  const [expandedProtestId, setExpandedProtestId] = useState<string | null>(null);
  const [caseRecord, setCaseRecord] = useState<AdminProtestRecord | null>(null);

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
    listAllProtests()
      .then(setProtests)
      .catch((err) => console.error(err))
      .finally(() => setProtestsLoading(false));
  }, [isAdmin]);

  async function handleProtestStatusChange(protestId: string, status: ProtestStatus) {
    const prev = protests;
    setProtests((cur) => cur.map((p) => (p.id === protestId ? { ...p, status } : p)));
    try {
      await updateProtestStatus(protestId, status);
      toast.success("Protest status updated.");
    } catch (err) {
      setProtests(prev);
      toast.error(err instanceof Error ? err.message : "Could not update protest status.");
    }
  }

  async function handleProtestNotesChange(protestId: string, notes: string) {
    setProtests((cur) => cur.map((p) => (p.id === protestId ? { ...p, notes } : p)));
    await updateProtestNotes(protestId, notes);
  }

  // CaseProgress (reused from the customer dashboard) already made the write —
  // this just keeps the modal and the row's status dropdown in sync with it.
  function handleCaseProgressUpdate(protestId: string, patch: Partial<ProtestRecord>) {
    setCaseRecord((prev) => (prev && prev.id === protestId ? { ...prev, ...patch } : prev));
    setProtests((cur) => cur.map((p) => (p.id === protestId ? { ...p, ...patch } : p)));
  }

  async function handlePlanChange(userId: string, plan: PlanValue) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, plan } : u)));
    try {
      await updateUserPlan(userId, plan);
      toast.success("Plan updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update plan.");
    }
  }

  async function handleToggleAdmin(userId: string, makeAdmin: boolean) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isAdmin: makeAdmin } : u)));
    try {
      await updateUserAdminStatus(userId, makeAdmin);
      toast.success(makeAdmin ? "User is now an admin." : "Admin access removed.");
    } catch (err) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isAdmin: !makeAdmin } : u)));
      toast.error(err instanceof Error ? err.message : "Could not update admin status.");
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
      toast.success("User deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete user.");
    }
  }

  if (loading || !user || !isAdmin) return null;

  return (
    <div className="container-page py-10">
      <span className="badge-soft">Admin</span>
      <h1 className="mt-2 font-serif text-3xl font-semibold">All Users</h1>
      <p className="text-muted-foreground">Manage every user, their properties, and their plan.</p>

      <AddUserForm onCreated={(u) => setUsers((prev) => [u, ...prev])} />

      <section className="mt-10">
        <h2 className="font-serif text-xl font-semibold">Protest Requests</h2>
        <p className="text-sm text-muted-foreground">
          Real requests from users clicking "Request Protest Filing" on their dashboard. Update
          status as staff progress each one.
        </p>
        <div className="mt-4 grid gap-3">
          {protestsLoading ? (
            <PropertyRowSkeleton />
          ) : protests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No protest requests yet.</p>
          ) : (
            protests.map((p, i) => {
              const requester = users.find((u) => u.id === p.userId);
              return (
                <ProtestRow
                  key={p.id}
                  record={p}
                  requesterEmail={requester?.email ?? p.userId}
                  expanded={expandedProtestId === p.id}
                  onToggleExpand={() =>
                    setExpandedProtestId(expandedProtestId === p.id ? null : p.id)
                  }
                  onStatusChange={(status) => handleProtestStatusChange(p.id, status)}
                  onNotesChange={(notes) => handleProtestNotesChange(p.id, notes)}
                  onOpenCase={() => setCaseRecord(p)}
                  delayMs={Math.min(i * 40, 320)}
                />
              );
            })
          )}
        </div>
      </section>

      <h2 className="mt-10 font-serif text-xl font-semibold">Users</h2>
      {usersError && <p className="mt-4 text-sm text-destructive">{usersError}</p>}

      <div className="mt-6 grid gap-4">
        {usersLoading ? (
          <>
            <UserRowSkeleton />
            <UserRowSkeleton />
            <UserRowSkeleton />
          </>
        ) : (
          users.map((u, i) => (
            <UserRow
              key={u.id}
              record={u}
              isSelf={u.id === user.id}
              expanded={expandedId === u.id}
              onToggleExpand={() => setExpandedId(expandedId === u.id ? null : u.id)}
              onPlanChange={(plan) => handlePlanChange(u.id, plan)}
              onToggleAdmin={(makeAdmin) => handleToggleAdmin(u.id, makeAdmin)}
              onDelete={() => handleDeleteUser(u.id)}
              delayMs={Math.min(i * 40, 320)}
            />
          ))
        )}
      </div>

      {caseRecord && (
        <AdminCaseProgressModal
          userId={caseRecord.userId}
          protest={toProtestRecord(caseRecord)}
          property={toPropertyRecordStub(caseRecord)}
          onUpdate={(patch) => handleCaseProgressUpdate(caseRecord.id, patch)}
          onClose={() => setCaseRecord(null)}
        />
      )}
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
      toast.success("User created.");
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

function ProtestRow({
  record,
  requesterEmail,
  expanded,
  onToggleExpand,
  onStatusChange,
  onNotesChange,
  onOpenCase,
  delayMs = 0,
}: {
  record: AdminProtestRecord;
  requesterEmail: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onStatusChange: (status: ProtestStatus) => void;
  onNotesChange: (notes: string) => Promise<void>;
  onOpenCase: () => void;
  delayMs?: number;
}) {
  const [notes, setNotes] = useState(record.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [documents, setDocuments] = useState<AdminDocumentRecord[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CaseSummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    setNotes(record.notes ?? "");
  }, [record.notes]);

  useEffect(() => {
    if (!expanded || documents !== null) return;
    listDocumentsForProperty(record.propertyId)
      .then(setDocuments)
      .catch((err) =>
        setDocsError(err instanceof Error ? err.message : "Could not load documents."),
      );
  }, [expanded, documents, record.propertyId]);

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      await onNotesChange(notes);
      toast.success("Notes saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleAiSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const statusLabel =
        PROTEST_STATUS_OPTIONS.find((o) => o.value === record.status)?.label ?? record.status;
      const propertyContext = [
        record.propertyAddress ?? "(property removed)",
        record.propertyCad && `CAD: ${record.propertyCad}`,
        record.accountNumber && `Account #: ${record.accountNumber}`,
        record.taxYear && `Tax year: ${record.taxYear}`,
        record.totalValue != null && `Total value: ${currency(record.totalValue)}`,
        record.landValue != null && `Land value: ${currency(record.landValue)}`,
        record.improvementValue != null && `Improvement value: ${currency(record.improvementValue)}`,
        record.protestDeadline && `Protest deadline: ${record.protestDeadline}`,
      ]
        .filter(Boolean)
        .join("\n");
      const protestContext = [
        `Status: ${statusLabel}`,
        `Requested: ${new Date(record.requestedAt).toLocaleDateString()}`,
        `Requester: ${requesterEmail}`,
        notes.trim() && `Staff notes: ${notes.trim()}`,
      ]
        .filter(Boolean)
        .join("\n");
      const documentsContext = documents?.length
        ? documents
            .map((d) => `- ${d.fileName} (${d.documentType ?? "unknown type"}), uploaded ${new Date(d.uploadedAt).toLocaleDateString()}`)
            .join("\n")
        : "(none uploaded)";
      const result = await getCaseSummary({ propertyContext, protestContext, documentsContext });
      setSummary(result);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Could not generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  }

  return (
    <div className="card-elev p-4" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-medium">{record.propertyAddress ?? "Property removed"}</div>
          <div className="text-xs text-muted-foreground">
            {requesterEmail} • Requested {new Date(record.requestedAt).toLocaleDateString()}
            {record.protestDeadline && ` • Deadline ${record.protestDeadline}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={record.status}
            onChange={(e) => onStatusChange(e.target.value as ProtestStatus)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PROTEST_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button onClick={onToggleExpand} className="btn-outline text-sm">
            {expanded ? "Hide details" : "View details"}
          </button>
          <button onClick={onOpenCase} className="btn-outline text-sm">
            Case Progress
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-border pt-4 grid gap-4">
          <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {record.propertyCad && <div>CAD: {record.propertyCad}</div>}
            {record.accountNumber && <div>Account #: {record.accountNumber}</div>}
            {record.taxYear && <div>Tax year: {record.taxYear}</div>}
            {record.totalValue != null && <div>Total value: {currency(record.totalValue)}</div>}
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Documents</div>
            {docsError ? (
              <p className="text-sm text-destructive">{docsError}</p>
            ) : documents === null ? (
              <Skeleton className="h-4 w-40" />
            ) : documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents uploaded.</p>
            ) : (
              <ul className="text-sm text-muted-foreground grid gap-1">
                {documents.map((d) => (
                  <li key={d.id}>
                    {d.fileName} — {d.documentType ?? "unknown type"} •{" "}
                    {new Date(d.uploadedAt).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Staff Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Internal notes about this case…"
            />
            <button
              onClick={handleSaveNotes}
              disabled={savingNotes}
              className="btn-outline text-sm mt-2 disabled:opacity-60"
            >
              {savingNotes ? "Saving…" : "Save Notes"}
            </button>
          </div>

          <div>
            <button
              onClick={handleAiSummary}
              disabled={summaryLoading}
              className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
            >
              {summaryLoading ? "Generating…" : "AI Case Summary"}
            </button>
            {summaryError && <p className="mt-2 text-sm text-destructive">{summaryError}</p>}
            {summary && (
              <div className="mt-3 rounded-md bg-secondary/50 p-3 text-sm grid gap-2">
                <p>{summary.summary}</p>
                {summary.nextAction && (
                  <p>
                    <span className="font-medium">Next action:</span> {summary.nextAction}
                  </p>
                )}
                {summary.evidenceGaps.length > 0 && (
                  <div>
                    <span className="font-medium">Evidence gaps:</span>
                    <ul className="list-disc list-inside">
                      {summary.evidenceGaps.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({
  record,
  isSelf,
  expanded,
  onToggleExpand,
  onPlanChange,
  onToggleAdmin,
  onDelete,
  delayMs = 0,
}: {
  record: AdminUserRecord;
  isSelf: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onPlanChange: (plan: PlanValue) => void;
  onToggleAdmin: (makeAdmin: boolean) => void;
  onDelete: () => void;
  delayMs?: number;
}) {
  return (
    <div className="card-elev p-6" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-serif text-lg font-semibold">
            {record.firstName} {record.lastName}
            {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
            {record.isAdmin && (
              <span className="ml-2 badge-soft text-[10px] align-middle">Admin</span>
            )}
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
          {/* Hidden for yourself so an admin can't accidentally revoke their own access. */}
          {!isSelf && (
            <button onClick={() => onToggleAdmin(!record.isAdmin)} className="btn-outline text-sm">
              {record.isAdmin ? "Remove Admin" : "Make Admin"}
            </button>
          )}
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
      setProperties((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      setNewAddress("");
      toast.success("Property added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add property.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this property?")) return;
    try {
      await deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
      toast.success("Property removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove property.");
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
        <div className="grid gap-2">
          <PropertyRowSkeleton />
          <PropertyRowSkeleton />
        </div>
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

function UserRowSkeleton() {
  return (
    <div className="card-elev p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="grid gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}

function PropertyRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-3 w-10" />
    </div>
  );
}
