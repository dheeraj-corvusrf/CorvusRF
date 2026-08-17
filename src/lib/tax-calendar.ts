import { listProperties, type PropertyRecord } from "./properties";
import { listProtests, type ProtestRecord } from "./protests";
import { listTaxBills, type TaxBillRecord } from "./tax-bills";
import { listBppAccounts, type BppAccountRecord } from "./bpp-accounts";

export type CalendarEventType =
  | "protest_deadline"
  | "hearing"
  | "arb_decision"
  | "tax_due"
  | "tax_penalty"
  | "refund_expected"
  | "bpp_rendition";

export type CalendarEvent = {
  id: string;
  date: string; // ISO date (YYYY-MM-DD)
  type: CalendarEventType;
  title: string;
  amount: number | null;
  propertyId: string | null;
  linkTo: string;
  /** True once the event is behind us in a way that no longer needs action (paid, closed, past). */
  resolved: boolean;
};

export const EVENT_TYPE_LABEL: Record<CalendarEventType, string> = {
  protest_deadline: "Protest Deadline",
  hearing: "ARB Hearing",
  arb_decision: "ARB Decision",
  tax_due: "Tax Bill Due",
  tax_penalty: "Tax Penalty Date",
  refund_expected: "Refund Expected",
  bpp_rendition: "BPP Rendition Deadline",
};

// Tailwind color tokens keyed by event type, used for the month-grid dots.
export const EVENT_TYPE_COLOR: Record<CalendarEventType, string> = {
  protest_deadline: "bg-destructive",
  hearing: "bg-accent",
  arb_decision: "bg-primary",
  tax_due: "bg-amber-500",
  tax_penalty: "bg-destructive",
  refund_expected: "bg-success",
  bpp_rendition: "bg-violet-500",
};

// Texas's BPP rendition deadline is a fixed statutory date (April 15) rather than
// something tracked per-account in the DB — computed here instead of stored.
function nextBppRenditionDeadline(from: Date): string {
  const year = from.getFullYear();
  const thisYearDeadline = new Date(Date.UTC(year, 3, 15));
  const deadline = from <= thisYearDeadline ? thisYearDeadline : new Date(Date.UTC(year + 1, 3, 15));
  return deadline.toISOString().slice(0, 10);
}

function toIsoDate(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function fromProperty(p: PropertyRecord, taxBillPropertyIds: Set<string>): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  if (p.protestDeadline) {
    events.push({
      id: `protest-deadline:${p.id}`,
      date: toIsoDate(p.protestDeadline),
      type: "protest_deadline",
      title: `Protest deadline — ${p.address}`,
      amount: null,
      propertyId: p.id,
      linkTo: "/dashboard/properties",
      resolved: new Date(p.protestDeadline) < new Date(),
    });
  }
  // Only used as a fallback for properties that don't have a real tax_bills row yet —
  // once a bill exists there, that richer record supersedes this denormalized snapshot
  // (see updatePropertyBillSnapshot in src/lib/tax-bills.ts).
  if (p.paymentDueDate && !taxBillPropertyIds.has(p.id)) {
    events.push({
      id: `tax-due:property:${p.id}`,
      date: toIsoDate(p.paymentDueDate),
      type: "tax_due",
      title: `Tax bill due — ${p.address}`,
      amount: p.taxAmountDue,
      propertyId: p.id,
      linkTo: "/dashboard/tax-bills",
      resolved: !!p.paidAt,
    });
  }
  return events;
}

