import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isToday,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight, Download, ExternalLink, RefreshCw, Copy } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { markPropertyPaid } from "@/lib/properties";
import {
  getCalendarEvents,
  googleCalendarAddUrl,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_COLOR,
  type CalendarEvent,
  type CalendarEventType,
} from "@/lib/tax-calendar";
import { downloadIcs } from "@/lib/ics";
import {
  getOrCreateFeedToken,
  regenerateFeedToken,
  getFeedHttpsUrl,
  googleCalendarSubscribeUrl,
} from "@/lib/calendar-feed";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export const Route = createFileRoute("/dashboard/_layout/calendar")({
  component: CalendarPage,
});

const GROUP_ORDER: CalendarEventType[] = [
  "protest_deadline",
  "hearing",
  "arb_decision",
  "tax_due",
  "tax_penalty",
  "refund_expected",
  "bpp_rendition",
];

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function DaysLeftBadge({ event }: { event: CalendarEvent }) {
  if (event.resolved) return <span className="badge-soft text-success">Done</span>;
  const daysLeft = daysUntil(event.date);
  return (
    <span className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}>
      {daysLeft < 0
        ? "Past due"
        : daysLeft === 0
          ? "Today"
          : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
    </span>
  );
}

function EventRow({
  event,
  onMarkPaid,
  markingPaid,
}: {
  event: CalendarEvent;
  onMarkPaid?: (propertyId: string) => void;
  markingPaid: boolean;
}) {
  const isPropertySnapshotBill = event.id.startsWith("tax-due:property:");
  return (
    <div className="card-elev p-4 flex items-center justify-between flex-wrap gap-3">
      <div>
        <div className="font-medium">{event.title}</div>
        <div className="text-xs text-muted-foreground">
          {format(new Date(event.date + "T00:00:00"), "MMM d, yyyy")}
          {event.amount != null ? ` • $${event.amount.toLocaleString()}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DaysLeftBadge event={event} />
        {isPropertySnapshotBill && !event.resolved && event.propertyId && onMarkPaid && (
          <button
            disabled={markingPaid}
            onClick={() => onMarkPaid(event.propertyId as string)}
            className="btn-outline text-sm disabled:opacity-60"
          >
            {markingPaid ? "Saving…" : "Mark as Paid"}
          </button>
        )}
        <a
          href={googleCalendarAddUrl(event)}
          target="_blank"
          rel="noreferrer"
          className="btn-outline text-sm inline-flex items-center gap-1"
          title="Add to Google Calendar"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Google
        </a>
        <Link to={event.linkTo} className="text-sm text-muted-foreground hover:text-foreground">
          View
        </Link>
      </div>
    </div>
  );
}

// One real subscribe link for the WHOLE calendar (every property, every
// event type) — distinct from EventRow's per-event "Google" quick-add
// button above, which only ever adds that one event. Subscribing here
// means new deadlines that show up later (a new property, a rescheduled
// hearing) appear in Google automatically on its own refresh, with nothing
// more to click — a quick-add link can't do that, it's a one-time copy.
function GoogleSyncSection({ userId }: { userId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getOrCreateFeedToken(userId)
      .then(setToken)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not set up sync."))
      .finally(() => setLoading(false));
  }, [userId]);

  async function handleRegenerate() {
    if (
      !window.confirm(
        "Get a new sync link? Any calendar already subscribed with the old one will stop updating.",
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      setToken(await regenerateFeedToken(userId));
      toast.success("New sync link generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate a new link.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleCopy() {
    if (!token) return;
    await navigator.clipboard.writeText(getFeedHttpsUrl(token));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card-elev p-4">
      <h2 className="font-semibold">Sync with Google Calendar</h2>
      <p className="text-sm text-muted-foreground mt-1">
        One link for your whole tax calendar — every property's deadlines, hearings, tax bills, and
        BPP renditions. Subscribe once and new dates keep showing up on their own; Google typically
        checks for updates every 12–24 hours, not instantly.
      </p>
      {loading ? (
        <Skeleton className="h-9 w-40 mt-3" />
      ) : token ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={googleCalendarSubscribeUrl(token)}
            target="_blank"
            rel="noreferrer"
            className="btn-primary btn-primary-hover text-sm inline-flex items-center gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Add to Google Calendar
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="btn-outline text-sm inline-flex items-center gap-1.5"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? "Copied!" : "Copy Link"}
          </button>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {regenerating ? "Generating…" : "Get a new link"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-destructive">Could not set up your sync link.</p>
      )}
    </div>
  );
}

function CalendarPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    getCalendarEvents(user.id)
      .then(setEvents)
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleMarkPaid(propertyId: string) {
    setMarkingPaidId(propertyId);
    try {
      await markPropertyPaid(propertyId);
      setEvents((prev) =>
        prev.map((e) =>
          e.propertyId === propertyId && e.type === "tax_due" ? { ...e, resolved: true } : e,
        ),
      );
      toast.success("Marked as paid.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this bill.");
    } finally {
      setMarkingPaidId(null);
    }
  }

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const upcomingCount = events.filter((e) => !e.resolved && daysUntil(e.date) >= 0).length;

  const visibleEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : events;

  const grouped = GROUP_ORDER.map((type) => ({
    type,
    items: visibleEvents.filter((e) => e.type === type),
  })).filter((g) => g.items.length > 0);

  if (loading) {
    return (
      <div className="grid gap-8">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Calendar</h1>
          <p className="text-muted-foreground text-sm">
            Protest deadlines, ARB hearings, tax bills, and BPP renditions, in one place.
          </p>
        </div>
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="card-elev p-4 flex items-center justify-between gap-2">
              <div className="grid gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-6 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Calendar</h1>
          <p className="text-muted-foreground text-sm">
            {upcomingCount > 0
              ? `${upcomingCount} upcoming item${upcomingCount === 1 ? "" : "s"} across protests, hearings, and tax bills.`
              : "Protest deadlines, ARB hearings, tax bills, and BPP renditions, in one place."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSyncOpen((o) => !o)}
            className="btn-outline text-sm inline-flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Sync with Google Calendar
          </button>
          {events.length > 0 && (
            <button
              onClick={() => downloadIcs("corvuspt-tax-calendar.ics", events)}
              className="btn-outline text-sm inline-flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" /> Export all (.ics)
            </button>
          )}
        </div>
      </div>

      {syncOpen && user && <GoogleSyncSection userId={user.id} />}

      <div className="card-elev p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMonth((m) => subMonths(m, 1))}
            className="rounded-md p-1.5 hover:bg-secondary"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="font-semibold">{format(month, "MMMM yyyy")}</h2>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="rounded-md p-1.5 hover:bg-secondary"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {gridDays.map((day) => {
            const iso = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDate.get(iso) ?? [];
            const inMonth = isSameMonth(day, month);
            const selected = selectedDate === iso;
            // Property addresses shown directly on the grid now, not just on
            // hover — up to 3 visible, the rest folded into a "+N more" line
            // (still hoverable for the full list) so a day with a lot on it
            // doesn't blow out every row's height.
            const VISIBLE = 3;
            const shown = dayEvents.slice(0, VISIBLE);
            const overflow = dayEvents.length - shown.length;
            const dayButton = (
              <button
                key={iso}
                onClick={() => setSelectedDate(selected ? null : iso)}
                className={`min-h-20 rounded-md p-1 text-left text-sm transition-colors ${
                  selected
                    ? "bg-accent/20 ring-1 ring-accent"
                    : dayEvents.length > 0
                      ? "hover:bg-secondary/60"
                      : "hover:bg-secondary/30"
                } ${!inMonth ? "text-muted-foreground/40" : ""}`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    isToday(day) ? "bg-primary text-primary-foreground" : ""
                  }`}
                >
                  {format(day, "d")}
                </span>
                {shown.length > 0 && (
                  <div className="mt-1 grid gap-0.5">
                    {shown.map((e) => (
                      <div key={e.id} className="flex items-center gap-1 min-w-0">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${EVENT_TYPE_COLOR[e.type]}`}
                        />
                        <span className="truncate text-[10px] leading-tight text-muted-foreground">
                          {e.propertyLabel}
                        </span>
                      </div>
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] leading-tight text-muted-foreground pl-2.5">
                        +{overflow} more
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
            // Hover still gives the full list with event type included (the
            // grid itself only has room for the property address) — a
            // supplement, not the only way to see what's there anymore.
            if (dayEvents.length === 0) return dayButton;
            return (
              <Tooltip key={iso}>
                <TooltipTrigger asChild>{dayButton}</TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="grid gap-0.5">
                    {dayEvents.map((e) => (
                      <span key={e.id}>{e.title}</span>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="-mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {format(new Date(selectedDate + "T00:00:00"), "MMMM d, yyyy")}
          </p>
          <button
            onClick={() => setSelectedDate(null)}
            className="text-sm text-accent hover:underline"
          >
            Clear filter — show all
          </button>
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="card-elev p-6 text-center text-sm text-muted-foreground">
          {selectedDate
            ? "Nothing on this day."
            : "No dates tracked yet. Add a property, protest, or tax bill and its dates will show up here."}
        </div>
      ) : (
        grouped.map(({ type, items }) => (
          <section key={type}>
            <h2 className="font-semibold">{EVENT_TYPE_LABEL[type]}</h2>
            <div className="mt-3 grid gap-3">
              {items.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onMarkPaid={handleMarkPaid}
                  markingPaid={markingPaidId === event.propertyId}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
