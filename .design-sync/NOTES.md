# design-sync notes

## The target project

- **Re-adopted, previously hand-authored** (`llame Design System`,
  `0f7e4a36-9f43-4c15-be85-dbf5912a88c9`). Before the first converter sync it held
  content the converter does not produce: 16 `guidelines/*.card.html` specimen cards,
  a `ui_kits/chat/` recreation of the chat app, `SKILL.md` (a user-invocable
  `llame-design` skill), `_adherence.oxlintrc.json`, and a flat
  `components/<group>/<Name>.jsx` layout with one card per group.
  Leo confirmed the overwrite twice, the second time after the push/pull direction
  was clarified; the `ui_kits` deletion below was asked separately. Everything the
  converter does not produce is now gone from the project.
- **`SKILL.md` documented `window.LlameDesignSystem_0f7e4a`, which does not exist.**
  The converter strips non-alphanumerics from `globalName` when emitting, so the
  bundle's global is `LlameDesignSystem0f7e4a` (no underscore). Config now sets the
  sanitized form so the converter's own export lookup matches, and the skill file is
  **maintained in-repo** at `.design-sync/project-skill/SKILL.md` and uploaded with
  the bundle — it also had to drop the old flat `components/<group>/<Name>.jsx`
  description, since the converter emits a directory per component. Keep editing the
  in-repo copy, never the remote one.
- **`_adherence.oxlintrc.json` and `readme.md` (lowercase) are pre-sync leftovers.**
  The converter emits `README.md`, so on the remote the two coexist unless the old
  one is deleted. Both are in the plan's deletes.
- **The `ui_kits/chat` prototype was deleted, on Leo's explicit call.** It was
  hand-authored (never produced from this repo) and its `index.html` loaded
  `../../_ds_bundle.js` plus React 18 from a CDN, so replacing the bundle with the
  React 19 converter build would have left a broken page in the project. Asked
  rather than assumed, because it was outside the `guidelines`/`components`
  overwrite he had approved. Its six files are unrecoverable from this repo — if a
  chat kit is wanted again, it has to be rebuilt against the new bundle and the
  `LlameDesignSystem0f7e4a` global.

## Why this repo needs a barrel entry

`@workspace/ui` ships **source** with wildcard subpath exports (`./components/*`) —
no root export, no `dist`, no `types`, no build script. Two consequences:

1. `--entry .design-sync/entry.ts` (a generated barrel) supplies the JS bundle.
2. The converter reads the _type_ surface from the package's `types` entry, and with
   `--entry` it locates that package by walking **up** from the entry file — which
   landed on the repo root (no `types`) and produced **0 exports / 0 components**.
   Fixed by giving `.design-sync/` its own `package.json` with `"types": "./entry.ts"`.
   Symptom to recognise next time: `exported PascalCase symbols: 0` plus every
   storybook title reported by `[TITLE_UNMAPPED]`.

`.design-sync/node_modules -> ../.ds-sync/node_modules` is what makes `@types/react`
resolvable from the barrel's location (pnpm keeps it in the virtual store, so the
converter's walk-up never finds it otherwise). Recreate it after a fresh clone.

### Regenerating the barrel

When components are added or removed, re-run the generator (it is deterministic):
`export *` from every `packages/ui/src/components/**/*.tsx` except the eight heavy
modules below, with `ai-elements/shimmer` exporting only `Shimmer` (its
`TextShimmerProps` collides with `custom/text-shimmer`), plus `cn` from `lib/utils`.

## Excluded on purpose

- **Eight modules are out of the barrel** because they blow the upload's 12 MB
  per-file cap. Measured with an esbuild metafile: Shiki's language grammars
  **14.6 MB**, `@shikijs/themes` 2.5 MB, mermaid + parser + cytoscape 2.6 MB, katex
  0.55 MB — against **0.11 MB** of actual design-system source, for a 29.4 MB bundle.
  The modules: `ai-elements/{reasoning-content,message-response,streamdown-plugins,tool,code-block}`,
  `custom/{markdown,code-block,model-output-streamdown}`. Cost: the `markdown`, `code-block` and `tool`
  components don't ship. `message` and `reasoning` DO ship — master's #323 split the
  heavy renderer graph out of them, so their shells are clean.
  Re-including any of them requires narrowing Shiki to specific languages upstream.
- **App-wired compositions are excluded** (`chat-item`, `project-item`,
  `model-selector`, the `shell/app-sidebar/*` rows, `archived-badge`, …): they mock
  the router, React Query and the active-runs context, so they are not reusable
  design-system parts.

## Config quirks worth keeping

- Story titles are **path-derived and kebab-case** (`components/alert-dialog`) because
  the stories set `component:` but no `title:`. The matcher compares the last segment
  **verbatim** against PascalCase exports, so every component needs a `titleMap`
  entry. They were generated and each one verified against the bundle's real export
  list; the two that needed thought: `sonner` → `Toaster`, `regex-tester` →
  `RegexTesterStreamdown`.
