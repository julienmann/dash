---
name: Training Dashboard
description: A Strava-connected endurance training planner for runners and triathletes
colors:
  strava-orange: "#FC4C02"
  action-orange: "#CC4011"
  ink: "#242428"
  slate-mid: "#6D6D6D"
  surface: "#FFFFFF"
  canvas: "#F5F5F5"
  hairline: "#E8E8E8"
  swim-cyan: "#00B4D8"
  bike-blue: "#4A90D9"
  brick-violet: "#8B5CF6"
  rest-gray: "#9CA3AF"
  success-green: "#27AE60"
  alert-red: "#C0392B"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "7rem"
    fontWeight: 800
    lineHeight: 0.85
    letterSpacing: "-0.05em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "2.8rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.1em"
rounded:
  chip: "3px"
  control: "5px"
  button: "6px"
  panel: "8px"
  card: "10px"
  pill: "99px"
spacing:
  xs: "0.3rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1.25rem"
  xl: "1.5rem"
  xxl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.action-orange}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "0.68rem 1.2rem"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0.62rem 1.2rem"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate-mid}"
    rounded: "{rounded.button}"
    padding: "0.62rem 0.4rem"
  add-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.action-orange}"
    rounded: "{rounded.panel}"
    padding: "0.55rem 0.8rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "0.52rem 0.72rem"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "1.25rem"
  phase-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "1rem"
  nav-link:
    textColor: "{colors.slate-mid}"
    rounded: "{rounded.control}"
    padding: "0.28rem 0.6rem"
  sport-badge:
    rounded: "{rounded.chip}"
    padding: "0.16em 0.48em"
---

# Design System: Training Dashboard

## 1. Overview

**Creative North Star: "The Quiet Coach"**

This is the interface of a coach who is steady at every Tuesday session and genuinely fired up on the start line. For the long middle of a training block it stays calm and out of the way: a light, uncluttered surface that answers one question first, "what do I do today?", then lets the athlete close the tab and go train. The intensity is held in reserve. It rises for the moments that earn it, race week, race day, a milestone hit, expressed through scale and the bright brand orange rather than through constant decoration.

Underneath the calm is real substance. The plan reacts to actual Strava performance, so the numbers shown are honest (real paces, real heart rate, real adherence) and never dressed up as vanity progress. One code path carries a 5K runner and a full Ironman alike; the surface adapts to whichever sports a plan actually contains rather than assuming triathlon.

The system explicitly rejects three looks. It is not a generic SaaS dashboard (no identical KPI card grids, no big-number hero-metric template, no purple gradients). It is not a gamified fitness app (no badges, confetti, or streak guilt). And it refuses data overload (no wall of competing charts). Warmth is allowed; sterility is the thing to avoid, not personality.

**Key Characteristics:**
- Light theme, near-white surfaces on a soft gray canvas, generous breathing room.
- A single committed accent (Strava orange) that means status and action, never decoration.
- Sport-coded but never color-only: every colored dot is backed by a text badge.
- Restrained motion: state feedback, not choreography.
- Day-first hierarchy: today's session and progress to race day lead every screen.

## 2. Colors

A restrained palette: tinted-neutral surfaces carry the interface, one committed orange carries identity and action, and a small fixed set of sport hues encode discipline in the calendar.

