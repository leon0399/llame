import { useMemo, useState } from "react";

import { useMeOptional } from "@/lib/services/auth/queries";
import { useUpdatePersonalizationMutation } from "@/lib/services/personalization/mutations";
import {
  buildPersonalizationPreview,
  type PersonalizationPreview,
} from "@/lib/services/personalization/preview";
import { usePersonalizationQuery } from "@/lib/services/personalization/queries";
import {
  PERSONALIZATION_CAPS,
  type Personalization,
  type PersonalizationTextField,
} from "@/lib/services/personalization/types";

export type Draft = Pick<
  Personalization,
  "preferredName" | "about" | "responsePreferences"
>;

/** `Object.keys` typed to the object's own key union — TS's lib type widens to `string[]`. */
export function typedKeys(
  obj: Draft | typeof PERSONALIZATION_CAPS,
): Array<PersonalizationTextField> {
  // SAFETY: `Draft` and `PERSONALIZATION_CAPS` are both declared object types
  // (no index signature) whose only keys are `PersonalizationTextField`;
  // `Object.keys` just doesn't encode that in its return type.
  return Object.keys(obj) as Array<PersonalizationTextField>;
}

const toDraft = (value: Personalization): Draft => ({
  preferredName: value.preferredName ?? "",
  about: value.about ?? "",
  responsePreferences: value.responsePreferences ?? "",
});

/**
 * An omitted key keeps the stored value; an explicit null clears it. Sending
 * `""` would store an empty string instead of clearing, so a field the owner
 * emptied becomes `null` rather than blank — matching what "absent" means all
 * the way down to the render context.
 *
 * The stored value is TRIMMED, not raw. Both the preview and the server's
 * `promptValue` trim on render, so persisting `"Leo "` would store something
 * that disagrees with the field the owner sees and with the preview captioned
 * "exactly as it is sent". The trim is already the decision boundary for
 * present-vs-absent; storing anything else re-opens the same drift.
 */
const toPatch = (draft: Draft): Partial<Personalization> =>
  Object.fromEntries(
    typedKeys(draft).map((key) => [key, draft[key]?.trim() || null]),
  );

/**
 * The owner's edits, laid over whatever the server currently holds.
 *
 * Nothing is copied into state when the query resolves, so there is no copy to
 * keep in step: a refetch — this tab's own save, another tab's, a toggle —
 * shows through on every field the owner has not typed into, while a field
 * they HAVE typed into keeps their keystrokes until a save lands. Overwriting
 * one would eat the owner's keystrokes mid-edit.
 */
function useDraftState(data: Personalization | undefined) {
  const [edits, setEdits] = useState<Partial<Draft>>({});

  return {
    draft: data ? { ...toDraft(data), ...edits } : undefined,
    setField: (key: PersonalizationTextField, value: string) =>
      setEdits((current) => ({ ...current, [key]: value })),
    // A save that returns is no longer an edit: the mutation has already
    // patched the query cache with exactly the payload it sent, so dropping
    // them makes the field read back as the server's own value — trimmed, per
    // `toPatch`.
    acceptSaved: () => setEdits({}),
  };
}

/** Validation/display flags derived from the current data + draft snapshot. */
function usePersonalizationDerived(
  data: Personalization | undefined,
  draft: Draft | undefined,
  me: ReturnType<typeof useMeOptional>,
  update: ReturnType<typeof useUpdatePersonalizationMutation>,
) {
  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    const stored = toDraft(data);
    return typedKeys(stored).some(
      (key) => (stored[key] ?? "") !== (draft[key] ?? ""),
    );
  }, [data, draft]);

  const overCap = useMemo(
    () =>
      draft
        ? typedKeys(PERSONALIZATION_CAPS).some(
            (key) => (draft[key] ?? "").length > PERSONALIZATION_CAPS[key],
          )
        : false,
    [draft],
  );

  // `me` unresolved is NOT the same as "shares no identity". Collapsing the two
  // would let the preview state that nothing identifying is sent while the
  // account query is still in flight or has failed — the one claim this preview
  // exists to make truthfully.
  const identityUnknown =
    data?.shareAccountIdentity === true && me.data === undefined;

  // The Save affordance must reflect SAVES. One mutation hook backs the two
  // toggles as well, and those persist optimistically on their own — so keying
  // the spinner off `update.isPending` made Save spin and disable when nothing
  // was being saved. Only a text-field payload counts.
  const isSaving =
    update.isPending &&
    update.variables !== undefined &&
    typedKeys(PERSONALIZATION_CAPS).some((key) => key in update.variables!);

  const preview = useMemo(
    () =>
      data && draft && !identityUnknown
        ? buildPersonalizationPreview(
            { ...data, ...toPatch(draft) },
            me.data ?? undefined,
          )
        : undefined,
    [data, draft, me.data, identityUnknown],
  );

  return { dirty, overCap, isSaving, preview };
}

export function usePersonalizationDraft() {
  const { data, isPending } = usePersonalizationQuery();
  const me = useMeOptional();
  const update = useUpdatePersonalizationMutation();
  const { draft, setField, acceptSaved } = useDraftState(data);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { dirty, overCap, isSaving, preview } = usePersonalizationDerived(
    data,
    draft,
    me,
    update,
  );

  const save = () => {
    if (!draft) return;
    update.mutate(toPatch(draft), { onSuccess: acceptSaved });
  };

  return {
    data,
    isPending,
    draft,
    update,
    dirty,
    overCap,
    isSaving,
    preview,
    previewOpen,
    setPreviewOpen,
    setField,
    save,
  };
}

export type { PersonalizationPreview };
