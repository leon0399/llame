"use client";

import { useEffect, useState } from "react";
import { AlertTriangleIcon, LockIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Kbd } from "@workspace/ui/components/kbd";
import {
  detectPrimaryModifier,
  usePrimaryModifierKey,
} from "@workspace/ui/hooks/use-modifier-key";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import { RelativeTime } from "@/components/relative-time";
import { chordFromEvent, formatChord, type Chord } from "@/lib/shortcuts/chord";
import type { ShortcutDefinition } from "@/lib/shortcuts/definitions";
import {
  useShortcutSettings,
  type ShortcutRow,
} from "@/lib/shortcuts/shortcuts-context";

/** While recording, the next chord is the new binding. The listener runs in
 *  the capture phase and stops the event, so the chord being recorded does
 *  not also fire the shortcut it currently belongs to. Esc cancels. */
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

function ChordButton({
  row,
  recording,
  onRecord,
}: {
  row: ShortcutRow;
  recording: boolean;
  onRecord: () => void;
}) {
  const modifierKey = usePrimaryModifierKey();
  const label = formatChord(row.chord, modifierKey);

  if (!row.def.rebindable) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Kbd>{label}</Kbd>
        <LockIcon aria-label="Fixed" className="size-3.5" />
      </span>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={
        recording
          ? `Recording a new shortcut for ${row.def.label}`
          : `Change shortcut for ${row.def.label}, now ${label}`
      }
      aria-invalid={row.conflicts.length > 0}
      onClick={onRecord}
    >
      {recording ? "Press keys…" : <Kbd>{label}</Kbd>}
    </Button>
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

function ConflictLine({ conflicts }: { conflicts: Array<ShortcutDefinition> }) {
  if (conflicts.length === 0) return null;

  return (
    <p className="flex items-center gap-1.5 text-xs text-destructive [&>svg]:size-3.5 [&>svg]:shrink-0">
      <AlertTriangleIcon aria-hidden />
      Same keys as {conflicts.map((def) => def.label).join(", ")}
    </p>
  );
}

function ShortcutLine({
  row,
  recording,
  onRecord,
  onReset,
}: {
  row: ShortcutRow;
  recording: boolean;
  onRecord: () => void;
  onReset: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{row.def.label}</p>
        <p className="text-xs text-muted-foreground">
          {row.def.rebindable ? <UsageText usage={row.usage} /> : "Fixed"}
        </p>
        <ConflictLine conflicts={row.conflicts} />
      </div>
      <div className="flex items-center gap-1">
        <ChordButton row={row} recording={recording} onRecord={onRecord} />
        {row.customized && (
          <IconButtonTooltip
            label={`Reset ${row.def.label} to its default`}
            size="icon-sm"
            onClick={onReset}
          >
            <RotateCcwIcon aria-hidden />
          </IconButtonTooltip>
        )}
      </div>
    </li>
  );
}

function ShortcutGroup({
  group,
  rows,
  recordingId,
  onRecord,
  onReset,
}: {
  group: ShortcutDefinition["group"];
  rows: Array<ShortcutRow>;
  recordingId: string | null;
  onRecord: (id: ShortcutRow["def"]["id"]) => void;
  onReset: (id: ShortcutRow["def"]["id"]) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{group}</h2>
      <Card>
        <CardContent>
          <ul className="divide-y">
            {rows.map((row) => (
              <ShortcutLine
                key={row.def.id}
                row={row}
                recording={row.def.id === recordingId}
                onRecord={() => onRecord(row.def.id)}
                onReset={() => onReset(row.def.id)}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

const GROUPS: Array<ShortcutDefinition["group"]> = [
  "General",
  "Chat",
  "Composer",
];

/**
 * Every shortcut, by where it applies: its chord, how often this browser
 * used it, and any other shortcut on the same keys. A rebindable chord is a
 * button that records the next keypress; fixed ones (Enter in the composer,
 * the vendored sidebar's toggle) are listed so their keys count for
 * conflicts.
 */
export function ShortcutsSection() {
  const settings = useShortcutSettings();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const recordingRow = settings.rows.find((row) => row.def.id === recordingId);

  useChordRecorder(
    recordingRow !== undefined,
    (chord) => {
      if (recordingRow !== undefined) {
        settings.setBinding(recordingRow.def.id, chord);
      }

      setRecordingId(null);
    },
    () => setRecordingId(null),
  );

  return (
    <>
      {GROUPS.map((group) => (
        <ShortcutGroup
          key={group}
          group={group}
          rows={settings.rows.filter((row) => row.def.group === group)}
          recordingId={recordingId}
          onRecord={setRecordingId}
          onReset={settings.resetBinding}
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
