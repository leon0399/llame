/**
 * This turn's skill-catalog state: the baseline the prompt renders from, the
 * notice the rail carries, and the chat-row writes the turn establishes
 * (system-provided-skills D4/D6).
 *
 * Split from the prompt assembly because it owns a complete decision — reuse
 * within a compaction epoch, resolve a new one, and diff the advertised set
 * against what the chat was last told — and because the writes that decision
 * produces belong to the attempt's own terminal transaction rather than to
 * prompt assembly.
 */

import { type Chat, type SkillCatalogBaseline } from '../db/schema';
import { type AuthoredContextItemPart } from './context-item';
import {
  createSkillCatalogNoticeItem,
  createSkillCatalogSnapshotItem,
} from './skill-catalog-item';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import {
  deriveSkillCatalogDelta,
  skillCatalogDeltaFits,
  toldFromBaseline,
} from '../skills/skill-catalog-notice';
import {
  baselineMatchesEpoch,
  resolveSkillCatalogBaseline,
} from '../skills/skill-prompt-baseline';

export type SkillTurnStateDeps = {
  /** Absent on an instance with no configured skill source. */
  readonly skillCatalog: SkillCatalogPort | undefined;
  readonly skillDirectories: ReadonlyArray<string>;
  /** Operator-facing reporting for an unreadable catalog; never model-facing. */
  readonly reportUnavailable?: (diagnostics: ReadonlyArray<string>) => void;
};

export type SkillCatalogNotice = {
  readonly item: AuthoredContextItemPart;
  /** The told state this notice establishes. */
  readonly told: ReadonlyArray<string>;
};

export type SkillTurnState = {
  readonly baseline: SkillCatalogBaseline | undefined;
  readonly notice: SkillCatalogNotice | undefined;
  /**
   * The baseline this turn freezes on the chat, present only when it starts an
   * epoch. Resolving it here and writing it there keeps the decision inside the
   * attempt that renders it: the write rides the attempt's OWN fenced terminal
   * transaction, so a losing attempt can never freeze a prompt the winner never
   * showed.
   */
  readonly freeze?: {
    readonly baseline: SkillCatalogBaseline;
    readonly rebakedFrom: string | null;
  };
  /**
   * The catalog names this turn leaves the chat told about, present only when
   * the turn advances that state — a started epoch, or a rendered notice. An
   * opted-out model or an unchanged catalog leaves it exactly where it was.
   */
  readonly told?: ReadonlyArray<string>;
};

/**
 * The baseline to render, the notice to emit, and the writes that follow.
 *
 * Reuse is checked before the configured list: a stored baseline is this epoch's
 * frozen advertisement, and emptying the source list must not silently
 * unadvertise a catalog the chat is still told about. Only resolving a NEW
 * baseline requires a configured source.
 *
 * Touches no database: the caller holds the chat row it passes in and applies
 * whatever `freeze`/`told` it gets back.
 */
export function resolveTurnSkillState(
  deps: SkillTurnStateDeps,
  input: {
    readonly chat: Chat;
    readonly runId: string;
    readonly latestCompactionId: string | null;
    /** Whether this turn's bound model template renders the catalog at all. */
    readonly modelReferencesSkills: boolean;
  },
): SkillTurnState {
  const stored = input.chat.skillCatalogBaseline;
  if (
    stored !== null &&
    baselineMatchesEpoch(
      stored,
      input.chat.skillCatalogRebakedFrom,
      input.latestCompactionId,
    )
  ) {
    // A continuing epoch: the prompt keeps the stored baseline, and the rail
    // discloses only what changed since the chat was last told. A chat whose
    // baseline predates this layer has no recorded told state, and adopting the
    // baseline for it is correct — its prompt already showed that catalog.
    const notice = deriveCatalogNotice({
      deps,
      told: input.chat.skillCatalogTold ?? toldFromBaseline(stored),
      runId: input.runId,
      modelReferencesSkills: input.modelReferencesSkills,
    });
    return {
      baseline: stored,
      notice,
      ...(notice !== undefined && { told: notice.told }),
    };
  }
  return startSkillEpoch(deps, input);
}

/**
 * Start a new epoch: resolve the catalog and hand back the baseline to freeze.
 *
 * No delta is computed across the boundary — the baseline is itself what the
 * model is now shown, and the told state it establishes is what a later turn
 * compares against, so old notices are never replayed. Both writes are the
 * caller's: it applies them in the attempt's own terminal transaction, together
 * with the turn they belong to.
 */
