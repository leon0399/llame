"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";

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

/** Below this much headroom the counter appears; above it, it stays out of the way. */
const COUNTER_VISIBLE_WITHIN = 0.15;

type Draft = Pick<
  Personalization,
  "preferredName" | "about" | "responsePreferences"
>;

/** `Object.keys` typed to the object's own key union — TS's lib type widens to `string[]`. */
function typedKeys(obj: Draft | typeof PERSONALIZATION_CAPS): PersonalizationTextField[] {
  // SAFETY: `Draft` and `PERSONALIZATION_CAPS` are both declared object types
  // (no index signature) whose only keys are `PersonalizationTextField`;
  // `Object.keys` just doesn't encode that in its return type.
  return Object.keys(obj) as PersonalizationTextField[];
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

function CharacterCount({ value, cap }: { value: string; cap: number }) {
  const remaining = cap - value.length;
  // Silent until it could plausibly matter — a counter reading 12/8000 is noise
  // that trains you to ignore the one reading 40 left.
  if (remaining > cap * COUNTER_VISIBLE_WITHIN) return null;

  return (
    <span
      className={cn(
        "shrink-0 tabular-nums transition-colors",
        remaining < 0 ? "text-destructive" : "text-muted-foreground",
      )}
      aria-live="polite"
    >
      {remaining < 0
        ? `${String(-remaining)} over the limit`
        : `${String(remaining)} left`}
    </span>
  );
}

type TextFieldConfig = {
  key: PersonalizationTextField;
  id: string;
  label: string;
  placeholder: string;
  description: string;
  control: "input" | "textarea";
};

const TEXT_FIELDS: TextFieldConfig[] = [
  {
    key: "preferredName",
    id: "personalization-preferred-name",
    label: "What should the assistant call you?",
    placeholder: "Leo",
    description: "Used in place of your account name.",
    control: "input",
  },
  {
    key: "about",
    id: "personalization-about",
    label: "About you",
    placeholder:
      "What you work on, the languages you speak, anything worth knowing every time.",
    description: "Context you would otherwise repeat in every chat.",
    control: "textarea",
  },
  {
    key: "responsePreferences",
    id: "personalization-response-preferences",
    label: "How should it answer?",
    placeholder:
      "Be concise. Show code before explaining it. Skip the preamble.",
    description:
      "Delivery preferences only — these cannot grant tools or change what the assistant is permitted to do.",
    control: "textarea",
  },
];

function PersonalizationFieldControl({
  field,
  value,
  enabled,
  invalid,
  onChange,
}: {
  field: TextFieldConfig;
  value: string;
  enabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  if (field.control === "input") {
    return (
      <Input
        id={field.id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        autoComplete="off"
        disabled={!enabled}
        aria-invalid={invalid}
      />
    );
  }
  return (
    <Textarea
      id={field.id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder}
      rows={4}
      disabled={!enabled}
      aria-invalid={invalid}
    />
  );
}

function PersonalizationTextFieldRow({
  field,
  value,
  enabled,
  onChange,
}: {
  field: TextFieldConfig;
  value: string;
  enabled: boolean;
  onChange: (value: string) => void;
}) {
  const cap = PERSONALIZATION_CAPS[field.key];
  const invalid = value.length > cap;

  return (
    <Field data-disabled={!enabled}>
      <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
      <PersonalizationFieldControl
        field={field}
        value={value}
        enabled={enabled}
        invalid={invalid}
        onChange={onChange}
      />
      <FieldDescription className="flex min-w-0 justify-between gap-4">
        <span className="min-w-0">{field.description}</span>
        <CharacterCount value={value} cap={cap} />
      </FieldDescription>
    </Field>
  );
}

function PersonalizationToggleField({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </Field>
  );
}

/** The three save-outcome messages are independent, not mutually exclusive — an
 * over-cap draft and a stale save error can be true at once. */
function PersonalizationSaveStatus({
  dirty,
  overCap,
  isError,
}: {
  dirty: boolean;
  overCap: boolean;
  isError: boolean;
}) {
  return (
    <>
      {dirty && !overCap ? (
        <span className="text-sm text-muted-foreground">Unsaved changes</span>
      ) : null}
      {overCap ? (
        <span className="text-sm text-destructive">
          Too long to save — trim the fields marked above.
        </span>
      ) : null}
      {isError ? (
        <span className="text-sm text-destructive">
          Could not save. Try again.
        </span>
      ) : null}
    </>
  );
}

function PersonalizationSaveRow({
  enabled,
  dirty,
  overCap,
  isSaving,
  isError,
  onSave,
}: {
  enabled: boolean;
  dirty: boolean;
  overCap: boolean;
  isSaving: boolean;
  isError: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        onClick={onSave}
        disabled={!enabled || !dirty || overCap || isSaving}
      >
        {/* The label never changes. Swapping "Save"→"Saving…" reflows the
            button mid-click; only the icon morphs, and both glyphs are
            size-4, so nothing moves. */}
        {isSaving ? <Spinner /> : <CheckIcon className="size-4" aria-hidden />}
        Save
      </Button>
      <PersonalizationSaveStatus
        dirty={dirty}
        overCap={overCap}
        isError={isError}
      />
    </div>
  );
}

function PersonalizationPreviewToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm leading-none font-medium">
          What the assistant receives
        </p>
        <p className="text-sm text-muted-foreground">
          Exactly as it is sent, including your unsaved edits.
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="personalization-preview"
      >
        {open ? (
          <EyeOffIcon className="size-4" />
        ) : (
          <EyeIcon className="size-4" />
        )}
        {open ? "Hide" : "Show"}
      </Button>
    </div>
  );
}

function PersonalizationPreviewBody({
  preview,
}: {
  preview: PersonalizationPreview | undefined;
}) {
  return (
    <div
      id="personalization-preview"
      className="rounded-xl border bg-muted/40 p-4 font-mono text-xs leading-relaxed"
    >
      {preview?.empty ? (
        <p className="text-muted-foreground">
          Nothing. No personalization is added to your messages.
        </p>
      ) : (
        <div className="space-y-1 break-words whitespace-pre-wrap">
          <p className="text-muted-foreground">&lt;user_personalization&gt;</p>
          <div className="pl-3">{preview?.text}</div>
          <p className="text-muted-foreground">
            &lt;/user_personalization&gt;
          </p>
        </div>
      )}
    </div>
  );
}

/** The mirror. A settings form that says "this is sent to a model" and then
 * shows you nothing is asking for trust it hasn't earned. */
function PersonalizationPreviewPanel({
  open,
  onToggle,
  preview,
}: {
  open: boolean;
  onToggle: () => void;
  preview: PersonalizationPreview | undefined;
}) {
  return (
    <div className="space-y-3">
      <PersonalizationPreviewToggle open={open} onToggle={onToggle} />
      {open ? <PersonalizationPreviewBody preview={preview} /> : null}
      {/* Honest about the limit of this preview: an operator can replace the
          prompt file, and a replacement that omits these paths makes the
          switches above do nothing, silently. */}
      <p className="text-xs text-muted-foreground">
        Based on the prompt llame ships. If this instance uses a custom
        system prompt, what it sends may differ — or it may send none of
        this.
      </p>
    </div>
  );
}

function PersonalizationSkeleton() {
  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Personalization</CardTitle>
        <CardDescription>
          What the assistant knows about you, and how you want it to answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

/** Keeps `draft` in sync with the server value without ever clobbering an edit. */
function useDraftState(data: Personalization | undefined) {
  const [draft, setDraft] = useState<Draft | undefined>();

  // Adopt the server value on first load AND on any later refetch that finds
  // the draft clean — otherwise a save from another tab leaves this one showing
  // stale text indefinitely. A DIRTY draft is never touched: overwriting it
  // would eat the owner's keystrokes mid-edit.
  useEffect(() => {
    if (!data) return;
    setDraft((current) => {
      if (!current) return toDraft(data);
      const stored = toDraft(data);
      const edited = typedKeys(stored).some(
        (key) => (stored[key] ?? "") !== (current[key] ?? ""),
      );
      return edited ? current : stored;
    });
  }, [data]);

  return [draft, setDraft] as const;
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

function usePersonalizationDraft() {
  const { data, isPending } = usePersonalizationQuery();
  const me = useMeOptional();
  const update = useUpdatePersonalizationMutation();
  const [draft, setDraft] = useDraftState(data);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { dirty, overCap, isSaving, preview } = usePersonalizationDerived(
    data,
    draft,
    me,
    update,
  );

  const setField = (key: PersonalizationTextField, value: string) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const save = () => {
    if (!draft) return;
    update.mutate(toPatch(draft), {
      onSuccess: (saved) => setDraft(toDraft(saved)),
    });
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

function PersonalizationFieldsSection({
  enabled,
  draft,
  setField,
  update,
  dirty,
  overCap,
  isSaving,
  save,
}: {
  enabled: boolean;
  draft: Draft;
  setField: (key: PersonalizationTextField, value: string) => void;
  update: ReturnType<typeof useUpdatePersonalizationMutation>;
  dirty: boolean;
  overCap: boolean;
  isSaving: boolean;
  save: () => void;
}) {
  return (
    <>
      {/* The master switch sits directly on the fields it gates, with no rule
          between them: it is the on/off for THIS group, not a page-level
          preference. Account identity is a separate concern and lives below
          the content it supplements. */}
      <PersonalizationToggleField
        id="personalization-enabled"
        label="Use my personalization"
        description="Turn this off to send none of it — including your account details — without deleting what you wrote."
        checked={enabled}
        onCheckedChange={(checked) => update.mutate({ enabled: checked })}
      />

      {TEXT_FIELDS.map((field) => (
        <PersonalizationTextFieldRow
          key={field.key}
          field={field}
          value={draft[field.key] ?? ""}
          enabled={enabled}
          onChange={(value) => setField(field.key, value)}
        />
      ))}

      <PersonalizationSaveRow
        enabled={enabled}
        dirty={dirty}
        overCap={overCap}
        isSaving={isSaving}
        isError={update.isError}
        onSave={save}
      />
    </>
  );
}

function PersonalizationIdentitySection({
  enabled,
  shareAccountIdentity,
  update,
  preview,
  previewOpen,
  setPreviewOpen,
}: {
  enabled: boolean;
  shareAccountIdentity: boolean;
  update: ReturnType<typeof useUpdatePersonalizationMutation>;
  preview: PersonalizationPreview | undefined;
  previewOpen: boolean;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <>
      {/* The spec requires this control to say where the value goes. A
          self-hosted instance may be pointed at a third-party provider
          that has no relationship with the person reading this. */}
      <PersonalizationToggleField
        id="personalization-share-identity"
        label="Share my account name and email"
        description="Sends them to the model provider this instance is configured to use — which may be a third party. Off by default."
        checked={shareAccountIdentity}
        disabled={!enabled}
        onCheckedChange={(checked) =>
          update.mutate({ shareAccountIdentity: checked })
        }
      />

      <Separator />

      <PersonalizationPreviewPanel
        open={previewOpen}
        onToggle={() => setPreviewOpen((open) => !open)}
        preview={preview}
      />
    </>
  );
}

function PersonalizationForm({
  data,
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
}: {
  data: Personalization;
  draft: Draft;
} & Omit<
  ReturnType<typeof usePersonalizationDraft>,
  "data" | "draft" | "isPending"
>) {
  // The master switch gates everything below it, so the fields it governs are
  // disabled rather than merely ignored — a field you can still type into while
  // nothing you type is sent would be a lie told by the UI.
  const enabled = data.enabled;

  return (
    <Card className="lg:max-w-2xl">
      <CardHeader>
        <CardTitle>Personalization</CardTitle>
        <CardDescription>
          What the assistant knows about you, and how you want it to answer.
          Everything here is sent with every message you write.
        </CardDescription>
      </CardHeader>

      {/* pb-2 on top of Card's own padding: the closing footnote is 12px type
          and sits right against the card edge without it. */}
      <CardContent className="space-y-6 pb-2">
        <PersonalizationFieldsSection
          enabled={enabled}
          draft={draft}
          setField={setField}
          update={update}
          dirty={dirty}
          overCap={overCap}
          isSaving={isSaving}
          save={save}
        />

        <Separator />

        <PersonalizationIdentitySection
          enabled={enabled}
          shareAccountIdentity={data.shareAccountIdentity}
          update={update}
          preview={preview}
          previewOpen={previewOpen}
          setPreviewOpen={setPreviewOpen}
        />
      </CardContent>
    </Card>
  );
}

export function PersonalizationSection() {
  const state = usePersonalizationDraft();
  if (state.isPending || !state.data || !state.draft) {
    return <PersonalizationSkeleton />;
  }
  return (
    <PersonalizationForm {...state} data={state.data} draft={state.draft} />
  );
}
