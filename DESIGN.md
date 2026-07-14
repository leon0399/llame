# Design System: llame

> A monochrome control room for an AI operating layer — quiet surfaces, ink-on-paper text, and a single restrained accent reserved for danger.

**Status:** Living document. Describes the design language as it exists in `packages/ui` (shared shadcn/ui kit) and `apps/web` today. The system is currently a **disciplined neutral minimalism** built on shadcn's `new-york` style with a `neutral` base — intentional restraint, not an unfinished theme. See [§12 Open Decisions](#12-open-decisions) for what is deliberately not yet decided.

---

## 0. How to use this file

This is the source-of-truth brief for anyone — human or AI coding agent — generating or restyling a llame screen. It captures the _why_ and the _feel_ in natural language, backed by exact tokens.

- **Building a new screen or component?** Read §1–§2 for the mood, then pull concrete values from §3–§9.
- **Prompting an AI agent (Claude, Cursor, etc.) to generate UI?** Paste §1–§2 and the relevant component section, then point it at the real primitives in `packages/ui/src/components`. The agent should _compose_ those primitives, not re-style them.
- **The authoritative token values live in `packages/ui/src/styles/globals.css`.** When this file and the CSS disagree, the CSS wins — update this file.
- Hex codes below are sRGB **approximations** of the authoritative **OKLCH** values; OKLCH is what ships.

---

## 1. Visual Theme & Atmosphere

llame looks like a well-lit, near-silent workshop. The interface is almost entirely **achromatic** — a grayscale stack from pure white through ash to near-black — so that the user's content (chats, knowledge, artifacts) is the only thing carrying color and weight. There is **no brand hue**, no gradient field, no decorative imagery. Separation between regions comes from subtle value shifts (white canvas against a faintly cooler off-white rail) and thin hairline borders, not from heavy shadows or chrome.

The mood is **calm, dense-but-uncluttered, and utilitarian**. Corners are softly rounded (10px), elevation is whisper-flat, and typography does most of the expressive work. The one chromatic note in the entire system is a saturated red reserved exclusively for destructive intent — its rarity is what makes it legible. Color is present in exactly two governed places: **data visualization** (the chart ramp) and **danger** (destructive). Everything else is ink and paper.

Full dark mode is a first-class peer, not an afterthought: the same semantic roles invert into a charcoal canvas with off-white ink.

**Adjectives:** monochrome · airy · disciplined · platform-native · quiet · content-first.

---

## 2. Color Palette & Roles

The palette is Tailwind's **neutral** ramp expressed in OKLCH, addressed through semantic CSS variables (never raw hex in components). Below, each role gets an evocative name, the authoritative OKLCH, an approximate hex, and its job.

### 2.1 Light mode (`:root`)

| Name       | OKLCH (authoritative)       | ~Hex      | Token(s)                              | Role                                                                                         |
| ---------- | --------------------------- | --------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Pure White | `oklch(1 0 0)`              | `#ffffff` | `--background`, `--card`, `--popover` | Main canvas, card and popover surfaces — where attention belongs                             |
| Bone       | `oklch(0.985 0 0)`          | `#fafafa` | `--sidebar`, `--primary-foreground`   | The slightly cooler off-white of the navigation rail; also text on dark fills                |
| Mist       | `oklch(0.97 0 0)`           | `#f5f5f5` | `--secondary`, `--muted`, `--accent`  | Quiet fills for secondary buttons, muted blocks, hover/active surfaces                       |
| Hairline   | `oklch(0.922 0 0)`          | `#e5e5e5` | `--border`, `--input`                 | The thin 1px lines that separate regions and outline inputs                                  |
| Pewter     | `oklch(0.708 0 0)`          | `#a1a1a1` | `--ring`                              | Focus ring base (rendered at ~50% opacity)                                                   |
| Slate      | `oklch(0.556 0 0)`          | `#737373` | `--muted-foreground`                  | Secondary/helper text, placeholders, captions, inactive icons                                |
| Ink        | `oklch(0.205 0 0)`          | `#171717` | `--primary`                           | Primary action fill, the strongest interactive surface in light mode                         |
| Near-Black | `oklch(0.145 0 0)`          | `#0a0a0a` | `--foreground`, `--card-foreground`   | Body text, headings, icons — the default ink                                                 |
| Alert Red  | `oklch(0.577 0.245 27.325)` | `#e7000b` | `--destructive`                       | The system's **only** standing chromatic color — destructive actions and invalid states only |

### 2.2 Dark mode (`.dark`)

Roles invert; the canvas becomes charcoal and ink becomes off-white. Key shifts:

