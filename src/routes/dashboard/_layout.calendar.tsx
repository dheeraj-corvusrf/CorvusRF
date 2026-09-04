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
import { ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
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

function CalendarPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);

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
        {events.length > 0 && (
          <button
            onClick={() => downloadIcs("corvuspt-tax-calendar.ics", events)}
            className="btn-outline text-sm inline-flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" /> Export all (.ics)
          </button>
        )}
      </div>

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
            const types = Array.from(new Set(dayEvents.map((e) => e.type)));
            const dayButton = (
              <button
                key={iso}
                onClick={() => setSelectedDate(selected ? null : iso)}
                className={`aspect-square rounded-md p-1 text-left text-sm transition-colors ${
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
                {types.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5 px-0.5">
                    {types.slice(0, 4).map((t) => (
                      <span key={t} className={`h-1.5 w-1.5 rounded-full ${EVENT_TYPE_COLOR[t]}`} />
                    ))}
                  </div>
                )}
              </button>
            );
            // Hover reveals which property (and event) each dot belongs to
            // — the dots alone give no way to tell, and event.title already
            // carries the real property address (see tax-calendar.ts).
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
