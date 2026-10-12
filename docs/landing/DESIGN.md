---
name: Obsidian Wave
colors:
  surface: '#121318'
  surface-dim: '#121318'
  surface-bright: '#38393f'
  surface-container-lowest: '#0d0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#292a2f'
  surface-container-highest: '#34343a'
  on-surface: '#e3e1e9'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e3e1e9'
  inverse-on-surface: '#2f3036'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#fff3f5'
  on-tertiary: '#640037'
  tertiary-container: '#ffccdb'
  on-tertiary-container: '#b9006a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#ffd9e3'
  tertiary-fixed-dim: '#ffb0cb'
  on-tertiary-fixed: '#3e0020'
  on-tertiary-fixed-variant: '#8d004f'
  background: '#121318'
  on-background: '#e3e1e9'
  surface-variant: '#34343a'
typography:
  display-hero:
    fontFamily: Space Grotesk
    fontSize: 64px
    fontWeight: '600'
    lineHeight: 72px
    letterSpacing: -0.03em
  display-hero-mobile:
    fontFamily: Space Grotesk
    fontSize: 38px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '500'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-mono:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.06em
  badge-caps:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 1rem
  margin: 3rem
  margin-mobile: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system establishes a futuristic, high-precision identity for modern generative and algorithmic audio engineering. Grounded in high-contrast dark space aesthetics, it replaces utilitarian industrial tropes with chromatic energy, polished glass surfaces, and atmospheric lighting reminiscent of next-generation developer and creator tooling.

The visual style blends **Minimalism** with **Glassmorphism** and radiant atmospheric lighting:
- **Atmospheric Canvas:** Deep midnight obsidian backdrop layered with a subtle technical dot matrix grid pattern and luminous ambient auroras.
- **Dynamic Chromatic Accents:** Vibrant laser-sharp tones—cyan, electric violet, neon magenta, and vivid amber—convey signal clarity, spectral frequencies, and computational power.
- **Glassmorphism Prompt Containers:** Deep translucent slate cards with hairline borders (`1px` with low opacity) and frosted backdrop blur.
- **Editorial Centered Symmetry:** Balanced, centered hero layouts, crisp typography, and restrained copy blocks that let the core prompt interfaces and audio waveform visualizations command focus.

## Colors

The palette operates in strict dark mode, anchored by deep pitch-black and midnight slate neutrals, illuminated by spectrum-grade neon accents:

- **Canvas & Backgrounds:**
  - `Canvas Base`: `#06070A` (Deepest pitch black)
  - `Surface Glass Base`: `#0E1017` with `rgba(14, 16, 23, 0.72)` alpha for floating glass elements
  - `Surface Elevated / Hover`: `#171924`
- **Spectral Accent Tones:**
  - `Primary (Electric Cyan)`: `#00F0FF` — Key audio waveforms, active state pills, focus rings, primary highlights.
  - `Secondary (Vivid Violet)`: `#8B5CF6` — Aura gradients, generative state indicators, spectral frequency mids.
  - `Tertiary (Neon Magenta)`: `#FF3399` — High-energy peaks, dynamic parameter tags, accent glows.
  - `Quaternary / Alert (Electric Amber)`: `#FFB800` — Transient audio warnings, beta indicators, gain ceilings.
- **Text & Contrast Hierarchy:**
  - `Text High Contrast (Primary)`: `#FFFFFF`
  - `Text Muted (Secondary)`: `#949BA8`
  - `Text Subdued (Tertiary)`: `#4B5162`
  - `Hairline Border Glass`: `rgba(255, 255, 255, 0.12)`

## Typography

The type system balances technical precision and human-scale clarity using three coordinated families:

- **Headlines (`Space Grotesk`):** Engineered, modern, and punchy. Used for hero announcements, section titles, and modal headers. Rendered with tight negative letter tracking (`-0.02em` to `-0.03em`) for punchy editorial presence.
- **Body (`Inter`):** Clean, neutral, high-legibility geometric sans-serif tuned for dark interfaces. Provides effortless readability across prompt fields, descriptions, and feature lists.
- **Labels & Values (`Space Mono`):** Monospaced glyphs dedicated to sample rates, decibel levels, parameter tags, token counters, and status badges.

## Layout & Spacing

The layout model is anchored by a centered 12-column responsive grid container with a maximum width of `1240px`.