| Token                                                       | OKLCH                        | ~Hex      | Role in dark                                                                     |
| ----------------------------------------------------------- | ---------------------------- | --------- | -------------------------------------------------------------------------------- |
| `--background`, `--card`, `--popover`                       | `oklch(0.145 0 0)`           | `#0a0a0a` | Charcoal canvas and surfaces                                                     |
| `--foreground`                                              | `oklch(0.985 0 0)`           | `#fafafa` | Off-white ink                                                                    |
| `--primary`                                                 | `oklch(0.985 0 0)`           | `#fafafa` | Primary fill is now near-white (with charcoal text)                              |
| `--secondary`, `--muted`, `--accent`, `--border`, `--input` | `oklch(0.269 0 0)`           | `#262626` | Graphite quiet surfaces and lines                                                |
| `--muted-foreground`, `--ring`                              | `oklch(0.708 0 0)` / `0.556` | `#a1a1a1` | Dimmed text and focus ring                                                       |
| `--destructive`                                             | `oklch(0.396 0.141 25.723)`  | `#82181a` | Deeper red fill; foreground brightens to `oklch(0.637 0.237 25.331)` ≈ `#fb2c36` |
| `--sidebar`                                                 | `oklch(0.205 0 0)`           | `#171717` | Rail sits one step above the charcoal canvas                                     |

### 2.3 Chart ramp — the sanctioned chromatic exception

`--chart-1` … `--chart-5` are the **only** place broad color is allowed, and only inside data visualization. They are a warm-to-cool spread (light: burnt orange, teal, deep slate-blue, gold, amber), retuned for contrast in dark mode (a blue/green/violet/rose spread). Do not borrow chart colors for UI accents, branding, or CTAs.

---

## 3. Typography

Typography is the system's primary expressive instrument — and it is **user-configurable by design**, an accessibility and personalization feature rather than a fixed brand face.

- **Two semantic faces:** `--font-sans` (UI + prose) and `--font-mono` (code, technical strings). Components only ever reference these two variables.
- **Resolution:** the active face is resolved at request time by the web appearance service (`apps/web/lib/appearance/font/service.ts` → `getFontCssVariables()`), which writes `--font-sans` / `--font-mono` into `:root`. `body` applies `font-sans antialiased`.
- **Defaults:** sans defaults to the **system stack** (`system-ui, -apple-system, …`) for instant, platform-native rendering; mono defaults to **JetBrains Mono**.
- **Selectable sans faces:** Geist, Open Sans, Roboto, Roboto Condensed, and **OpenDyslexic** (a genuine accessibility option — see §6). **Selectable mono faces:** Geist Mono, JetBrains Mono, Fira Code, Roboto Mono, OpenDyslexic Mono. All are loaded as `next/font` CSS variables in `apps/web/app/layout.tsx`.

### Weight & scale character

- **Weights stay conversational.** UI text is `font-medium` (500) for controls and labels, `font-semibold` (600) for card/section titles; body is regular. The system avoids display-weight boldness — emphasis comes from value contrast (Ink vs Slate) and weight ≤ 600, not heavy type.
- **Sizes follow shadcn defaults:** controls and body at `text-sm` (14px) on desktop, inputs at `text-base` (16px) on mobile collapsing to `text-sm` at `md` (prevents iOS zoom-on-focus); inline code and code blocks at ~13px mono.
- **Icons:** Lucide, default `size-4` (16px), inheriting `currentColor` so they read as text-weight ink.

---

## 4. Geometry & Shape

One radius scale, derived from a single `--radius: 0.625rem` (**10px**) root. Corners are **softly rounded, never pill-shaped, never sharp** — the system has no fully-square and no fully-round (`9999px`) elements in its primitives.

| Token         | Value                             | Feel                         | Used by                                   |
| ------------- | --------------------------------- | ---------------------------- | ----------------------------------------- |
| `--radius-sm` | `calc(--radius - 4px)` = **6px**  | Gently eased                 | Inline code (`rounded-sm`), small chips   |
| `--radius-md` | `calc(--radius - 2px)` = **8px**  | Subtly rounded               | Buttons, inputs, textareas (`rounded-md`) |
| `--radius-lg` | `--radius` = **10px**             | The system's signature curve | Default container radius                  |
| `--radius-xl` | `calc(--radius + 4px)` = **14px** | Generously rounded           | Cards and code blocks (`rounded-xl`)      |

---

## 5. Depth & Elevation

Elevation is **whisper-flat**. The system separates layers primarily through hairline borders and value shifts, with shadows used only as the faintest hint of lift.

