"use client";

import { useEffect, useMemo, useState } from "react";
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
import { buildPersonalizationPreview } from "@/lib/services/personalization/preview";
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
 */
const toPatch = (draft: Draft): Partial<Personalization> =>
  Object.fromEntries(
    (Object.keys(draft) as PersonalizationTextField[]).map((key) => [
      key,
      draft[key]?.trim() ? draft[key] : null,
    ]),
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

export function PersonalizationSection() {
  const { data, isPending } = usePersonalizationQuery();
  const me = useMeOptional();
  const update = useUpdatePersonalizationMutation();

  const [draft, setDraft] = useState<Draft | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);

  // Adopt the server value once it lands — but never while the owner is
  // mid-edit, which would eat their keystrokes.
  useEffect(() => {
    if (data && !draft) setDraft(toDraft(data));
  }, [data, draft]);

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    const stored = toDraft(data);
    return (Object.keys(stored) as PersonalizationTextField[]).some(
      (key) => (stored[key] ?? "") !== (draft[key] ?? ""),
    );
  }, [data, draft]);

  const overCap = useMemo(
    () =>
      draft
        ? (
            Object.keys(PERSONALIZATION_CAPS) as PersonalizationTextField[]
          ).some((key) => (draft[key] ?? "").length > PERSONALIZATION_CAPS[key])
        : false,
    [draft],
  );

  const preview = useMemo(
    () =>
      data && draft
        ? buildPersonalizationPreview(
            { ...data, ...toPatch(draft) },
            me.data ?? undefined,
          )
        : undefined,
    [data, draft, me.data],
  );

  if (isPending || !data || !draft) {
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

  // The master switch gates everything below it, so the fields it governs are
  // disabled rather than merely ignored — a field you can still type into while
  // nothing you type is sent would be a lie told by the UI.
  const enabled = data.enabled;

  const setField = (key: PersonalizationTextField, value: string) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const save = () =>
    update.mutate(toPatch(draft), {
      onSuccess: (saved) => setDraft(toDraft(saved)),
    });

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
        {/* The master switch sits directly on the fields it gates, with no rule
            between them: it is the on/off for THIS group, not a page-level
            preference. Account identity is a separate concern and lives below
            the content it supplements. */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="personalization-enabled">
              Use my personalization
            </FieldLabel>
            <FieldDescription>
              Turn this off to send none of it — including your account details
              — without deleting what you wrote.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="personalization-enabled"
            checked={enabled}
            onCheckedChange={(checked) => update.mutate({ enabled: checked })}
          />
        </Field>

        <Field data-disabled={!enabled}>
          <FieldLabel htmlFor="personalization-preferred-name">
            What should the assistant call you?
          </FieldLabel>
          <Input
            id="personalization-preferred-name"
            value={draft.preferredName ?? ""}
            onChange={(event) => setField("preferredName", event.target.value)}
            placeholder="Leo"
            autoComplete="off"
            disabled={!enabled}
            aria-invalid={
              (draft.preferredName ?? "").length >
              PERSONALIZATION_CAPS.preferredName
            }
          />
          <FieldDescription className="flex min-w-0 justify-between gap-4">
            <span className="min-w-0">Used in place of your account name.</span>
            <CharacterCount
              value={draft.preferredName ?? ""}
              cap={PERSONALIZATION_CAPS.preferredName}
            />
          </FieldDescription>
        </Field>

        <Field data-disabled={!enabled}>
          <FieldLabel htmlFor="personalization-about">About you</FieldLabel>
          <Textarea
            id="personalization-about"
            value={draft.about ?? ""}
            onChange={(event) => setField("about", event.target.value)}
            placeholder="What you work on, the languages you speak, anything worth knowing every time."
            rows={4}
            disabled={!enabled}
            aria-invalid={
              (draft.about ?? "").length > PERSONALIZATION_CAPS.about
            }
          />
          <FieldDescription className="flex min-w-0 justify-between gap-4">
            <span className="min-w-0">
              Context you would otherwise repeat in every chat.
            </span>
            <CharacterCount
              value={draft.about ?? ""}
              cap={PERSONALIZATION_CAPS.about}
            />
          </FieldDescription>
        </Field>

        <Field data-disabled={!enabled}>
          <FieldLabel htmlFor="personalization-response-preferences">
            How should it answer?
          </FieldLabel>
          <Textarea
            id="personalization-response-preferences"
            value={draft.responsePreferences ?? ""}
            onChange={(event) =>
              setField("responsePreferences", event.target.value)
            }
            placeholder="Be concise. Show code before explaining it. Skip the preamble."
            rows={4}
            disabled={!enabled}
            aria-invalid={
              (draft.responsePreferences ?? "").length >
              PERSONALIZATION_CAPS.responsePreferences
            }
          />
          <FieldDescription className="flex min-w-0 justify-between gap-4">
            <span className="min-w-0">
              Delivery preferences only — these cannot grant tools or change
              what the assistant is permitted to do.
            </span>
            <CharacterCount
              value={draft.responsePreferences ?? ""}
              cap={PERSONALIZATION_CAPS.responsePreferences}
            />
          </FieldDescription>
        </Field>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={save}
            disabled={!enabled || !dirty || overCap || update.isPending}
          >
            {/* The label never changes. Swapping "Save"→"Saving…" reflows the
                button mid-click; only the icon morphs, and both glyphs are
                size-4, so nothing moves. */}
            {update.isPending ? (
              <Spinner />
            ) : (
              <CheckIcon className="size-4" aria-hidden />
            )}
            Save
          </Button>
          {dirty && !overCap ? (
            <span className="text-sm text-muted-foreground">
              Unsaved changes
            </span>
          ) : null}
          {overCap ? (
            <span className="text-sm text-destructive">
              Too long to save — trim the fields marked above.
            </span>
          ) : null}
          {update.isError ? (
            <span className="text-sm text-destructive">
              Could not save. Try again.
            </span>
          ) : null}
        </div>

        <Separator />

        <Field orientation="horizontal" data-disabled={!enabled}>
          <FieldContent>
            <FieldLabel htmlFor="personalization-share-identity">
              Share my account name and email
            </FieldLabel>
            {/* The spec requires this control to say where the value goes. A
                self-hosted instance may be pointed at a third-party provider
                that has no relationship with the person reading this. */}
            <FieldDescription>
              Sends them to the model provider this instance is configured to
              use — which may be a third party. Off by default.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="personalization-share-identity"
            checked={data.shareAccountIdentity}
            disabled={!enabled}
            onCheckedChange={(checked) =>
              update.mutate({ shareAccountIdentity: checked })
            }
          />
        </Field>

        <Separator />

        {/* The mirror. A settings form that says "this is sent to a model" and
            then shows you nothing is asking for trust it hasn't earned. */}
        <div className="space-y-3">
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
              onClick={() => setPreviewOpen((open) => !open)}
              aria-expanded={previewOpen}
              aria-controls="personalization-preview"
            >
              {previewOpen ? (
                <EyeOffIcon className="size-4" />
              ) : (
                <EyeIcon className="size-4" />
              )}
              {previewOpen ? "Hide" : "Show"}
            </Button>
          </div>

          {previewOpen ? (
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
                  <p className="text-muted-foreground">
                    &lt;user_personalization&gt;
                  </p>
                  <div className="pl-3">{preview?.text}</div>
                  <p className="text-muted-foreground">
                    &lt;/user_personalization&gt;
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {/* Honest about the limit of this preview: an operator can replace the
              prompt file, and a replacement that omits these paths makes the
              switches above do nothing, silently. */}
          <p className="text-xs text-muted-foreground">
            Based on the prompt llame ships. If this instance uses a custom
            system prompt, what it sends may differ — or it may send none of
            this.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
