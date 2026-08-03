import { type Personalization } from '../db/schema';
import { type PromptUserInput } from '../instance-config/prompt-loader';
import { type AccountIdentity } from './personalization-repository';

/**
 * Decides which values a run is PERMITTED to render for its owner. Whether any
 * of them actually survive is the prompt loader's call, because that question
 * cannot be answered without trimming — and trimming, escaping, and omission
 * are presentation.
 *
 * So the split is permission here, presence there, and it is deliberate rather
 * than accidental: duplicating the trim on this side to pre-empt the loader's
 * emptiness check would put the same rule in two places, where the two could
 * drift. `undefined` here means the master switch is off — nothing is
 * permitted. A permitted-but-empty profile returns an object whose fields are
 * all `undefined`, and the loader drops it, which is what leaves `user` absent
 * from the context so one `{{#if user}}` can gate a whole section including its
 * operator-authored framing prose.
 */
/**
 * Whether this owner's account identity may render at all.
 *
 * Exported so the caller can skip READING `users` when the answer is no —
 * which is the common case, since `shareAccountIdentity` defaults false. That
 * saves a query, and more to the point means an address the owner has not
 * shared is never loaded into process memory in the first place.
 *
 * The defaulting lives here rather than at the call site so there is one
 * source of truth for what the toggles mean.
 */
export function wantsAccountIdentity(
  personalization: Personalization | undefined,
): boolean {
  return (
    (personalization?.enabled ?? true) &&
    (personalization?.shareAccountIdentity ?? false)
  );
}

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

  // Null collapses to undefined here rather than downstream: a stored-but-empty
  // field and a field that was never stored must be indistinguishable in VALUE,
  // not merely produce the same render because the loader happens to coerce
  // both. The loader keeps its own `?? undefined` as belt-and-braces.
  return {
    preferredName: profile?.preferredName ?? undefined,
    about: profile?.about ?? undefined,
    responsePreferences: profile?.responsePreferences ?? undefined,
    ...(wantsAccountIdentity(profile)
      ? {
          name: input.account?.name ?? undefined,
          email: input.account?.email ?? undefined,
        }
      : {}),
  };
}