- **Inputs, textareas, buttons:** `shadow-xs` — a barely-perceptible drop, almost flush with the surface.
- **Cards, code blocks:** `shadow-sm` + a 1px border — the heaviest elevation in the system, and still subtle.
- **Popovers, dialogs, dropdowns, sheets:** rely on the component primitives' own light shadow plus a border; never heavy, high-contrast drop shadows.
- **Region separation** (rail vs. canvas, header vs. content) is done with **borders and the Bone→White value shift**, not shadows.

Rule of thumb: if a surface needs to feel "above" another, add a **border first**, a `shadow-sm` second, and never reach past it.

---

## 6. Accessibility (first-class)

Accessibility is a design value here, not a remediation pass:

- **Dyslexia-friendly typography** is a shipped option — `OpenDyslexic` / `OpenDyslexic Mono` are wired into the font appearance system alongside the standard faces, switchable per user.
- **Visible, generous focus.** Interactive primitives use `focus-visible:ring-[3px]` with `--ring` at ~50% opacity plus a `border-ring` shift — a deliberately thick, unmissable focus indicator, not a hairline.
- **Validation is communicated, not just colored.** `aria-invalid` triggers a destructive ring + border (`aria-invalid:ring-destructive/20 dark:…/40 aria-invalid:border-destructive`), pairing the red with the ARIA state rather than relying on hue alone.
- **Full light/dark parity** via semantic tokens, so contrast holds in both modes.
- **Platform-native defaults** (system font stack, `antialiased`) keep text crisp and familiar before any customization.

---

## 7. Motion

Motion is **purposeful and sparse**, powered by `framer-motion` (imported as `motion/react`) and `tw-animate-css`:

- **`TextShimmer`** (`text-shimmer.tsx`) is the signature AI-state animation: a horizontal gradient sweeps across text on an infinite linear loop to signal "thinking"/streaming. Base color `#a1a1aa` light / `#71717a` dark with an ink/white highlight — monochrome, in keeping with the palette.
- **`transition-all` / `transition-[color,box-shadow]`** on controls give quiet hover and focus easing, not bouncy or attention-grabbing motion.
- Keep motion legible and short; reserve looping animation for genuine progress/streaming states.

---

## 8. Component Stylings

All values below are read from the real primitives in `packages/ui/src/components`. Compose these — do not re-skin them in app code.

### Buttons (`button.tsx`)

- **Shape & type:** `rounded-md` (8px), `text-sm font-medium`, `gap-2`, `shadow-xs`, `transition-all`.
- **Sizes:** `default` h-9 (`px-4`), `sm` h-8, `lg` h-10 (`px-6`), `icon` size-9. SVG icons auto-sized to `size-4`.
- **Variants:** `default` (Ink/`bg-primary` fill, Bone text) · `secondary` (Mist fill) · `outline` (border + transparent, `hover:bg-accent`) · `ghost` (no fill until `hover:bg-accent`) · `destructive` (Alert Red fill, white text) · `link` (underline-on-hover, no fill).
- **States:** focus → `ring-[3px]` + `border-ring`; disabled → `opacity-50`, no pointer events; invalid → destructive ring.

### Inputs & Textareas (`input.tsx`, `textarea.tsx`)

- **Stroke style:** 1px `border-input` hairline on a **transparent** background (light) / `bg-input/30` (dark) — outlined, not filled.
- **Shape:** `rounded-md` (8px), `shadow-xs`, `px-3`. Input `h-9`; textarea `min-h-16` with `field-sizing-content` (auto-grow).
- **Type:** `text-base` (mobile) → `text-sm` at `md`; placeholders in Slate (`text-muted-foreground`).
- **States:** focus → thick `ring-[3px]` + `border-ring`; `aria-invalid` → destructive ring + border; text selection uses `bg-primary`/`text-primary-foreground`.

### Cards (`card.tsx`)

