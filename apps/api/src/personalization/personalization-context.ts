import { type Personalization } from '../db/schema';
import { type PromptUserInput } from '../instance-config/prompt-loader';
import { type AccountIdentity } from './personalization-repository';

/**
 * Decides WHAT a run is allowed to render for its owner. The prompt loader
 * decides how — escaping, trimming, and omitting absent values from the render
 * context. Keeping policy here and presentation there is deliberate: the
 * toggles are a product rule, while omission is a Handlebars truthiness
 * requirement (an already-safe wrapper is truthy even when it wraps "").
 *
 * Returns `undefined` when nothing at all may render, which is what makes
 * `user` absent from the context and lets one `{{#if user}}` gate a whole
 * section including its operator-authored framing prose.
 */
export function resolvePromptUserInput(input: {
  personalization: Personalization | undefined;
  account: AccountIdentity | undefined;
}): PromptUserInput | undefined {
  const profile = input.personalization;

  // No row is not a special case: the column defaults are `enabled` true and
  // `shareAccountIdentity` false, so an owner who has never opened the settings
  // renders exactly nothing — authored fields are empty, identity is withheld.
  // That is the "indistinguishable from disabled" behavior the spec requires,
  // and it falls out of the defaults rather than needing a branch.
  const enabled = profile?.enabled ?? true;
  if (!enabled) {
    // The master switch. Turning it off stops account identity too, not just
    // authored text — an owner disabling personalization is not opting into
    // having their email sent instead.
    return undefined;
  }

  const shareAccountIdentity = profile?.shareAccountIdentity ?? false;

  // Null collapses to undefined here rather than downstream: a stored-but-empty
  // field and a field that was never stored must be indistinguishable in VALUE,
  // not merely produce the same render because the loader happens to coerce
  // both. The loader keeps its own `?? undefined` as belt-and-braces.
  return {
    preferredName: profile?.preferredName ?? undefined,
    about: profile?.about ?? undefined,
    responsePreferences: profile?.responsePreferences ?? undefined,
    ...(shareAccountIdentity
      ? {
          name: input.account?.name ?? undefined,
          email: input.account?.email ?? undefined,
        }
      : {}),
  };
}