function startSkillEpoch(
  deps: SkillTurnStateDeps,
  input: {
    readonly chat: Chat;
    readonly latestCompactionId: string | null;
  },
): SkillTurnState {
  const catalog = deps.skillCatalog;
  if (catalog === undefined || deps.skillDirectories.length === 0) {
    return { baseline: undefined, notice: undefined };
  }

  const baseline = resolveSkillCatalogBaseline(catalog);
  if (baseline === undefined) {
    // Configured but unreadable, missing, or oversized: discovery could not run.
    // Freezing an empty advertisement would bind it to the chat for the epoch,
    // and `toldFromBaseline` would throw on the missing entries — during
    // accepted-turn preparation, failing the user's turn. Render no section and
    // let the next turn retry.
    reportUnavailableCatalog(deps, catalog);
    return { baseline: undefined, notice: undefined };
  }
  return {
    baseline,
    notice: undefined,
    freeze: { baseline, rebakedFrom: input.latestCompactionId },
    // The frozen advertisement is what this epoch's later turns diff against,
    // so the told state starts there rather than at whatever preceded it.
    told: toldFromBaseline(baseline),
  };
}

/**
 * The catalog notice for a continuing epoch.
 *
 * Gated on the bound model's template actually referencing `skills`: a turn on a
 * model that never renders the catalog emits nothing and leaves the told state
 * untouched, so the model is never told about a section it was not shown — and a
 * later switch to a rendering model announces everything since the baseline.
 *
 * A changed description or changed instruction content of a still-advertised
 * entry produces no notice here by construction: membership is compared by name,
 * and an addition renders whatever description the entry has now.
 */
function deriveCatalogNotice(input: {
  readonly deps: SkillTurnStateDeps;
  readonly told: ReadonlyArray<string>;
  readonly runId: string;
  readonly modelReferencesSkills: boolean;
}): SkillCatalogNotice | undefined {
  if (!input.modelReferencesSkills) return undefined;

  const current = input.deps.skillCatalog;
  let advertised: SkillCatalogBaseline;
  if (current === undefined) {
    // No configured source, or no catalog port at all, means the current
    // advertisement is EMPTY — not that there is nothing to say. A chat whose
    // baseline predates that change still carries those names in its frozen
    // prompt, so suppressing the delta would leave it attempting stale reads for
    // the rest of the epoch. The removals are exactly the point of the notice.
    advertised = EMPTY_BASELINE;
  } else {
    const resolved = resolveSkillCatalogBaseline(current);
    if (resolved === undefined) {
      // An unreadable catalog is NOT an empty advertisement: it is a failure to
      // read the catalog at all, and diffing it would announce removals that
      // have not happened. Skip, and let the next turn retry — but report it,
      // because the epoch-start path reports the same failure and the operator
      // would otherwise get no signal that discovery is failing mid-epoch.
      reportUnavailableCatalog(input.deps, current);
      return undefined;
    }
    advertised = resolved;
  }

  const delta = deriveSkillCatalogDelta({
    advertised: advertised.entries,
    told: input.told,
  });
  if (delta === null) return undefined;

  if (skillCatalogDeltaFits(delta)) {
    return {
      item: createSkillCatalogNoticeItem({
        runId: input.runId,
        payload: {
          kind: 'delta',
          added: [...delta.added],
          removed: [...delta.removed],
        },
      }),
      told: delta.told,
    };
  }
  return supersedeCatalog(input.runId, advertised);
}

/** The advertised set of an instance with no configured source. */
const EMPTY_BASELINE: SkillCatalogBaseline = { entries: [], omitted: 0 };

/**
 * Report an unreadable catalog through the operator-facing channel.
 *
 * The catalog's diagnostics name the failing source by its absolute path, and
 * this channel is a log line rather than the authenticated owner API that
 * publishes source paths deliberately: resolved host paths stay out of it, per
 * the repository's rule that server-resolved host paths remain private. The
 * operator already supplied these directories, so the reason survives — only
 * the path is replaced. Redaction lives here rather than at the reporter so
 * every reporter receives diagnostics that are already path-free.
 */
function reportUnavailableCatalog(
  deps: SkillTurnStateDeps,
  catalog: SkillCatalogPort,
): void {
  if (deps.reportUnavailable === undefined) return;
  // Longest first, so a nested source is replaced as a whole rather than
  // leaving its parent's remainder behind.
  const sources = [...deps.skillDirectories].sort(
    (left, right) => right.length - left.length,
  );
  let reasons = catalog.getSnapshot().diagnostics.join(' ');
  for (const source of sources) {
    if (source.length > 0)
      reasons = reasons.replaceAll(source, '<skill source>');
  }
  deps.reportUnavailable([reasons]);
}

/**
 * A delta that cannot be rendered within the bound is replaced by a snapshot of
 * the bounded current set, which supersedes every earlier catalog item. The told
 * state then equals that snapshot, so the next turn compares against what the
 * snapshot actually listed rather than the delta it replaced.
 */
function supersedeCatalog(
  runId: string,
  advertised: SkillCatalogBaseline,
): SkillCatalogNotice {
  return {
    item: createSkillCatalogSnapshotItem({
      runId,
      payload: {
        kind: 'snapshot',
        skills: [...advertised.entries],
        omitted: advertised.omitted,
      },
    }),
    told: toldFromBaseline(advertised),
  };
}
