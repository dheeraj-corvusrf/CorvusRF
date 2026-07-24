import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { currency } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProperties, markPropertyPaid, type PropertyRecord } from "@/lib/properties";

export const Route = createFileRoute("/dashboard/_layout/deadlines")({
  component: Deadlines,
});

function Deadlines() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    listProperties(user.id)
      .then(setProperties)
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleMarkPaid(propertyId: string) {
    setMarkingPaidId(propertyId);
    try {
      const updated = await markPropertyPaid(propertyId);
      setProperties((prev) => prev.map((p) => (p.id === propertyId ? updated : p)));
      toast.success("Marked as paid.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this bill.");
    } finally {
      setMarkingPaidId(null);
    }
  }

  const deadlines = properties
    .filter((p) => !!p.protestDeadline)
    .map((p) => {
      const deadline = new Date(p.protestDeadline as string);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return { property: p, deadline, daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const bills = properties
    .filter((p) => !!p.paymentDueDate)
    .map((p) => {
      const dueDate = new Date(p.paymentDueDate as string);
      const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return { property: p, dueDate, daysLeft, isPaid: !!p.paidAt };
    })
    .sort((a, b) => Number(a.isPaid) - Number(b.isPaid) || a.daysLeft - b.daysLeft);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Deadlines</h1>
        <p className="text-muted-foreground text-sm">Protest deadlines and tax bills, in one place.</p>
      </div>

      <section>
        <h2 className="font-semibold">Protest Deadlines</h2>
        <div className="mt-3">
          {deadlines.length > 0 ? (
            <div className="grid gap-3">
              {deadlines.map(({ property, deadline, daysLeft }) => (
                <div
                  key={property.id}
                  className="card-elev p-4 flex items-center justify-between flex-wrap gap-2"
                >
                  <div>
                    <div className="font-medium">{property.address}</div>
                    <div className="text-xs text-muted-foreground">
                      Protest deadline: {deadline.toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}>
                    {daysLeft < 0
                      ? "Deadline passed"
                      : daysLeft === 0
                        ? "Due today"
                        : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-6 text-center text-sm text-muted-foreground">
              No notifications. Upload an appraisal notice with a protest deadline and it'll show up here.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Tax Bills</h2>
        <div className="mt-3">
          {bills.length > 0 ? (
            <div className="grid gap-3">
              {bills.map(({ property, dueDate, daysLeft, isPaid }) => (
                <div
                  key={property.id}
                  className="card-elev p-4 flex items-center justify-between flex-wrap gap-2"
                >
                  <div>
                    <div className="font-medium">{property.address}</div>
                    <div className="text-xs text-muted-foreground">
                      Due {dueDate.toLocaleDateString()}
                      {property.taxAmountDue != null ? ` • ${currency(property.taxAmountDue)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPaid ? (
                      <span className="badge-soft text-success">Paid</span>
                    ) : (
                      <>
                        <span className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}>
                          {daysLeft < 0
                            ? "Overdue"
                            : daysLeft === 0
                              ? "Due today"
                              : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                        </span>
                        <button
                          disabled={markingPaidId === property.id}
                          onClick={() => handleMarkPaid(property.id)}
                          className="btn-outline text-sm disabled:opacity-60"
                        >
                          {markingPaidId === property.id ? "Saving…" : "Mark as Paid"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-6 text-center text-sm text-muted-foreground">
              No tax bills tracked yet. Upload a tax bill or statement and its due date and amount will
              show up here.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
