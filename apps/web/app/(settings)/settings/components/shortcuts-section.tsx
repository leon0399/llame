"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, LockIcon, PencilIcon, XIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd";
import {
  detectPrimaryModifier,
  usePrimaryModifierKey,
} from "@workspace/ui/hooks/use-modifier-key";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import { RelativeTime } from "@/components/relative-time";
import {
  chordFromEvent,
  chordId,
  chordKeys,
  formatChord,
  isBindableChord,
  type Chord,
} from "@/lib/shortcuts/chord";
import {
  SHORTCUTS_BY_ID,
  type ShortcutDefinition,
  type ShortcutId,
} from "@/lib/shortcuts/definitions";
import {
  useShortcutSettings,
  type ShortcutRow,
} from "@/lib/shortcuts/shortcuts-context";

/*
 * Every shortcut, by where it applies. A chord is drawn as its key caps; the
 * pencil beside it records new keys. Keys another shortcut already uses are
 * caught while recording, not reported afterwards: a changeable shortcut can
 * swap keys with this one, a fixed one keeps its keys.
 */

type Settings = ReturnType<typeof useShortcutSettings>;

/** The row being recorded: still listening (after refused keys, `refusal`
 *  says why), or holding keys another changeable shortcut uses until the
 *  owner swaps or cancels. */
type Recording =
  | { id: ShortcutId; phase: "listening"; refusal?: string }
  | { id: ShortcutId; phase: "taken"; chord: Chord; other: ShortcutRow };

/** While `active`, the next chord goes to `onChord`; the listener runs in
 *  the capture phase and stops the event, so the keys being recorded do not
 *  also run the shortcut they belong to now. Esc cancels. */
function useChordRecorder(
  active: boolean,
  onChord: (chord: Chord) => void,
  onCancel: () => void,
) {
  useEffect(() => {
    if (!active) return;

    const isMac = detectPrimaryModifier() === "⌘";

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "Escape") return onCancel();

      const chord = chordFromEvent(event, isMac);

      if (chord !== null) onChord(chord);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });

    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [active, onChord, onCancel]);
}

/** What recording does with a chord: refuse it, take it, or hold it for a
 *  swap with the shortcut that has it. */
function recordChord(
  settings: Settings,
  id: ShortcutId,
  chord: Chord,
  modifierKey: "⌘" | "Ctrl",
): Recording | null {
  if (!isBindableChord(chord)) {
    return {
      id,
      phase: "listening",
      refusal: `Hold ${modifierKey} with a key.`,
    };
  }

  const other = settings.rows.find(
    (row) => row.def.id !== id && chordId(row.chord) === chordId(chord),
  );

  if (other === undefined) {
    settings.setBinding(id, chord);

    return null;
  }

  if (!other.def.rebindable) {
    return {
      id,
      phase: "listening",
      refusal: `${formatChord(chord, modifierKey)} always runs ${other.def.label}. Press other keys.`,
    };
  }

  return { id, phase: "taken", chord, other };
}

function useShortcutRecording(settings: Settings) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const modifierKey = usePrimaryModifierKey();

  useChordRecorder(
    recording?.phase === "listening",
    (chord) => {
      if (recording !== null) {
        setRecording(recordChord(settings, recording.id, chord, modifierKey));
      }
    },
    () => setRecording(null),
  );

  return {
    recording,
    start: (id: ShortcutId) => setRecording({ id, phase: "listening" }),
    cancel: () => setRecording(null),
    /** Gives this row the held keys and the other shortcut this row's. */
    swap: () => {
      if (recording?.phase !== "taken") return;

      const own = settings.rows.find((row) => row.def.id === recording.id);

      settings.setBinding(recording.id, recording.chord);

      if (own !== undefined)
        settings.setBinding(recording.other.def.id, own.chord);

      setRecording(null);
    },
  };
}

type RecordingControls = ReturnType<typeof useShortcutRecording>;