function fromProtest(pr: ProtestRecord, properties: PropertyRecord[]): CalendarEvent[] {
  const property = properties.find((p) => p.id === pr.propertyId);
  const address = property?.address ?? "your property";
  const events: CalendarEvent[] = [];
  if (pr.status === "hearing_scheduled" && pr.hearingDate) {
    events.push({
      id: `hearing:${pr.id}`,
      date: toIsoDate(pr.hearingDate),
      type: "hearing",
      title: `ARB hearing — ${address}`,
      amount: null,
      propertyId: pr.propertyId,
      linkTo: "/dashboard/properties",
      resolved: new Date(pr.hearingDate) < new Date(),
    });
  }
  if (pr.arbDecisionDate) {
    events.push({
      id: `arb-decision:${pr.id}`,
      date: toIsoDate(pr.arbDecisionDate),
      type: "arb_decision",
      title: `ARB decision — ${address}`,
      amount: null,
      propertyId: pr.propertyId,
      linkTo: "/dashboard/properties",
      resolved: true,
    });
  }
  return events;
}

function fromTaxBill(bill: TaxBillRecord, properties: PropertyRecord[]): CalendarEvent[] {
  const property = properties.find((p) => p.id === bill.propertyId);
  const address = property?.address ?? "your property";
  const yearLabel = bill.taxYear ? ` (${bill.taxYear})` : "";
  const events: CalendarEvent[] = [];
  if (bill.dueDate) {
    events.push({
      id: `tax-due:bill:${bill.id}`,
      date: toIsoDate(bill.dueDate),
      type: "tax_due",
      title: `Tax bill due${yearLabel} — ${address}`,
      amount: bill.amountDue,
      propertyId: bill.propertyId,
      linkTo: "/dashboard/tax-bills",
      resolved: !!bill.paidAt,
    });
  }
  if (bill.penaltyDate) {
    events.push({
      id: `tax-penalty:${bill.id}`,
      date: toIsoDate(bill.penaltyDate),
      type: "tax_penalty",
      title: `Penalty date${yearLabel} — ${address}`,
      amount: null,
      propertyId: bill.propertyId,
      linkTo: "/dashboard/tax-bills",
      resolved: !!bill.paidAt || new Date(bill.penaltyDate) < new Date(),
    });
  }
  if (bill.refundExpectedAt) {
    events.push({
      id: `refund:${bill.id}`,
      date: toIsoDate(bill.refundExpectedAt),
      type: "refund_expected",
      title: `Refund expected${yearLabel} — ${address}`,
      amount: bill.refundAmount,
      propertyId: bill.propertyId,
      linkTo: "/dashboard/tax-bills",
      resolved: !!bill.refundReceivedAt,
    });
  }
  return events;
}

function fromBppAccount(account: BppAccountRecord, now: Date): CalendarEvent {
  const date = nextBppRenditionDeadline(now);
  return {
    id: `bpp-rendition:${account.id}:${date}`,
    date,
    type: "bpp_rendition",
    title: `BPP rendition deadline — ${account.businessName}`,
    amount: null,
    propertyId: null,
    linkTo: "/dashboard/bpp-accounts",
    resolved: false,
  };
}

export async function getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
  const [properties, protests, taxBills, bppAccounts] = await Promise.all([
    listProperties(userId),
    listProtests(userId),
    listTaxBills(userId),
    listBppAccounts(userId),
  ]);

  const taxBillPropertyIds = new Set(taxBills.map((b) => b.propertyId));
  const now = new Date();

  const events: CalendarEvent[] = [
    ...properties.flatMap((p) => fromProperty(p, taxBillPropertyIds)),
    ...protests.flatMap((pr) => fromProtest(pr, properties)),
    ...taxBills.flatMap((b) => fromTaxBill(b, properties)),
    ...bppAccounts.map((a) => fromBppAccount(a, now)),
  ];

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

// Google's "quick add" calendar link — no auth, no API key, just a prefilled form.
export function googleCalendarAddUrl(event: CalendarEvent): string {
  const compact = event.date.replace(/-/g, "");
  // All-day event: end date is exclusive, so use the following day.
  const end = new Date(event.date + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 1);
  const endCompact = end.toISOString().slice(0, 10).replace(/-/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${compact}/${endCompact}`,
    details: `${EVENT_TYPE_LABEL[event.type]}${event.amount != null ? ` — $${event.amount.toLocaleString()}` : ""} — via CorvusPT.ai`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
