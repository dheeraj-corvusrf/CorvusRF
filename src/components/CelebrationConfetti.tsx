import { useEffect, useMemo, useState } from "react";

// A contained, continuously looping "bomb blast" of real paper flecks and
// celebration emoji on the AI Report's savings banner (see ai-report.tsx) —
// pieces explode outward from a fixed spot near the number, then fall with
// gravity, all clipped to the dark banner itself (its own overflow-hidden)
// rather than spilling across the whole page. Runs on its own timer the
// whole time the banner shows a completed analysis (`active`), not tied to
// hovering — earlier versions required a hover to fire (once tracking the
// real cursor position as the burst origin, then a fixed spot) and only
// played once per hover; both replaced per explicit feedback: the
// celebration should run continuously, independent of the cursor entirely.

type Piece = {
  delay: number;
  duration: number;
  burstX: number;
  burstY: number;
  fallX: number;
  fallY: number;
  rotate: number;
  color: string;
  width: number;
  height: number;
  // Set only for the emoji-flavored minority of pieces (see EMOJI_CHANCE) —
  // rendered as text content at fontSize instead of a plain colored rect.
  emoji?: string;
  fontSize?: number;
};

// Mostly the app's own emerald accent (it IS a savings/money celebration,
// not a generic party) with a few warm/cool accents mixed in purely so the
// burst doesn't read as a single flat color block — real confetti is never
// monochrome. Kept short and specific rather than a big rainbow list.
const COLORS = ["#059669", "#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#ffffff"];

// Real celebratory items, not just abstract paper — party poppers/confetti
// balls read as "congratulations," the donut/balloon lean into "treat
// yourself" for a savings win specifically. A minority of pieces (see
// EMOJI_CHANCE) rather than the whole burst, so it reads as festive variety
// mixed through real confetti, not a wall of emoji.
const EMOJI = ["🎉", "🎊", "🍩", "🎈", "✨"];
const EMOJI_CHANCE = 0.3;

// Kept modest (not the 70-piece one-shot burst an earlier version used) —
// this now runs forever in the background the whole time the report page is
// open, so piece count and interval are tuned for "continuously lively"
// rather than "biggest possible single moment."
const PIECE_COUNT = 36;
const MAX_DELAY_S = 0.3;
const MAX_DURATION_S = 1.6;
// One burst's longest possible piece (delay + duration) plus a small
// buffer — how long a single generation stays fully on screen before the
// next one takes over.
const BURST_LIFETIME_MS = (MAX_DELAY_S + MAX_DURATION_S) * 1000 + 200;
// Randomized, not fixed — with three of these mounted at once (left/center/
// right in ai-report.tsx) and identical timing, all three burst and fade in
// lockstep, which reads as one big synchronized event rather than three
// independent ones. A random gap in this range between one generation
// ending and the next starting keeps every instance on its own unrelated
// schedule, so they drift in and out of phase with each other continuously.
const MIN_GAP_MS = 400;
const MAX_GAP_MS = 1400;
function randomGapMs(): number {
  return MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
}
// Each instance's very first burst also starts at a random offset (rather
// than all three firing the instant the banner appears) for the same
// reason — otherwise every page load shows the same "all three go off
// together" opening beat before the randomized gaps above even get a
// chance to spread them out.
const MAX_INITIAL_DELAY_MS = 1200;

function randomPiece(): Piece {
  // Explosion kick: any direction, a modest radius — this is a burst
  // confined to one banner card, not a page-wide effect, so it stays small
  // relative to the container instead of a wide screen-spanning scatter.
  const angle = Math.random() * Math.PI * 2;
  const burstDist = 40 + Math.random() * 90;
  const isEmoji = Math.random() < EMOJI_CHANCE;
  return {
    delay: Math.random() * MAX_DELAY_S,
    duration: 1.1 + Math.random() * (MAX_DURATION_S - 1.1),
    burstX: Math.cos(angle) * burstDist,
    burstY: Math.sin(angle) * burstDist,
    // Gravity drop layered on after the burst — always downward, with a
    // little extra horizontal drift so the fall doesn't look perfectly
    // vertical.
    fallX: (Math.random() - 0.5) * 100,
    fallY: 90 + Math.random() * 170,
    rotate: 360 + Math.random() * 720,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    // Thin rectangles (not squares) read as actual paper flecks catching
    // the light as they tumble, not confetti-emoji dots — used for every
    // piece that isn't one of the EMOJI ones above.
    width: 6 + Math.random() * 5,
    height: 10 + Math.random() * 8,
    ...(isEmoji
      ? {
          emoji: EMOJI[Math.floor(Math.random() * EMOJI.length)],
          fontSize: 16 + Math.random() * 10,
        }
      : {}),
  };
}