- **`titleMap` keys are title SEGMENTS, not full titles.** The app-composition
  exclusions were first written as full titles (`(chat)/components/.../chat-item`),
  which never matched — those components were still excluded, but via
  `[TITLE_UNMAPPED]` instead of the intended explicit `null`. Now rewritten as bare
  segments (`chat-item: null`); keep any new exclusion in that form.

## Preview fidelity — what a story comparison actually proves

Folded from the verification campaign. Final state after a `--force` recapture put every
component on the same bundle: 40 components, 181 graded stories — 180 match, 1 close, 0
mismatch. These are the rules that made grading reliable; re-read them before grading a new
component. The campaign found exactly one real defect (Collapsible `Basic`, below), and it was
found by opening the full-res raw pair, not by reading a contact sheet.

### The two artifacts differ by construction

- **Compiled previews never run a story's `play` function.** Storybook's reference is captured
  **after** `play` settles; the preview renders the module's pristine mount state. Every story
  whose visible content is produced by an interaction therefore looks like a mismatch and isn't
  one. This is a converter limitation, not a per-component bug — it recurred in all six batches.
- **The reference is an _element_ screenshot bound to `#storybook-root`'s bounding box**
  (`compare.mjs`: `el = await sbPage.$(SB_ROOT); png = await el.screenshot(SHOT)`), not a
  full-page capture. Portalled overlay content lives outside that subtree, so it appears only
  where it _visually overlaps_ that rect: popper-anchored content (DropdownMenu, Tooltip,
  HoverCard, Select in popper mode) keeps a trigger-sized bbox and photographs as a closed
  trigger **even while open**, whereas centered content (Dialog, AlertDialog, Sheet,
  CommandDialog, a Popover nested in an open Dialog) overlaps and photographs a genuine slice of
  the open panel. Judge the pixels _inside_ the reference's frame; never downgrade a portal
  story because its thumbnail looks closed.
- **Framing differs by design**: storybook crops tight, previews render full-canvas, and
  `userEvent` leaves a focus ring on whatever it clicked last. Rubric-ignorable — judge the
  component, not the canvas.

### The fix: seed the play function's computed END state

Own `previews/<Name>.tsx`, mirror the story's JSX verbatim, and express the end state through the
component's **real prop contract**. This is the inverse of the forbidden move: it moves state to
match the oracle rather than neutralising it to hide a defect. Read the play to its **last**
assertion, not its first — ToggleGroup's `Basic` ends on `["italic"]` despite clicking bold first.

| End state                                                       | Declarative seed                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| open overlay                                                    | `defaultOpen` (every Base UI `Root`/`Sub` supports it)                                                                                                                                                                                               |
| selection / active tab / accordion item                         | `defaultValue`                                                                                                                                                                                                                                       |
| checked control                                                 | `defaultChecked`; pressed toggle → `defaultPressed`                                                                                                                                                                                                  |
| controlled story                                                | seed the story's own `useState(...)` initial value                                                                                                                                                                                                   |
| post-click focus ring                                           | `autoFocus`                                                                                                                                                                                                                                          |
| react-hook-form validation error                                | `errors` on `useForm` — a real, documented option (7.59.0), applied by a mount-time `useEffect` that calls `_setErrors` + `_focusError`, i.e. the same path a failed submit takes. Check for this before calling a post-submit story unreproducible. |
| a react-hook-form–controlled field                              | `defaultValues`, not a prop on the field                                                                                                                                                                                                             |
| cmdk `CommandInput` filter text                                 | a **controlled** `value` — its own `defaultValue` has no effect (`value` wins in the spread order)                                                                                                                                                   |
| state with no prop at all (`useState`, no `open`/`defaultOpen`) | a thin owned wrapper that `querySelector`s the real trigger and `.click()`s it in a mount `useEffect` — replays the interaction rather than faking the state                                                                                         |

Two things that look like fixes and aren't:

- **A seed whose side effect lands outside the reference's crop makes the delta worse.**
  `autoFocus` on a `MessageAction` that carries a `tooltip` also opens the tooltip; that tooltip
  portals outside the reference's tight crop but _is_ visible in the full-canvas preview, trading
  a subtle missing ring for a large spurious bubble. Check where the side effect lands first.
- **Don't force state a story deliberately doesn't capture.** HoverCard sets
  `visualTests.disable` file-wide because a hover never survives capture; its reference genuinely
  renders closed, so `defaultOpen` would _create_ a mismatch. Same for ButtonGroup's `Basic`,
  where only a ~3px sliver of an open menu reaches the frame.

Forced-open content bleeds across the product grid, so a component with such a preview also needs
`cfg.overrides.<Name>.cardMode: "single"` — currently set for Sidebar plus the eight overlays
(AlertDialog, Command, Dialog, DropdownMenu, Popover, Select, Sheet, Tooltip). Not HoverCard.

### Harness gotchas

