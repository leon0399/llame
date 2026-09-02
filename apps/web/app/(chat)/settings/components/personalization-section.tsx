"use client";

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

import { useUpdatePersonalizationMutation } from "@/lib/services/personalization/mutations";
import { PERSONALIZATION_CAPS } from "@/lib/services/personalization/types";
import type { PersonalizationTextField } from "@/lib/services/personalization/types";

import {
  usePersonalizationDraft,
  type Draft,
  type PersonalizationPreview,
} from "./use-personalization-draft";

/** Below this much headroom the counter appears; above it, it stays out of the way. */
const COUNTER_VISIBLE_WITHIN = 0.15;

function PersonalizationCardHeader({ description }: { description: string }) {
  return (
    <CardHeader>
      <CardTitle>Personalization</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

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

const TEXT_FIELDS: Array<TextFieldConfig> = [
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
          <p className="text-muted-foreground">&lt;/user_personalization&gt;</p>
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
        Based on the prompt llame ships. If this instance uses a custom system
        prompt, what it sends may differ — or it may send none of this.
      </p>
    </div>
  );
}

function PersonalizationSkeleton() {
  return (
    <Card className="lg:max-w-2xl">
      <PersonalizationCardHeader description="What the assistant knows about you, and how you want it to answer." />
      <CardContent className="space-y-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

/** The derived-state bundle every form section reads from — passed down whole
 * rather than fanned out prop-by-prop, since it's already one cohesive unit. */
type PersonalizationFormState = Omit<
  ReturnType<typeof usePersonalizationDraft>,
  "data" | "draft" | "isPending"
>;

function PersonalizationFieldsSection({
  enabled,
  draft,
  setField,
  ...state
}: { enabled: boolean; draft: Draft } & PersonalizationFormState) {
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
        onCheckedChange={(checked) => state.update.mutate({ enabled: checked })}
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
        dirty={state.dirty}
        overCap={state.overCap}
        isSaving={state.isSaving}
        isError={state.update.isError}
        onSave={state.save}
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
  ...state
}: {
  data: NonNullable<ReturnType<typeof usePersonalizationDraft>["data"]>;
  draft: Draft;
} & PersonalizationFormState) {
  // The master switch gates everything below it, so the fields it governs are
  // disabled rather than merely ignored — a field you can still type into while
  // nothing you type is sent would be a lie told by the UI.
  const enabled = data.enabled;

  return (
    <Card className="lg:max-w-2xl">
      <PersonalizationCardHeader description="What the assistant knows about you, and how you want it to answer. Everything here is sent with every message you write." />

      {/* pb-2 on top of Card's own padding: the closing footnote is 12px type
          and sits right against the card edge without it. */}
      <CardContent className="space-y-6 pb-2">
        <PersonalizationFieldsSection
          enabled={enabled}
          draft={draft}
          {...state}
        />

        <Separator />

        <PersonalizationIdentitySection
          enabled={enabled}
          shareAccountIdentity={data.shareAccountIdentity}
          update={state.update}
          preview={state.preview}
          previewOpen={state.previewOpen}
          setPreviewOpen={state.setPreviewOpen}
        />
      </CardContent>
    </Card>
  );
}

export function PersonalizationSection() {
  const { data, isPending, draft, ...state } = usePersonalizationDraft();
  if (isPending || !data || !draft) {
    return <PersonalizationSkeleton />;
  }
  return <PersonalizationForm data={data} draft={draft} {...state} />;
}
