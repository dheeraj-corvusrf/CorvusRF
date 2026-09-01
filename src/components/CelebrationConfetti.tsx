import { useEffect, useMemo } from "react";

// A contained "bomb blast" of real paper flecks and celebration emoji,
// triggered by hovering the AI Report's savings number (see ai-report.tsx)
// — pieces explode outward from a fixed spot near the number, then fall
// with gravity, all clipped to the dark banner itself (its own
// overflow-hidden) rather than spilling across the whole page. Two earlier
// versions: one fell top-to-bottom of the entire viewport (Outlook-
// "Congratulations"-style), the other tracked the actual cursor position as
// the burst origin — both replaced per explicit feedback: papers should
// stay inside the blue/navy savings card, and the blast should look the
// same regardless of exactly where the cursor entered.

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
// EMOJI_CHANCE) rather than the whole burst, so it reads as festive
// variety mixed through real confetti, not a wall of emoji.
const EMOJI = ["🎉", "🎊", "🍩", "🎈", "✨"];
const EMOJI_CHANCE = 0.3;

const PIECE_COUNT = 50;
// Longest possible single piece (delay + duration) plus a small buffer —
// the overlay unmounts itself via onDone once every piece has definitely
// finished, rather than guessing a fixed screen-time.
const MAX_DELAY_S = 0.35;
const MAX_DURATION_S = 1.7;
const CLEANUP_MS = (MAX_DELAY_S + MAX_DURATION_S) * 1000 + 200;

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
  originXPct,
  originYPct,
  onDone,
}: {
  // Where the burst originates, as a percentage of the containing banner's
  // own box — a fixed spot the caller picks (see CONFETTI_ORIGIN_X_PCT/Y_PCT
  // in ai-report.tsx), not the cursor's actual entry point. An earlier
  // version tracked the real hover position; moved to a fixed origin per
  // explicit feedback — the blast should look the same every time, not
  // depend on exactly where within the number the cursor happened to land.
  originXPct: number;
  originYPct: number;
  onDone: () => void;
}) {
  // Generated once per mount (a fresh key from the caller — see ai-report.tsx
  // — remounts this for each new hover) so every burst gets its own random
  // layout instead of replaying the same explosion.
  const pieces = useMemo<Piece[]>(() => Array.from({ length: PIECE_COUNT }, randomPiece), []);

  useEffect(() => {
    const t = setTimeout(onDone, CLEANUP_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="celebration-confetti" aria-hidden="true">
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
              // colored box — the two style sets are mutually exclusive per
              // piece (see randomPiece's isEmoji branch). Cast via `unknown`
              // first (not straight to CSSProperties) — the CSS custom
              // properties above and the conditionally-spread union below
              // together make this object shape different enough from
              // CSSProperties that TS refuses the direct cast even though
              // it's a real, valid inline style at runtime.
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
  );
}
