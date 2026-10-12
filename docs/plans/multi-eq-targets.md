# Plan: Multiple EQ targets

Status: idea / direction (not scheduled work)  
Audience: product, engineering, and marketing/landing-page agents  
Related product: [One Curve](../../README.md) (repo: one-curve-eq)

## Why this exists

One Curve today is built around **TDR Nova** (free) Copy State / Paste State, with **Nova GE** already recognized on paste. The collapsing use case — sum a stack of EQ instances, then Match back to fewer instances — also applies to other EQs people actually use, especially:

- **TDR Nova GE** (same family, more bands)
- **Logic Pro Channel EQ** (fixed layout: roughly 4 bells, 2 shelves, HP, LP)

This document records the intended product and architecture direction so landing-page work and future tool work stay aligned.

## Decision (summary)

**Ship each major EQ family as its own product surface on its own URL.**  
Do **not** put a live plugin toggle/dropdown inside one shared Match UI.

- Marketing / landing chooses the target and deep-links into a tool.
- Each tool’s UI should **resemble the plugin it targets** (band layout, language, copy/paste flow).
- Share the **workflow and infrastructure** under the hood; do not force one band-row layout to serve every plugin.

## Product model

### One Curve (brand)

The brand is the collapsing workflow: **Chain** (paste / sum instances) → **Match** (shape fewer instances against the sum) → copy back into the real plugin.

The brand is not “a Nova clone.” Nova is the first **target**.

### Targets

| Target | Relationship | Product surface |
|--------|----------------|-----------------|
| TDR Nova (free) | Current | Primary tool today |
| TDR Nova GE | Same family as Nova | Stay on the **Nova** tool; auto-detect from paste; Match with more bands is an upgrade of that tool, not a second product |
| Logic Pro Channel EQ | Different layout, paste path, constraints | **Separate** route and Match UI that mirrors Channel EQ |
| Other EQs later | Case by case | Prefer new routes when topology or I/O differs enough that a shared band editor would fight the plugin |

### Routing (intent)

Exact paths can change; the shape should not:

- `/` — marketing / landing (what One Curve is, who it’s for, CTAs into tools)
- `/nova` — Nova (+ GE) tool (current app, possibly moved off root when landing ships)
- `/logic` (or `/channel-eq`) — Logic Channel EQ tool, when built

Deep links matter: users bookmark and share the tool for *their* plugin. Paths beat query params or a session toggle.

### What not to do

- **No in-app “switch plugin” control** that rewires band slots, paste format, and Match budget mid-session.
- **No mixed chains** of Nova states and Logic bands in one Match session.
- **No single chameleon UI** that tries to look like every EQ at once.

A small header link like “Other EQs” that **navigates** to the landing or another tool is fine. That is navigation, not a live mode toggle.

## What to share vs specialize

### Share once (shell / engine)

- Magnitude graph, dB sum across instances, scale (±12 / ±24)
- Chain list UX: mute, solo, rename, reorder, clear
- Match *workflow*: freeze chain sum as reference, edit nodes, preview/eye, fit error if kept
- Knobs, persistence patterns (per-target storage keys so sessions do not collide)
- Branding chrome used by landing + tools

### Specialize per target (adapters)

- Parse / serialize (or manual entry) for that plugin’s state format
- Band topology and Match editor layout (Nova’s 4 parametric slots vs Logic’s fixed roles)
- Magnitude model quirks (e.g. Nova’s parallel bell/shelf join behavior)
- Copy language, warnings, limits, example presets
- Visual emulation of the plugin enough that paste-back feels obvious

Engineering shape when the second target starts: thin **EQ target** boundary (`parse` / `serialize` / `responseDb` / `matchSlots`) plus separate UI entry points — not three unrelated apps, and not one mega-toggle.

## Marketing / landing implications

Landing-page agents should treat this as product truth:

1. **Lead with the problem and workflow**, then name the current target (TDR Nova).
2. **CTA into the Nova tool** is the primary action today (open app / try Chain / try Match).
3. **Do not imply a plugin picker inside the app** or a universal “works with any EQ” editor.
4. It is fine to **tease** “more EQ targets” (especially Logic Channel EQ) as future / coming, as long as it is clearly not shipping yet.
5. When a second tool exists, the landing becomes a **chooser**: one composition, brand first, then clear paths into `/nova` vs `/logic` — not a dashboard of features.
6. Keep disclaimer tone from the README: independent project; not affiliated with Tokyo Dawn Records (or Apple / Logic when that target exists).

Suggested mental model for copy:

- *One Curve helps you collapse a stack of EQ instances into one curve you can see and Match back into fewer instances.*
- *Built first for TDR Nova Copy State.*
- *Same idea for other EQs later — each with a layout that matches that plugin.*

## Rollout sketch

1. Keep shipping and polishing the **Nova** tool; land people there from marketing.
2. When landing ships, prefer **root = marketing**, **tool = `/nova`** (redirect from old bookmarks if needed).
3. Before Logic work: extract only as much shared shell as needed — avoid a big rewrite first.
4. Ship Logic as its own route with its **own persistence key**.
5. Expand Nova GE Match band count on the Nova tool when that matters more than a new target.

## Open questions (not blockers)

- Exact URL names and whether Nova stays at root until landing is ready
- Logic input path: real state paste vs manual band entry first
- How closely Match UI should visually mimic each plugin vs stay in One Curve’s visual system
- Whether Nova GE needs a distinct landing CTA or only in-tool detection / badge

## Related files today

- App shell and Nova-centric UI: `src/main.ts`
- Nova parse / serialize / magnitude: `src/nova/`
- Match slots (four bands per instance): `src/match.ts`
- Product description: `README.md`
