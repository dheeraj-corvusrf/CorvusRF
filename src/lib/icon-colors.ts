// Shared icon-circle color palette, reused across marketing pages, the dashboard, and
// the AI Report module grid so a "give each item its own color" treatment stays
// centrally defined instead of re-invented per file. Every tone here already exists
// somewhere else in this app — accent/success/warning are theme tokens
// (src/styles.css), violet/teal/pink/sky match the ad hoc hex values already used in
// the dashboard's PortfolioValueChart/ProtestStatusChart (src/routes/dashboard/_layout.index.tsx) —
// nothing new is being invented, just applied more consistently.
export type IconColor = { bg: string; text: string };

export const ICON_COLORS: IconColor[] = [
  { bg: "bg-accent/15", text: "text-accent" },
  { bg: "bg-violet-500/15", text: "text-violet-600" },
  { bg: "bg-teal-500/15", text: "text-teal-600" },
  { bg: "bg-warning/20", text: "text-warning-foreground" },
  { bg: "bg-pink-500/15", text: "text-pink-600" },
  { bg: "bg-success/15", text: "text-success" },
  { bg: "bg-sky-500/15", text: "text-sky-600" },
];
