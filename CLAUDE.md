# CLAUDE.md

Guidance for agents working on the **training dashboard**.

Scope note: this file governs the Strava training dashboard (`dashboard/`) inside the
`julienmann.ca` site repo (`github.com/lionelmann/julienmann`). Paths below are relative to
that repo root (one level up from this file). The repo root also holds a separate
`PRODUCT.md` / `DESIGN.md` describing the wider site ("Mann Dev"); those are not about the
dashboard. The dashboard's own design context lives here in `dashboard/`.

## What this is

A **Strava-connected endurance training dashboard**: a self-serve training planner for
runners (5K through 50K) and triathletes (sprint through full Ironman). Pick a preset,
generate a custom periodized plan with AI, or build one by hand; the dashboard then renders
the day-by-day schedule, tracks progress to race day, and adapts upcoming sessions to real
Strava performance. It deploys as part of the julienmann.ca site at **julienmann.ca/dashboard/**.

## Layout

- `dashboard/index.html` — the entire dashboard: a **single self-contained file** (HTML + CSS
  + vanilla JS, no build step, no framework). All plan logic, rendering, Strava integration,
  and the Plan Builder / AI questionnaire live here.
- `dashboard/{PRODUCT,DESIGN}.md`, `dashboard/DESIGN.json` — the dashboard's design context (see below).
- `strava-worker/` — Cloudflare Worker that proxies Strava OAuth and Anthropic AI calls. Holds
  all secrets. (A duplicate copy also sits at `dashboard/worker/`.)
- Serve locally from the repo root: `python3 -m http.server 8080`, then open
  `http://localhost:8080/dashboard/index.html`.

## Security constraints (non-negotiable)

- **No secrets in the frontend.** The Strava client secret and the Anthropic API key live ONLY
  in the Cloudflare Worker as env secrets (`wrangler secret put`), set by the user in their own
  terminal. Never put them in source, never ask for them in chat.
- All AI calls go through the worker `/ai` proxy (`https://strava-auth.jmdashboard.workers.dev/ai`),
  never directly to Anthropic from the browser. Any new AI feature must route through this proxy.
- Strava `STRAVA_CLIENT_ID` and `WORKER_URL` are fine in source (not secret).

## How the plan engine works

- A plan is stored per-browser in `localStorage` (`jm_plan_v1`); `DEFAULT_PLAN` seeds first-time visitors.
- `computePlan(plan)` expands a stored plan (race info + ordered phases with 7-day templates +
  optional recovery templates + tune-up race events) into the date-resolved structures the UI
  renders from. Only the final phase is pinned to race day.
- `validatePlan(plan)` is the single gate used by the manual save, the AI path (`sanitizeAiPlan`
  calls it), and presets. Add new plan-shape invariants here, not in three places.
- `PRESET_SPECS` / `buildPreset(id)` are the ready-made plans (70.3, full, 5k, 10k, 21k, 42k,
  50k), stamped with dates from today on apply.
- The UI renders **per-activity via `sportStyle`**, so it is sport-agnostic: running-only plans
  (empty swim/bike) render correctly with no triathlon assumptions. Keep it that way.
- AI calls share `aiFetch` / `aiModelCandidates` (model fallback + worker proxy). Reuse them;
  don't duplicate the fetch loop.

## Design context

The dashboard has impeccable design context alongside this file. **Read these before any UI/design work:**

- **`dashboard/PRODUCT.md`** — register (`product`), users, purpose, brand personality,
  anti-references, and 5 strategic design principles.
- **`dashboard/DESIGN.md`** — the visual system (Stitch format): color tokens, typography,
  elevation, components, do's and don'ts. `dashboard/DESIGN.json` is the machine-readable sidecar.

(impeccable's loader auto-discovers context at a project root, so when running its commands for
the dashboard, point it here, e.g. `IMPECCABLE_CONTEXT_DIR=dashboard`.)

Quick orientation (full detail in those files):

- **Register:** product (the design serves the task, not the other way around).
- **North Star:** "The Quiet Coach" — calm through the training block, energy earned at the peaks
  (race week, race day, milestones).
- **Two-Orange Rule:** bright `#FC4C02` for large display + decoration only; `#CC4011` for small
  text and filled buttons (WCAG AA; bright orange fails at 3.4:1).
- **Color-Plus-Label Rule:** sport color never stands alone; every dot is paired with a text badge
  so the schedule reads in grayscale.
- **Anti-references:** not a generic SaaS dashboard, not a gamified fitness app, not cluttered data overload.
- **Accessibility:** WCAG 2.1 AA (4.5:1 text, visible focus, keyboard nav, `prefers-reduced-motion`).

## Verifying changes

Use the preview tooling (not raw `curl`/Bash) to run the dev server and check changes in the
browser. The dashboard opens to the Strava connect screen by default; to inspect the training
views without connecting, reveal `#training` and hide the `#strava-*` sections, or open the Plan
Builder via the "Edit Plan" nav link. `localStorage` persists across server restarts in the same
browser; clean up test plans (`jm_plan_v1`, `jm_ai_opt_v1`) when done.
