---
name: llame-design
description: Use this skill to generate well-branded interfaces and assets for llame (a self-hosted personal AI assistant platform), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

llame is a **monochrome, achromatic** neutral design system (shadcn `new-york` / `neutral`): ink-on-paper text, hairline borders, whisper-flat elevation, a single Alert Red reserved strictly for destructive/invalid states, and no brand hue or imagery. Type is user-configurable (system-stack sans + JetBrains Mono default). Icons are Lucide. Weight caps at 600; emphasis comes from value contrast, not bold type. Dark mode is a first-class peer (`class="dark"`).

Key files:

- `README.md` — the design conventions, then every component's generated API reference.
- `styles.css` — link this one file to get everything: it imports the fonts and `_ds_bundle.css`, which carries the OKLCH color ramp, type scale, spacing, radius and elevation tokens along with the component styles.
- `components/<group>/<Name>/` — one directory per component, each holding a `.html` preview card, a `.jsx` source, a `.d.ts` contract, and a `.prompt.md` usage reference. These are compiled from the real shipping primitives in the llame repo, not recreations.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view — link `styles.css`, load Lucide from CDN for icons, and read components off `window.LlameDesignSystem0f7e4a` (or lift the inline-styled patterns directly). If working on production code, copy assets and read the rules here to become an expert designing with this brand; the real primitives live in `packages/ui/src/components` in the llame repo.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need. Hold the line on the system's discipline: stay achromatic, reserve Alert Red for danger only, never add gradients/emoji/heavy shadows, and keep the interface content-first and quiet.
