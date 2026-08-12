# Designing with llame

llame is a self-hosted, personal-first AI assistant platform. Its interface looks like a
well-lit, near-silent workshop: the user's own content — chats, knowledge, artifacts — is the
only thing in the frame allowed to carry color and weight.

Every component in this system is the real, shipping React source from the llame repo
(`packages/ui`), compiled as-is. Designs built from these parts map 1:1 onto code that ships.

## The one rule that shapes everything else

**The system is achromatic.** A grayscale stack from pure white through ash to near-black, with
**no brand hue**, no gradient field, and no decorative imagery. Color appears in exactly two
governed places:

1. **Destructive intent** — a single saturated Alert Red, reserved strictly for destructive
   actions and invalid states. Its scarcity is the entire signal; spending it anywhere else
   destroys it.
2. **Data visualization** — the `--chart-*` ramp, which is never repurposed as a UI accent.

If a design feels like it needs an accent color, it needs better value contrast or more
whitespace instead. Monochrome is the signature, not a gap to fill.

Dark mode is a first-class peer, not an afterthought — the same semantic roles invert onto a
charcoal canvas with off-white ink (`class="dark"`). Design both.

**Adjectives to design toward:** monochrome · airy · disciplined · platform-native · quiet ·
content-first.

## Do

- Use the **semantic tokens** (`bg-primary`, `text-muted-foreground`, `border-input`, …). Never a
  raw hex or a one-off OKLCH value.
- Stay on the **10px-derived radius scale** — `rounded-md` for controls, `rounded-xl` for cards
  and code. The system has no fully-square and no pill-shaped primitives.
- Separate regions with **borders and value shifts first**; a faint `shadow-sm` at most.
  Elevation is whisper-flat.
- Cap font weight at **600**. Emphasis comes from Ink↔Slate value contrast, not heavy type.
- Reference **`--font-sans` / `--font-mono`** only. Type is user-configurable by design (an
  accessibility feature — OpenDyslexic is a selectable face), so a hardcoded family breaks a real
  user setting.
- Give every interactive element a **visible `ring-[3px]` focus state**.
- Let **whitespace do the grouping**: controls cluster at `gap-2`, sections breathe at `gap-6`,
  cards carry a `gap-6`/`py-6` rhythm. Reach for negative space before a divider.
- **Compose the existing primitives.** Add variants through `cva`; don't re-skin.
- Icons are **Lucide at `size-4`**, inheriting `currentColor` so they read as text-weight ink.

## Don't

- Don't introduce a brand hue, gradient, or accent color.
- Don't use heavy or high-contrast drop shadows for elevation.
- Don't use pill (`rounded-full`) or sharp (`rounded-none`) shapes for buttons, inputs, or
  containers.
- Don't repurpose `--chart-*` colors as branding.
- Don't reach for display weights (700–900) in UI chrome.
- Don't communicate validity by color alone — pair it with `aria-invalid`.
- Don't add emoji to the interface.

## Overflow: fade and ellipsis make opposite promises

Clipped text carries a promise about the part you cannot see, and the two treatments say
**opposite** things. Pick by intent, never by habit:

- **Ellipsis (`truncate`) — "the rest is not for this view."** The cut content lives somewhere
  else and this surface never intends to reveal it. A chat row's message excerpt is the canonical
  case: the message belongs to the conversation, not to the list.
- **Fade (a trailing `mask-image` gradient over 24px) — "the rest is right here."** The content
  continues and this view can reveal it, because something is temporarily covering it or because
  the element scrolls it into view. A long chat or project title is the canonical case.

Three consequences worth carrying into any new layout:

- **Only the edge that can be reached gets a fade.** A scrolling title is clipped at both ends,
  but nothing scrolls it back — so the leading edge is a plain clip. A fade there would promise a
  reveal that doesn't exist.
- **Anything that must stay whole gets pushed aside, not faded.** A half-dissolved "Archived"
  badge is not a state, it's a bug.
- **Hover-revealed controls take space only while showing, by being in the layout** — never
  through padding reserved from their size or count. A row must work the same with one control,
  three, or a badge.

## Motion

Motion is functional and brief: it explains a change, it doesn't decorate one. Row actions expand
over 150ms; a clipped title scrolls at 60px/s after a 300ms delay, one pass, no loop. Everything
motion-driven has a `motion-reduce` path that keeps the information (the fade, the title
attribute) and drops the movement.

## Accessibility is a design constraint, not a pass afterwards

Visible focus rings on everything interactive, `aria-invalid` alongside any error styling, real
labels, and a keyboard path to every action. Text the layout clips at rest still carries a native
`title`, so the tail is reachable without hovering or animating.