- **Container:** `bg-card` surface, 1px border, `rounded-xl` (14px — the system's most generous curve), `shadow-sm`, vertical rhythm `py-6` + `gap-6`, horizontal padding `px-6`.
- **Anatomy:** `CardHeader` (grid, supports a right-aligned `CardAction`), `CardTitle` (`font-semibold`, tight leading), `CardDescription` (Slate, `text-sm`), `CardContent`, `CardFooter`.

### Code blocks & Markdown (`code-block.tsx`, `markdown.tsx`)

- **Code block:** `bg-card`, 1px `border-border`, `rounded-xl`, `overflow-clip`, code at `text-[13px]` with `px-4 py-4`. Syntax highlighting via **Shiki** (`github-light` theme default), with a plain-`<pre>` SSR fallback before hydration.
- **Markdown renderer:** `react-markdown` + `remark-gfm` + `remark-breaks`, parsed block-by-block and memoized for streaming performance. Inline code renders on a `bg-primary-foreground` chip, `rounded-sm` (6px), `font-mono text-sm`; fenced blocks route into the Code block component.

### Sidebar / Navigation (`sidebar.tsx`)

- **Surface:** dedicated `--sidebar` token family (rail sits on Bone in light, one step above charcoal in dark) with `--sidebar-border` hairlines and `--sidebar-accent` hover/active fills.
- **Dimensions:** `16rem` (256px) expanded, collapses to `3rem` (48px) icon-rail, `18rem` on mobile (off-canvas sheet).
- **Active/hover state** is a background fill shift (`hover:bg-sidebar-accent`), not a colored left-border or accent bar — consistent with the no-chrome philosophy.

### Overlays

Dialog, Popover, Dropdown menu, Sheet, Tooltip, Command (⌘K palette), Sonner (toasts) — all use the `--popover` surface, hairline borders, the shared radius scale, and the kit's light shadow. Keep overlays on these primitives rather than hand-rolling.

---

## 9. Layout Principles

- **Two-zone shell:** a persistent left rail (navigation, account) against a wide content stage, separated by value + border, not shadow.
- **Whitespace is structural.** Lean on the card's `gap-6`/`py-6` rhythm and generous container padding; let negative space, not dividers, group content.
- **Content-first centering.** Give primary reading/chat columns room to breathe; the canvas is a stage, the UI a frame.
- **Density is compact but never cramped** — controls cluster at `gap-2`, sections breathe at `gap-6`.
- **Responsive type guard:** inputs render at 16px on mobile to avoid iOS zoom, tightening to 14px on desktop.

---

## 10. Guidelines — Do

- Use the **semantic tokens** (`bg-primary`, `text-muted-foreground`, `border-input`, …) — never raw hex or one-off OKLCH in components.
- Keep the interface **achromatic**; let user content and the chart ramp carry color.
- Reserve **Alert Red strictly for destructive actions and invalid states** — its scarcity is its signal.
- Stay on the **10px-derived radius scale**: `rounded-md` for controls, `rounded-xl` for cards/code.
- Separate regions with **borders and value shifts first**, a faint `shadow-sm` at most.
- Cap weight at **600**; create emphasis through Ink↔Slate value contrast, not heavy type.
- Compose the **existing `@workspace/ui` primitives**; add variants via `cva`, not by re-skinning.
- Honor the **font appearance system** — reference `--font-sans` / `--font-mono`, never hardcode a face.
- Give every interactive element a **visible `ring-[3px]` focus state**.

## 10b. Guidelines — Don't

- **Don't introduce a brand hue, gradient, or accent color** — monochrome is the signature, not a gap to fill (until §12 is resolved deliberately).
- **Don't use heavy or high-contrast drop shadows** for elevation.
- **Don't use pill (`rounded-full`) or sharp (`rounded-none`) shapes** for buttons, inputs, or containers.
- **Don't repurpose chart colors** (`--chart-*`) as UI accents or branding.
- **Don't reach for display weights (700–900)** in UI chrome.
- **Don't hardcode font families** or bypass the appearance service.
- **Don't communicate validity by color alone** — pair it with `aria-invalid` state.
- **Don't fork generated shadcn primitives** casually; prefer composition (see `packages/ui/CLAUDE.md`).

---

## 11. Token Reference (quick map)

| Concern                    | Source of truth                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Colors, radius, theme      | `packages/ui/src/styles/globals.css` (`:root`, `.dark`, `@theme inline`)                       |
| shadcn config              | `packages/ui/components.json` (`style: new-york`, `baseColor: neutral`, `iconLibrary: lucide`) |
| Component primitives       | `packages/ui/src/components/*`                                                                 |
| Font loading               | `apps/web/app/layout.tsx`                                                                      |
| Font resolution / defaults | `apps/web/lib/appearance/font/{consts,service}.ts`                                             |

---

## 12. Open Decisions

These are **intentionally undecided**, flagged so they're chosen deliberately rather than by drift:

1. **No brand/primary hue.** Today "primary" is Ink (near-black). Whether llame ever adopts a chromatic brand accent — and where it would be allowed without breaking the monochrome discipline — is an open product/brand decision, not an oversight.
2. **Stock-shadcn baseline.** The token set is essentially shadcn's `new-york`/`neutral` defaults. That's a fast, coherent starting point; any move toward a more bespoke identity (custom ramp, custom radius, motion language) should be a conscious step documented here.
3. **Density profile.** The kit ships shadcn's default sizing. A denser "pro" mode (smaller controls, tighter rhythm) for power-user surfaces is unexplored.

When any of these is decided, update this file in the same change.
