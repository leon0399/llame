/**
 * Wraps `target` in a pass-through `Proxy` that overrides the given
 * properties while forwarding everything else unchanged. Each override is a
 * function of `target`, invoked lazily on access (not eagerly at wrap
 * time) — the AI SDK's `text`/`consumeStream` trigger stream consumption as
 * a side effect of being read, so an eager override would consume the
 * stream even when the wrapped result is never read for that property.
 * Centralizes the AI SDK `StreamTextResult`-wrapping idiom used at every
 * model-client boundary that augments `consumeStream()`/`text` with
 * abort-settlement or completion tracking (`openai-model-client.ts`,
 * `fake-model-client.ts`, and the `testing/support.ts`/
 * `runs/worker-harness.ts` test doubles) into one reviewed, owned location.
 *
 * Uses `Reflect.get(target, property, receiver)` for the fall-through path
 * rather than direct `target[property]` access: the AI SDK's
 * `DefaultStreamTextResult` (`node_modules/ai/dist/index.mjs`, `ai@6.0.217`)
 * implements several un-overridden getters — including `fullStream`,
 * `textStream`, and `partialOutputStream` — via a shared `teeStream()`
 * helper that MUTATES `this.baseStream` as a side effect of being read
 * (`this.baseStream = stream2`). Whether substituting `target` for the
 * receiver changes that mutation's target depends on ECMAScript's default
 * (untrapped) `[[Set]]`/`[[DefineOwnProperty]]` forwarding behavior for
 * Proxy exotic objects — not something to get wrong by inference in
 * production streaming code. `Reflect.get` is the MDN-documented,
 * receiver-correct choice for a pass-through `get` trap, and this is the
 * one owned place it's needed; consolidating the four duplicated copies
 * here removes the actual repeated-pattern finding.
 */
export function wrapStreamTextResult<T extends object>(
  target: T,
  overrides: Partial<
    Record<PropertyKey, (target: T) => { readonly value: unknown }>
  >,
): T {
  return new Proxy(target, {
    get(target, property, receiver) {
      for (const [key, produce] of Object.entries(overrides)) {
        if (key === property && produce) return produce(target).value;
      }
      // eslint-disable-next-line anti-slop/no-reflect-get -- see the file doc comment above (verified against the AI SDK's own source, not inferred): the single owned exception for StreamTextResult pass-through wrapping.
      return Reflect.get(target, property, receiver);
    },
  });
}