function ChordKeys({ chord }: { chord: Chord }) {
  const modifierKey = usePrimaryModifierKey();

  return (
    <KbdGroup>
      {chordKeys(chord, modifierKey).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

function UsageText({ usage }: { usage: ShortcutRow["usage"] }) {
  if (usage === undefined) return <>Not used yet</>;

  return (
    <>
      Used {usage.count} {usage.count === 1 ? "time" : "times"}, last{" "}
      <RelativeTime date={usage.lastUsedAt} />
    </>
  );
}

/** Usage, and a way back to the default keys once they changed. */
function RowMeta({ row, onReset }: { row: ShortcutRow; onReset: () => void }) {
  const modifierKey = usePrimaryModifierKey();
  const defaultChord = SHORTCUTS_BY_ID.get(row.def.id)!.defaultChord;

  if (!row.def.rebindable) {
    return <p className="text-xs text-muted-foreground">Fixed</p>;
  }

  return (
    <p className="text-xs text-muted-foreground">
      <UsageText usage={row.usage} />
      {row.customized ? (
        <>
          {" · "}
          {/* Text-sized, so the line keeps its height once a binding
              changes; a Button would add its own padding and height. */}
          <button
            type="button"
            onClick={onReset}
            className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Reset to {formatChord(defaultChord, modifierKey)}
          </button>
        </>
      ) : null}
    </p>
  );
}

function StatusLine({
  tone,
  children,
}: {
  tone: "muted" | "warning";
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        tone === "warning"
          ? "flex items-center gap-1.5 text-xs text-destructive [&>svg]:size-3.5 [&>svg]:shrink-0"
          : "text-xs text-muted-foreground"
      }
    >
      {tone === "warning" ? <AlertTriangleIcon aria-hidden /> : null}
      {children}
    </p>
  );
}

/** Keys another changeable shortcut has: swap them, or keep both as they
 *  are. */
function TakenPrompt({
  recording,
  controls,
}: {
  recording: Extract<Recording, { phase: "taken" }>;
  controls: RecordingControls;
}) {
  const modifierKey = usePrimaryModifierKey();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusLine tone="muted">
        {formatChord(recording.chord, modifierKey)} runs{" "}
        {recording.other.def.label}.
      </StatusLine>
      <Button size="xs" onClick={controls.swap}>
        Swap keys
      </Button>
      <Button size="xs" variant="ghost" onClick={controls.cancel}>
        Cancel
      </Button>
    </div>
  );
}

/** What the row says under its usage: the recording's progress, or keys it
 *  shares with another shortcut (only stored bindings from before recording
 *  caught that can still do so). */
function RowStatus({
  row,
  recording,
  controls,
}: {
  row: ShortcutRow;
  recording: Recording | null;
  controls: RecordingControls;
}) {
  if (recording?.phase === "taken") {
    return <TakenPrompt recording={recording} controls={controls} />;
  }

  if (recording?.phase === "listening") {
    return recording.refusal === undefined ? (
      <StatusLine tone="muted">Press the new keys. Esc cancels.</StatusLine>
    ) : (
      <StatusLine tone="warning">{recording.refusal}</StatusLine>
    );
  }

  if (row.conflicts.length === 0) return null;

  return (
    <StatusLine tone="warning">
      Same keys as {row.conflicts.map((def) => def.label).join(", ")}
    </StatusLine>
  );
}

/** The keys, and the control that changes them: a pencil, a cancel while
 *  recording, or a lock for keys that cannot change. */
function RowKeys({
  row,
  recording,
  controls,
}: {
  row: ShortcutRow;
  recording: Recording | null;
  controls: RecordingControls;
}) {
  const active = recording !== null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {active ? (
        <span className="animate-pulse text-xs text-muted-foreground motion-reduce:animate-none">
          Press keys…
        </span>
      ) : (
        <ChordKeys chord={row.chord} />
      )}
      {!row.def.rebindable ? (
        <span className="flex size-8 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
          <LockIcon aria-hidden />
        </span>
      ) : (
        <IconButtonTooltip
          label={
            active
              ? `Stop changing ${row.def.label}`
              : `Change keys for ${row.def.label}`
          }
          size="icon-sm"
          onClick={active ? controls.cancel : () => controls.start(row.def.id)}
        >
          {active ? <XIcon aria-hidden /> : <PencilIcon aria-hidden />}
        </IconButtonTooltip>
      )}
    </div>
  );
}

function ShortcutLine({
  row,
  recording,
  controls,
  onReset,
}: {
  row: ShortcutRow;
  recording: Recording | null;
  controls: RecordingControls;
  onReset: () => void;
}) {
  return (
    <li className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{row.def.label}</p>
        <RowMeta row={row} onReset={onReset} />
        <RowStatus row={row} recording={recording} controls={controls} />
      </div>
      <RowKeys row={row} recording={recording} controls={controls} />
    </li>
  );
}

const GROUPS: Array<ShortcutDefinition["group"]> = [
  "General",
  "Chat",
  "Composer",
];

function ShortcutGroup({
  group,
  settings,
  controls,
}: {
  group: ShortcutDefinition["group"];
  settings: Settings;
  controls: RecordingControls;
}) {
  const { recording } = controls;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{group}</h2>
      <Card>
        <CardContent>
          <ul className="divide-y">
            {settings.rows
              .filter((row) => row.def.group === group)
              .map((row) => (
                <ShortcutLine
                  key={row.def.id}
                  row={row}
                  recording={recording?.id === row.def.id ? recording : null}
                  controls={controls}
                  onReset={() => settings.resetBinding(row.def.id)}
                />
              ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export function ShortcutsSection() {
  const settings = useShortcutSettings();
  const controls = useShortcutRecording(settings);

  return (
    <>
      {GROUPS.map((group) => (
        <ShortcutGroup
          key={group}
          group={group}
          settings={settings}
          controls={controls}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={settings.resetAll}>
          Reset all shortcuts
        </Button>
        <Button variant="ghost" size="sm" onClick={settings.clearUsage}>
          Clear usage counts
        </Button>
      </div>
    </>
  );
}
