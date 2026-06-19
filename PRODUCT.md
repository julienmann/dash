# Product

## Register

product

## Users

Endurance athletes training for a specific race: runners (5K through 50K ultra) and triathletes (sprint through full Ironman). They range from first-season beginners to multi-season competitors. The defining context is recurring, in-the-moment use: an athlete checks the dashboard in the morning before a session, or in the evening after logging one, to answer "what am I doing today, and am I on track?" They arrive with a real goal and a real calendar, not to browse. Many connect Strava so the plan reacts to what they actually did.

It is self-serve: anyone can land on it, pick or generate a plan, and start training. No accounts, no team, no shared data. Each browser holds its own plan in local storage.

## Product Purpose

A training plan that lives with the athlete from "I signed up for a race" to race day. Three ways in: pick a ready-made preset for a common distance, generate a custom periodized plan with AI from a short questionnaire, or build one by hand. Once a plan exists, the dashboard renders the day-by-day schedule, tracks phase and week progress toward race day, and (with Strava connected) adapts upcoming sessions to actual performance and missed workouts.

Success is the athlete trusting it enough to open it daily and act on what it says, without second-guessing the plan or fighting the interface. The plan should feel personal and credible, not generic.

## Brand Personality

A credible coach, not a hype app and not a spreadsheet. Three words: confident, athletic, grounded.

The voice is calm and direct day to day. It tells you today's session plainly and gets out of the way. The substance underneath is data-honest: real paces, real heart rate, real adherence, surfaced without spin. Energy is earned, not constant. The interface stays quiet through the long training block and lets intensity rise at the moments that warrant it (race week, race day, a milestone hit). Think of a coach who is steady at every Tuesday session and genuinely fired up on the start line.

## Anti-references

- **Generic SaaS dashboard.** No identical KPI card grids, no hero-metric template (big number + label + gradient accent), no purple gradients, no cookie-cutter admin-panel look.
- **Gamified fitness app.** No badges, confetti, streak guilt, aggressive nudges, or loud motivational gimmickry. Motivation comes from real progress toward a real race, not points.
- **Cluttered data overload.** No wall-of-charts where every metric competes for attention. Resist showing everything at once. The day's session and progress to race day lead; deeper data is available, not forced.

(Corporate or clinical sterility is acceptable to avoid: the tone may stay warm and athlete-native.)

## Design Principles

- **Today over everything.** The first question the interface answers is "what do I do today?" Planning, configuration, and history are secondary surfaces, reached on purpose, never in the way of the daily answer.
- **Earned energy (peak-end).** Calm and restrained through the training block; visual intensity is reserved for the moments that deserve it (race week, race day, a milestone). A confetti-on-every-screen app trains the athlete to ignore it.
- **Honest signals.** The plan reflects what actually happened. Real paces, real heart rate, real adherence. Never fake progress, never a vanity metric. When Strava data says ease off, the plan eases off.
- **One plan, any distance.** A 5K runner and an Ironman triathlete get the same coherent experience through one code path. The interface adapts to the sports a plan actually contains rather than assuming triathlon.
- **Show the plan, hide the machinery.** Progressive disclosure. The schedule is simple on the surface; the builder, AI questionnaire, and per-phase templates reveal complexity only when the athlete asks for it.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Body and UI text meets 4.5:1 contrast (large display text at least 3:1). Every interactive element has a visible keyboard focus indicator and is reachable by keyboard. Motion respects `prefers-reduced-motion`. Sport coding in the calendar must not rely on color alone; dots are paired with labels and badges so the schedule is legible without color discrimination.
