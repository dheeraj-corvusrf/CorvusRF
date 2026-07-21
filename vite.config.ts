// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Served at https://dheeraj-corvusrf.github.io/CorvusRF/ (GitHub Pages project site).
const base = "/CorvusRF/";

export default defineConfig({
  vite: { base },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // GitHub Pages only serves static files, so every route is prerendered to HTML at
    // build time instead of relying on a live SSR server.
    prerender: { enabled: true, crawlLinks: true },
  },
  // GitHub Pages can't run server code (Workers/Node); disable the Nitro server build
  // entirely so `vite build` emits a purely static site.
  nitro: false,
});
