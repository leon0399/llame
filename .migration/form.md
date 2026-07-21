# form

2026-07-21 · transformation engine (react-hook-form wrapper) · Swapped the two Radix pieces — `Slot` (FormControl's prop-merge) and the `LabelPrimitive` type — for Base UI. react-hook-form itself is untouched. Zero consumer edits.

## Changed

- **`packages/ui/src/components/form.tsx`**:
  - **`FormControl`**: was `Slot.Root` merging the field's `id`/`aria-describedby`/`aria-invalid` onto its single child. Rewritten with Base UI's `useRender` + `mergeProps<"input">`: the child (passed as `children`, Radix-`Slot` ergonomics) is routed to `render`, the field wiring is merged via `props`, and `data-slot="form-control"` is emitted via `useRender`'s `state`. Consumers keep the `<FormControl><Input {...field} /></FormControl>` shape unchanged.
  - **`FormLabel`**: prop type `React.ComponentProps<typeof LabelPrimitive.Root>` → `React.ComponentProps<typeof Label>` (our `Label` is already a native `<label>`). It already rendered `<Label>`, so only the type import changed.
  - Dropped both `radix-ui` imports (`Slot`, `type Label as LabelPrimitive`). Docs `@see` URL `radix/form` → `base/form`. Leftover scan clean apart from one explanatory code comment referencing the old Radix-`Slot` ergonomics.
- **`packages/ui/src/components/form.stories.tsx`** — docs URL retarget only. Stories pass **3/3**, including `WithValidation` which submits an invalid form and asserts `aria-invalid` on the input — this exercises FormControl's `useRender`+`mergeProps` wiring end-to-end (the whole point of the component), so the migration is verified, not just compiling.

Typecheck green: `@workspace/ui` and `web` both exit 0.

## Left alone

- **react-hook-form** (`Controller`, `FormProvider`, `useFormContext`, `useFormState`) — not Radix, untouched.
- Consumers (`register-form.tsx`, `form.stories.tsx`) use `<FormControl><Input/></FormControl>` / `<FormControl><SelectTrigger/></FormControl>` — the children ergonomics are preserved by routing `children`→`render`, so **no consumer edits**.
- **Visual baselines** — form fields' own classes are unchanged; rendered output should be stable.

## Behavior changes

- None functional. FormControl still forwards `id`/`aria-describedby`/`aria-invalid` onto its child; the merge is now Base UI `mergeProps` instead of Radix `Slot`. Verified by the `WithValidation` story's `aria-invalid` assertion.

## Verify by hand

- Submit an invalid field (e.g. register form with a bad email): the input gets `aria-invalid`, the error message is announced, and the label still associates via `htmlFor`/`id`.
- Tab to a control: focus lands on the input, and its `aria-describedby` points at the description + (on error) the message.
