"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  detectPrimaryModifier,
  usePrimaryModifierKey,
} from "@workspace/ui/hooks/use-modifier-key";

import { z } from "zod";

import { useLatestRef } from "@/lib/hooks/use-latest-ref";

import { ariaKeyShortcut, formatChord, matchChord, type Chord } from "./chord";
import {
  SHORTCUT_IDS,
  SHORTCUTS,
  SHORTCUTS_BY_ID,
  findConflicts,
  type ShortcutDefinition,
  type ShortcutId,
} from "./definitions";
import { createLocalStore } from "./local-store";

/*
 * One keyboard listener for the whole app. Features register handlers by
 * shortcut id (`useShortcut`) instead of each adding its own document
 * listener, so a binding the owner changes in settings changes everywhere,
 * conflicts are visible in one place, and each use is counted.
 */

type Bindings = Partial<Record<ShortcutId, Chord>>;

const ChordSchema = z.object({
  key: z.string().min(1),
  mod: z.boolean().optional(),
  shift: z.boolean().optional(),
  alt: z.boolean().optional(),
});

const UsageSchema = z.object({
  count: z.number().int().nonnegative(),
  lastUsedAt: z.string(),
});

/** Stored entries for shortcuts that no longer exist are dropped, and so are
 *  bindings for fixed ones, rather than trusted. */
const BindingsSchema = z
  .partialRecord(z.enum(SHORTCUT_IDS), ChordSchema)
  .transform((stored) => {
    const bindings: Bindings = {};

    for (const def of SHORTCUTS) {
      const chord = stored[def.id];

      if (def.rebindable && chord !== undefined) bindings[def.id] = chord;
    }

    return bindings;
  });

export type ShortcutUsage = z.infer<typeof UsageSchema>;

type Usage = Partial<Record<ShortcutId, ShortcutUsage>>;

const StoredUsageSchema = z.partialRecord(z.enum(SHORTCUT_IDS), UsageSchema);

const NO_BINDINGS: Bindings = {};
const NO_USAGE: Usage = {};

// ponytail: per-browser only. Move both to the owner's profile in the API
// once bindings should follow the owner across devices.
const bindingsStore = createLocalStore<Bindings>(
  "llame.shortcuts.bindings",
  BindingsSchema,
  NO_BINDINGS,
);

const usageStore = createLocalStore<Usage>(
  "llame.shortcuts.usage",
  StoredUsageSchema,
  NO_USAGE,
);

/** A handler returns `false` when the keypress is not its to take (a popup
 *  is open, the feature is idle); the event then goes on untouched. */
type ShortcutHandler = (event: KeyboardEvent) => boolean | void;

type HandlerRegistry = Map<ShortcutId, Array<{ current: ShortcutHandler }>>;

const ShortcutsContext = createContext<HandlerRegistry | null>(null);

function chordFor(bindings: Bindings, id: ShortcutId): Chord {
  return bindings[id] ?? SHORTCUTS_BY_ID.get(id)!.defaultChord;
}

function recordUse(id: ShortcutId) {
  const usage = usageStore.getSnapshot();

  usageStore.set({
    ...usage,
    [id]: {
      count: (usage[id]?.count ?? 0) + 1,
      lastUsedAt: new Date().toISOString(),
    },
  });
}

/** The single keydown listener: the newest handler of the first matching
 *  shortcut takes the event. */
function useDispatch(registry: HandlerRegistry, bindings: Bindings) {
  useEffect(() => {
    const isMac = detectPrimaryModifier() === "⌘";

    const onKeyDown = (event: KeyboardEvent) => {
      // A held chord fires once; an event a popup already took is not ours.
      if (event.repeat || event.defaultPrevented || event.isComposing) return;

      for (const [id, handlers] of registry) {
        const handler = handlers.at(-1);

        if (handler === undefined) continue;

        if (!matchChord(event, chordFor(bindings, id), isMac)) continue;

        if (handler.current(event) === false) continue;
        event.preventDefault();
        recordUse(id);

        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [registry, bindings]);
}

function useBindings(): Bindings {
  return useSyncExternalStore(
    bindingsStore.subscribe,
    bindingsStore.getSnapshot,
    bindingsStore.getServerSnapshot,
  );
}

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [registry] = useState<HandlerRegistry>(() => new Map());

  useDispatch(registry, useBindings());

  return <ShortcutsContext value={registry}>{children}</ShortcutsContext>;
}

/** Runs `handler` on the shortcut's chord while `enabled`. The newest
 *  registration of an id wins, so a nested feature can take over a chord. */
export function useShortcut(
  id: ShortcutId,
  handler: ShortcutHandler,
  enabled = true,
) {
  const registry = useContext(ShortcutsContext);
  const handlerRef = useLatestRef(handler);

  useEffect(() => {
    if (!enabled || registry === null) return;

    const entry = handlerRef;
    const handlers = registry.get(id) ?? [];

    registry.set(id, [...handlers, entry]);

    return () => {
      const rest = (registry.get(id) ?? []).filter((item) => item !== entry);

      if (rest.length === 0) registry.delete(id);
      else registry.set(id, rest);
    };
  }, [enabled, handlerRef, id, registry]);
}

/** The shortcut's current chord as a Kbd label and an `aria-keyshortcuts`
 *  value. SSR and hydration render the default chord with Ctrl. */
export function useShortcutHint(id: ShortcutId) {
  const chord = chordFor(useBindings(), id);
  const modifierKey = usePrimaryModifierKey();

  return {
    label: formatChord(chord, modifierKey),
    aria: ariaKeyShortcut(chord, modifierKey === "⌘"),
  };
}

export type ShortcutRow = {
  def: ShortcutDefinition;
  chord: Chord;
  customized: boolean;
  usage: ShortcutUsage | undefined;
  conflicts: Array<ShortcutDefinition>;
};

/** Everything the keyboard settings page shows and changes. */
export function useShortcutSettings() {
  const bindings = useBindings();

  const usage = useSyncExternalStore(
    usageStore.subscribe,
    usageStore.getSnapshot,
    usageStore.getServerSnapshot,
  );

  const rows = useMemo((): Array<ShortcutRow> => {
    const chords = SHORTCUTS.map((def) => ({
      id: def.id,
      chord: chordFor(bindings, def.id),
    }));

    const conflicts = findConflicts(chords);

    return SHORTCUTS.map((def, index) => ({
      def,
      chord: chords[index]!.chord,
      customized: bindings[def.id] !== undefined,
      usage: usage[def.id],
      conflicts: (conflicts.get(def.id) ?? []).map((other) =>
        SHORTCUTS_BY_ID.get(other)!,
      ),
    }));
  }, [bindings, usage]);

  return {
    rows,
    setBinding: (id: ShortcutId, chord: Chord) =>
      bindingsStore.set({ ...bindingsStore.getSnapshot(), [id]: chord }),
    resetBinding: (id: ShortcutId) => {
      const { [id]: _removed, ...rest } = bindingsStore.getSnapshot();

      bindingsStore.set(rest);
    },
    resetAll: () => bindingsStore.set(NO_BINDINGS),
    clearUsage: () => usageStore.set(NO_USAGE),
  };
}