- **Grid Alignment & Margins:**
  - Desktop: 12 columns, `1.5rem` (`24px`) gutters, `3rem` (`48px`) outer margin.
  - Tablet (≤ `1024px`): 8 columns, `1.25rem` (`20px`) gutters, `2rem` (`32px`) margin.
  - Mobile (≤ `640px`): 4 columns, `1rem` (`16px`) gutters, `1.25rem` (`20px`) margin.
- **Hero & Command Area:**
  - Strictly centered vertical stack: Top navigation with pill action buttons, centered headline, concise single-sentence subtext, and an expanded floating prompt module spanning 8-10 columns on desktop and 100% width on mobile.
- **Matrix Dot Grid Backdrop:**
  - Ambient canvas displays a radial-masked `24px x 24px` dot grid pattern rendered in `rgba(255, 255, 255, 0.08)`.

## Elevation & Depth

Visual hierarchy relies on blurred translucent planes, spectral under-glows, and hairline borders rather than traditional drop shadows:

- **Level 0 (Canvas):** Pure `#06070A` obsidian with subtle dot-matrix pattern and smooth atmospheric gradients (cyan-to-violet linear/radial bleeds).
- **Level 1 (Panels & Sub-cards):** `rgba(18, 20, 29, 0.65)` background with `backdrop-filter: blur(16px)` and a crisp `1px` border of `rgba(255, 255, 255, 0.08)`.
- **Level 2 (Interactive Floating Prompt / Hero Capsule):** `rgba(20, 22, 34, 0.78)` background, `backdrop-filter: blur(28px)`, a top hairline border of `rgba(255, 255, 255, 0.18)`, and a diffuse outer ambient glow: `0 24px 64px -12px rgba(139, 92, 246, 0.16), 0 0 1px 1px rgba(255, 255, 255, 0.1)`.
- **Level 3 (Popovers & Menus):** Solid surface `#161822`, `1px` border of `rgba(255, 255, 255, 0.14)`, and a sharp shadow `0 16px 36px rgba(0, 0, 0, 0.6)`.

## Shapes

The design uses a pill-forward and curved-container shape philosophy (`roundedness: 3`):

- **Prompt Shells & Hero Cards:** Contoured outer corners with `24px` to `32px` border radius (`rounded-xl` to `rounded-2xl`), delivering a polished, modern console silhouette.
- **Buttons & Mode Pills:** Fully rounded pill radius (`9999px` / `rounded-full`) for high-contrast action triggers, filter chips, and segmented controls.
- **Internal Micro-controls & Badges:** `8px` (`rounded-sm`) to `12px` (`rounded-md`) corner radii to maintain tight visual rhythm inside floating prompt containers.

## Components

### Buttons
- **Primary Action (High-Contrast White):** Solid `#FFFFFF` surface with `#06070A` text, pill radius (`9999px`), `font-medium`, and `14px` size. On hover: slight scale (`1.02`) and soft white bloom.
- **Glass / Ghost Action:** Translucent `rgba(255, 255, 255, 0.08)` surface, white text, hairline `rgba(255, 255, 255, 0.15)` border. On hover: `rgba(255, 255, 255, 0.14)`.
- **Spectral Accent Trigger (Submit / Play):** Electric cyan or neon violet icon button with subtle outer glow (`0 0 16px rgba(0, 240, 255, 0.4)`).

### Prompt Console Container
- Central hero input component composed of a generous multi-row textarea wrapped in a glassmorphic container (`backdrop-blur(24px)`).
- Interior lower bar hosts a flexible toolbar containing:
  - Add / context icon button (`+`).
  - Segmented pills (`App`, `Web`, or Audio modes like `Master`, `Stem`, `EQ`).
  - Style/flavor selector with dropdown indicator (`Balanced`, `Aggressive`, `Analog`).
  - Send/generate action pill aligned to the far right.

### Chips & Segmented Selectors
- Dark capsule containers (`rgba(255, 255, 255, 0.06)`) containing pill-shaped toggle options.
- Active option switches to solid `rgba(255, 255, 255, 0.16)` or neon cyan glow ring with high-contrast text and a preceding micro-icon.

### Input Fields & Textareas
- Seamless borderless backgrounds inside the glass container.
- Placeholder text in `#949BA8` at `18px` to `20px` font size.
- Zero native chrome, auto-expanding height, with active focus state reflected only on the perimeter rim of the parent capsule container.

### Status Badges & Pills
- Monospaced or uppercase micro-pills (`BETA`, `PRO`, `96kHz`) styled with a hairline border (`rgba(255, 255, 255, 0.2)`), black background, and subtle letter spacing (`0.08em`).