### Primary
- **Strava Orange** (#FC4C02): the brand voice. Reserved for large display and decorative moments, the giant race countdown number, the run sport-dot, the today/race-day highlight ring, progress fills. Bright by design; it is the energy held in reserve.
- **Action Orange** (#CC4011): the working accent. A deliberately deepened orange used for all small interactive text and filled buttons so it clears WCAG AA (4.87:1 on white) where the bright orange (3.4:1) cannot. Primary buttons, links, the nav countdown label, action labels.

### Secondary (sport coding)
- **Swim Cyan** (#00B4D8): swim sessions in the calendar, week strip, and session badges.
- **Bike Blue** (#4A90D9): bike sessions.
- **Brick Violet** (#8B5CF6): brick (bike-to-run) sessions.
- **Rest Gray** (#9CA3AF): rest days. (Run uses Strava Orange; race uses Strava Orange.)

### Neutral
- **Ink** (#242428): primary text. A near-black tinted slightly warm, never pure #000.
- **Slate Mid** (#6D6D6D): secondary text, labels, eyebrows, inactive nav.
- **Surface** (#FFFFFF): cards, panels, inputs, sticky nav.
- **Canvas** (#F5F5F5): the page background the white surfaces sit on.
- **Hairline** (#E8E8E8): borders, dividers, input strokes, the dashed "add" outline.

### Tertiary (semantic state)
- **Success Green** (#27AE60): positive adherence and on-track signals.
- **Alert Red** (#C0392B): validation errors, destructive-action hover (Reset, Remove).

### Named Rules
**The Two-Orange Rule.** Bright #FC4C02 is for large display and decoration only (text 24px+ bold, dots, fills, rings). Anything smaller or interactive uses #CC4011. If orange text is below large size on white and it is the bright value, it is a contrast bug.

**The Color-Plus-Label Rule.** Sport color never carries meaning alone. Every colored dot or fill is paired with a text badge (SWIM, RUN, BIKE, BRICK, REST). The schedule must read correctly in grayscale.

## 3. Typography

**Display / Body / Label Font:** Inter (with `-apple-system, BlinkMacSystemFont, sans-serif` fallback).

**Character:** One tuned sans does everything. This is deliberate for a product surface: a single well-weighted family carries headings, data, labels, and body without the noise of a display-and-body pairing. Personality comes from weight and scale contrast, not from a second face.

### Hierarchy
- **Display** (800, 7rem, 0.85 line-height, -0.05em): the race countdown number only. The single biggest moment on the surface, the embodiment of earned energy.
- **Headline** (800, 2.8rem, 1, -0.03em): the active session duration and the sport badge on the hero card. Big, confident, tight.
- **Title** (800, 1.05rem): page and section titles ("Edit Training Plan"). Card titles step down to ~0.83rem at weight 700.
- **Body** (400, 0.86rem, 1.5): form inputs, descriptions, schedule labels. Base document size is 14px. Keep prose to 65 to 75 characters per line.
- **Label** (700, ~0.6 to 0.7rem, uppercase, 0.08 to 0.12em tracking): section eyebrows, day-of-week headers, sport badges. The quiet structural type that organizes without shouting.

### Named Rules
**The One-Family Rule.** Inter (or the system stack) for everything. Do not introduce a display or serif face. Hierarchy is earned through weight (400 / 600 / 700 / 800) and a wide scale jump, not through a second font.

## 4. Elevation

A mostly flat system. Surfaces are distinguished by their fill (white on gray canvas) and hairline borders first; shadow is a soft, ambient lift, not a structural device. There is no deep, layered, draggable-window depth here. Two shadow steps, used sparingly.

### Shadow Vocabulary
- **Resting card** (`box-shadow: 0 1px 3px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.04)`): the default for cards and panels. Barely-there separation from the canvas.
- **Lifted** (`box-shadow: 0 4px 16px rgba(0,0,0,.08)`): reserved for elements that rise above the page (popovers, the expanded activity detail). Use rarely.

### Named Rules
**The Hairline-First Rule.** Reach for a 1px (or 1.5px) `hairline` border before a shadow. Structure (phase cards, inputs, table rows, dividers) is drawn with strokes; shadow is only an ambient lift on true surfaces. Never stack both heavily on the same element.

## 5. Components

### Buttons
- **Shape:** softly rounded (6px `button` radius). Pills (99px) are reserved for toggle controls (period and sport tabs).
- **Primary:** filled Action Orange (#CC4011) with white text, weight 700, ~0.68rem vertical padding. Used for the single committed action on a surface (Connect with Strava, Save and apply). Hover lowers opacity to ~0.88.
- **Secondary:** white fill, 1.5px hairline border, ink text. Hover darkens the border toward ink. The neutral choice for Cancel and parallel actions.
- **Ghost:** no fill or border, Slate Mid text. Reserved for low-stakes or destructive-adjacent actions (Reset to default), whose text shifts to Alert Red on hover.
- **Add vs Start (affordance split):** a full-width outlined block button. **Dashed** hairline border means "add an item" (+ Add Phase, + Add Race Event). **Solid** border (the `builder-cta-btn` modifier) means "start a flow" (Load preset, Start AI questionnaire). The border style is the signal; do not blur the two.

### Tabs / Toggles (chips)
- **Style:** pill-shaped (99px), hairline border at rest. Active state fills with Action Orange and white text.
- **Use:** period selectors (Week / Month / Year to date) and Strava sport filters.

### Cards / Containers
- **Corner Style:** 10px (`card`) for top-level cards; 8px (`panel`) for nested phase and event cards.
- **Background:** white Surface on the gray Canvas.
- **Shadow Strategy:** Resting card shadow only (see Elevation). Nested phase cards use a hairline border and no shadow.
- **Border:** none on top-level cards (shadow does the lift); 1.5px hairline on nested panels.
- **Internal Padding:** 1.25rem (`lg`) for cards, 1rem for nested panels. Never let text sit flush against a bordered edge.

### Inputs / Fields
- **Style:** white fill, 1.5px hairline border, 6px radius, ~0.52rem by 0.72rem padding, 0.86rem text.
- **Focus:** border shifts to the accent (currently bright orange; Action Orange is acceptable too). Always visible, never removed.
- **Labels:** every field has a visible label above it (not placeholder-only). Required and error states use Alert Red with the message near the field.

### Navigation
- **Style:** sticky top bar, white surface, hairline bottom border, 48px tall. Links are Slate Mid at ~0.75rem; hover adds a soft canvas background and shifts to ink. The race countdown sits at the right in Action Orange, weight 700, present on every screen.

### Calendar Day (signature component)
The heart of the daily view. A compact day cell carrying a sport dot plus an uppercase sport badge, with a hover tooltip for session detail. Today and race day get a 2px orange outline ring (offset inward). This is where the Color-Plus-Label Rule is enforced most strictly.

## 6. Do's and Don'ts

### Do:
- **Do** use Action Orange (#CC4011) for any orange text under large size and for all filled buttons. It clears AA at 4.87:1; bright #FC4C02 does not (3.4:1).
- **Do** reserve bright Strava Orange (#FC4C02) for large display (the countdown), sport dots, fills, and the today/race-day ring.
- **Do** pair every sport color with a text badge so the schedule reads in grayscale.
- **Do** lead each screen with today's session and progress to race day; reach deeper data on purpose.
- **Do** draw structure with hairline borders first, shadow only as an ambient lift.
- **Do** keep one font family (Inter / system) and build hierarchy from weight and scale.
- **Do** hold visible keyboard focus on every interactive element and honor `prefers-reduced-motion`.

### Don't:
- **Don't** build a generic SaaS dashboard: no identical KPI card grids, no big-number-plus-label hero-metric template, no purple gradients.
- **Don't** gamify: no badges, confetti, streak guilt, or aggressive nudges. Motivation is the real race, not points.
- **Don't** overload with data: no wall of competing charts, no showing every metric at once.
- **Don't** use `background-clip: text` gradient text, or any gradient as a decorative accent.
- **Don't** use a colored `border-left` or `border-right` stripe as an accent; use a full border, a background tint, or a leading badge.
- **Don't** spend the bright orange on decoration that is not a real status or milestone; its rarity is what gives race day its weight.
- **Don't** animate layout properties or add choreographed page-load sequences; motion is state feedback only.