- **Grade keys must be story DISPLAY names, not export names** — `"Badge With Icon"`, not
  `"BadgeWithIcon"`. A wrong key is not a hard error: `compare.mjs` prints a quiet
  `grade key(s) matching no story` line, the story counts as ungraded, and the component
  silently drops out of `fullyGraded` — so it re-captures forever and a "40/40 graded" tally
  is fiction. Audit with the story names from `<out>/.stories-map.json` (or
  `sb-reference/index.json` before a build exists) rather than trusting the tally.

- **`compare.mjs` intermittently reports one component as all-`unpaired` / 0 cells** inside a
  multi-component run (`window.__dsCells` reads empty right after the grid nav). Hit four times
  (Accordion, Alert, Field, InputGroup); a scoped `--components <Name>` re-run captured cleanly
  every time. **Re-run scoped before diagnosing a real pairing bug.**
- **`[STORY_CAP]` caps grading, not shipping.** An owned preview must export _every_ story the
  component has, or the uncapped tail ships with no paired cell in the bundle the design agent
  builds from. Caught late on DropdownMenu (11 stories, 6 graded) and Tooltip (8/6).
- **Don't contrast-boost a near-white PNG to hunt a faint element.** An aggressive
  `convert -level 0%,N%` can threshold a real 1px `bg-border` rule into invisibility and produce
  a false "it's missing" — cross-check with a plain `-resize 400%` first.
- **Remote images are not blanked** by the capture sandbox (Avatar's and ScrollArea's `shadcn.png`
  load on both panels), so image-bearing grades are trustworthy.

- **`readmeHeader` resolves from the config HOME, which is the directory _containing_
  `.design-sync/`** — the repo root, not `.design-sync/` itself. The value must
  therefore be `.design-sync/conventions.md`; a bare `conventions.md` silently looks
  for one at the repo root and degrades with
  `! readmeHeader: … not found at the config home — skipped`. It is a warn-and-skip
  field, so a wrong path costs a whole build before you notice the README shipped
  without its header.
- **Reformatting an owned preview invalidates its grade.** The per-component contract
  hashes the `.design-sync/previews/<Name>.tsx` source, so a `prettier --write` over
  that directory clears the grade for every file it touches — 15 of 20 here, while the
  5 prettier left byte-identical carried forward. Nothing is wrong with those grades
  visually; the harness just cannot tell a whitespace change from a real one. **Format
  the owned previews _before_ grading them**, never between grading and upload.

## Re-sync risks

- The barrel is generated, not live: a component added to `packages/ui` is invisible
  to the sync until the barrel is regenerated — and one **removed or renamed**
  upstream fails the build outright with `[UNRESOLVED_IMPORT]`. This fired for real
  when master's #325 replaced `custom/{regex-streamdown,regex-tester}` with
  `custom/model-output-streamdown` (the regex internals moved to
  `packages/ui/src/internal/regex-tester/`). **Re-diff the barrel against the tree
  after every merge from master**, with the check that catches both directions:
  list every non-story `packages/ui/src/components/**/*.tsx`, subtract the barrel's
  `export *` paths, and require the remainder to be exactly the excluded-heavy list.
- **A failed build leaves `--out` empty.** `package-build.mjs` clears the output
  directory before it can fail, so a mid-build error (a stale barrel path, a wrong
  `--node-modules`) destroys the previous good bundle. Nothing else is lost — grades
  live in `.design-sync/.cache/compare/`, owned previews in `.design-sync/previews/`
  — but never treat an existing `ds-bundle/` as a safety net, and never point `--out`
  at anything you cannot regenerate.
- **`--node-modules` is `packages/ui/node_modules`, not the repo root.** pnpm does
  not hoist `react` to the workspace root, so the root path fails with
  "react not found under --node-modules" — and the error's own advice ("pass the
  repo-root node_modules instead") is written for hoisted monorepos and is backwards
  here.
- `[CSS_ASSETS]` warns that ~60 relative `url()` refs (KaTeX fonts) in the scraped
  storybook CSS won't resolve post-upload. They belong to the excluded katex path;
  confirm they are dead rules rather than something a shipped component needs.
- CSS comes from `[CSS_FROM_STORYBOOK]` (scraped out of `sb-reference`), not from a
  package stylesheet — so **the reference storybook must be rebuilt whenever the DS
  source or Tailwind config changes**, or the uploaded CSS goes stale silently.
  The test is not "did `packages/ui` change" but "did a **shipped** component change":
  merging master's #325 touched `packages/ui`, yet every changed file was either
  already excluded-heavy (`message-response`, `reasoning-content`,
  `streamdown-plugins`), a new `internal/regex-tester/*`, or the titleMap-excluded
  `regex-tester` story — so none of the 40 shipped components moved, and both the
  grades and the scraped CSS stayed valid without a storybook rebuild. Check with
  `git diff --stat <pre-merge> HEAD -- packages/ui` and read the file list against
  the exclusions before paying for a rebuild and a full re-grade.
- The `ln -s` into `packages/ui/node_modules/@types` in an early attempt was a
  mistake (it nests inside the existing dir); `@types/react` was already there.