export function CelebrationConfetti({
  active,
  originXPct,
  originYPct,
}: {
  // Whether the loop should be running at all — the caller passes
  // `!analyzing` (see ai-report.tsx), so this never starts before there's
  // an actual number to celebrate.
  active: boolean;
  // Where each burst originates, as a percentage of the containing banner's
  // own box — a fixed spot the caller picks (CONFETTI_ORIGIN_X_PCT/Y_PCT in
  // ai-report.tsx), not tied to the cursor.
  originXPct: number;
  originYPct: number;
}) {
  // Bumped on a timer while active — each bump both retires the previous
  // burst's DOM nodes and mounts a fresh one (see the keyed wrapper below),
  // which is what actually restarts the CSS animation: changing a piece's
  // inline custom properties on an already-finished <span> does NOT replay
  // its animation, only giving that span a genuinely new element does.
  const [burstId, setBurstId] = useState(0);

  useEffect(() => {
    if (!active) return;
    // Checked here (at effect-run time), not baked into a top-level
    // constant — matches how the rest of this app gates decorative motion
    // in CSS via `@media (prefers-reduced-motion: no-preference)` rather
    // than a JS capability flag computed once and never revisited.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // A chained setTimeout, not setInterval — each cycle picks its OWN fresh
    // random gap (see randomGapMs above), which a fixed-period setInterval
    // can't do; that randomness per hop is what keeps this instance's
    // schedule from ever locking into a repeating pattern relative to the
    // other CelebrationConfetti instances mounted alongside it.
    function scheduleNext(delayMs: number) {
      timer = setTimeout(() => {
        if (cancelled) return;
        setBurstId((id) => id + 1);
        scheduleNext(BURST_LIFETIME_MS + randomGapMs());
      }, delayMs);
    }
    scheduleNext(Math.random() * MAX_INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active]);

  // Regenerated fresh every burst — burstId is deliberately in the dep array
  // even though the callback itself never reads it, purely to force a new
  // random layout each generation instead of replaying the same explosion
  // forever (exhaustive-deps can't tell "unread but intentional trigger"
  // apart from "forgotten dependency," hence the disable/enable pair below —
  // a next-line disable isn't reliable here since Prettier is free to
  // reformat this call across more than one line, moving where the warning
  // actually anchors).
  /* eslint-disable react-hooks/exhaustive-deps */
  const pieces = useMemo<Piece[]>(
    () => Array.from({ length: PIECE_COUNT }, randomPiece),
    [burstId],
  );
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!active) return null;

  return (
    <div className="celebration-confetti" aria-hidden="true">
      {/* Keyed on burstId — see the burstId comment above for why this,
          not just re-rendering the same spans with new style values, is
          what makes each generation actually replay its fall animation. */}
      <div key={burstId}>
        {pieces.map((p, i) => (
          <span
            key={i}
            className="celebration-confetti-piece"
            style={
              {
                left: `${originXPct}%`,
                top: `${originYPct}%`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                "--burst-x": `${p.burstX}px`,
                "--burst-y": `${p.burstY}px`,
                "--fall-x": `${p.fallX}px`,
                "--fall-y": `${p.fallY}px`,
                "--confetti-rotate": `${p.rotate}deg`,
                // Emoji pieces are sized by fontSize/text content, not a
                // colored box — the two style sets are mutually exclusive
                // per piece (see randomPiece's isEmoji branch). Cast via
                // `unknown` first (not straight to CSSProperties) — the CSS
                // custom properties above and the conditionally-spread
                // union below together make this object shape different
                // enough from CSSProperties that TS refuses the direct
                // cast even though it's a real, valid inline style at
                // runtime.
                ...(p.emoji
                  ? { fontSize: `${p.fontSize}px`, lineHeight: 1 }
                  : {
                      width: `${p.width}px`,
                      height: `${p.height}px`,
                      backgroundColor: p.color,
                    }),
              } as unknown as React.CSSProperties
            }
          >
            {p.emoji}
          </span>
        ))}
      </div>
    </div>
  );
}
