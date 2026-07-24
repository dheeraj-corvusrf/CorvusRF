import { HouseIllustration } from "@/assets/illustrations/house";
import { CoupleIllustration } from "@/assets/illustrations/couple";
import { DogWalkerIllustration } from "@/assets/illustrations/dog-walker";

// A real cloud silhouette (overlapping ellipses), not just a blurred blob — reads
// clearly as a cloud instead of a vague soft patch. Opacity is applied on the <svg>
// itself (via --hero-cloud-opacity, which flips per theme same as the other hero-*
// tokens) rather than baked into --hero-cloud's color, so the overlapping shapes
// composite as one solid cloud instead of showing visible seams where two
// semi-transparent fills stack on top of each other.
function Cloud({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 60"
      fill="var(--hero-cloud)"
      style={{ opacity: "var(--hero-cloud-opacity)" }}
    >
      <rect x="14" y="34" width="68" height="20" rx="10" />
      <ellipse cx="30" cy="38" rx="26" ry="16" />
      <ellipse cx="55" cy="26" rx="22" ry="20" />
      <ellipse cx="78" cy="38" rx="18" ry="15" />
    </svg>
  );
}

// A real, clearly visible sun — a solid disc with a soft glow behind it, instead
// of relying on the house illustration's own half-hidden background circle.
function Sun({ className }: { className: string }) {
  return (
    <div className={className}>
      <div className="absolute inset-0 rounded-full blur-xl" style={{ background: "var(--hero-sun)", opacity: 0.5 }} />
      <div className="absolute inset-[18%] rounded-full" style={{ background: "var(--hero-sun)" }} />
    </div>
  );
}

// A crescent moon — one disc, plus a second disc in the sky's own color offset on
// top of it to "cut out" the crescent, clipped by the wrapper's own circular bounds.
function Moon({ className }: { className: string }) {
  return (
    <div className={className}>
      <div className="absolute inset-0 rounded-full blur-lg" style={{ background: "var(--hero-moon)", opacity: 0.35 }} />
      <div className="absolute inset-[18%] rounded-full overflow-hidden">
        <div className="absolute inset-0 rounded-full" style={{ background: "var(--hero-moon)" }} />
        <div
          className="absolute rounded-full"
          style={{ background: "var(--hero-sky-top)", width: "85%", height: "85%", top: "-15%", right: "-28%" }}
        />
      </div>
    </div>
  );
}

// Decorative background — a sky/green-field split (mirroring the reference's bold
// proportions and grass tones), real illustration artwork for the house/people/dog
// (sourced from unDraw, recolored to CorvusRF's navy/gold/teal — see
// src/assets/illustrations), plus a hand-coded car and trees (green, per request).
// Illustrations sit in the side margins beside the centered content column, hidden
// below `lg` where there isn't room for them, and share a common "ground line"
// (bottom-28) positioned higher up than the section's true bottom edge so they're
// visible without scrolling.
// `blurred` renders the same scene softened into ambient texture for content-heavy
// marketing pages (pricing, how-it-works, etc.) rather than the crisp, literal
// illustration used on the homepage hero. The wrapper is sized larger than its
// container (-inset-10) so the blur has real pixels to sample at the edges instead
// of fading into transparency there — the page section wrapping this must itself be
// `relative overflow-hidden` to clip that bleed back to the visible area.
export function HeroBackground({ blurred = false }: { blurred?: boolean } = {}) {
  return (
    <div
      className={blurred ? "absolute -inset-10 -z-10" : "absolute inset-0 -z-10 overflow-hidden"}
      aria-hidden="true"
      style={blurred ? { filter: "blur(14px)", opacity: 0.4 } : undefined}
    >
      {/* Sky */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, var(--hero-sky-top) 0%, var(--hero-sky-bottom) 100%)",
        }}
      />
      {/* Sun (light mode) / Moon (dark mode) — same spot, swapped by theme */}
      <div className="hero-sun-wrap absolute top-4 right-[16%] h-16 w-16 md:h-20 md:w-20">
        <Sun className="absolute inset-0" />
      </div>
      <div className="hero-moon-wrap absolute top-4 right-[16%] h-16 w-16 md:h-20 md:w-20">
        <Moon className="absolute inset-0" />
      </div>

      {/* Clouds in the sky */}
      <Cloud className="absolute top-8 left-[6%] h-10 w-24 md:h-12 md:w-28" />
      <Cloud className="absolute top-20 left-[20%] h-7 w-16 md:h-8 md:w-20" />
      <Cloud className="absolute top-12 right-[32%] h-9 w-20 md:h-10 md:w-24" />
      {/* Extra clouds right above the house */}
      <Cloud className="hidden lg:block absolute top-28 left-[2%] h-9 w-20" />
      <Cloud className="hidden lg:block absolute top-40 left-[12%] h-6 w-14" />

      {/* Curved field band, ~35% of the hero height */}
      <svg
        className="absolute bottom-0 left-0 h-[35%] w-full"
        viewBox="0 0 1440 400"
        preserveAspectRatio="none"
      >
        <path
          d="M0,140 C240,60 480,180 720,120 C960,60 1200,160 1440,100 L1440,400 L0,400 Z"
          fill="var(--hero-field)"
        />
        <path
          d="M0,190 C260,130 500,220 760,170 C1000,120 1220,200 1440,150 L1440,400 L0,400 Z"
          fill="var(--hero-field-shade)"
          opacity="0.55"
        />
      </svg>

      {/* Left group: house, car — raised well above the section's bottom edge so
          it's visible without scrolling on typical viewport heights. The house's
          own two built-in trees (real illustration artwork) are enough here — the
          extra hand-coded round tree that used to sit beside it was removed. */}
      <HouseIllustration className="hidden lg:block absolute bottom-28 left-[2%] h-48 w-auto xl:h-56" />
      {/* Car, parked a bit further off from the house */}
      <svg className="hidden lg:block absolute bottom-28 left-[17%] h-10 w-20 xl:h-12 xl:w-24" viewBox="0 0 100 50" fill="none">
        <rect x="5" y="24" width="90" height="18" rx="7" fill="var(--primary)" opacity="0.75" />
        <path d="M25 24 L34 9 L66 9 L75 24 Z" fill="var(--primary)" opacity="0.75" />
        <rect x="34" y="12" width="32" height="12" fill="var(--hero-sky-bottom)" opacity="0.8" />
        <circle cx="25" cy="42" r="8" fill="var(--foreground)" opacity="0.55" />
        <circle cx="75" cy="42" r="8" fill="var(--foreground)" opacity="0.55" />
      </svg>

      {/* Right group: walking couple, tree, dog walker */}
      <CoupleIllustration className="hidden lg:block absolute bottom-28 right-[6%] h-24 w-auto xl:h-28" />
      <svg className="hidden lg:block absolute bottom-28 right-[1%] h-[5.5rem] w-11 xl:h-24 xl:w-12" viewBox="0 0 40 90" fill="none">
        <rect x="17" y="45" width="6" height="45" fill="var(--primary)" opacity="0.6" />
        <circle cx="20" cy="30" r="24" fill="var(--hero-tree)" opacity="0.85" />
      </svg>
      {/* Dog walker */}
      <DogWalkerIllustration className="hidden xl:block absolute bottom-28 right-[19%] h-32 w-auto xl:h-36" />
    </div>
  );
}
