/**
 * This turn's skill-catalog state: the baseline the prompt renders from, and
 * the notice the rail carries (system-provided-skills D4/D6).
 *
 * Split from `turn-context.ts` because it owns a complete decision — reuse
 * within a compaction epoch, resolve a new one, and diff the advertised set
 * against what the chat was last told — and because that decision has a
 * transaction of its own to join rather than a place in the prompt assembly.
 */

import { type Db } from '../db/tenant-db.service';
import { type Chat, type SkillCatalogBaseline } from '../db/schema';
import { ChatsRepository } from './chats-repository';
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
};

/**
 * The baseline to render and the notice to emit.
 *
 * Reuse is checked before the configured list: a stored baseline is this epoch's
 * frozen advertisement, and emptying the source list must not silently
 * unadvertise a catalog the chat is still told about. Only resolving a NEW
 * baseline requires a configured source.
 */
export async function resolveTurnSkillState(
  deps: SkillTurnStateDeps,
  input: {
    readonly tx: Db;
    readonly chat: Chat;
    readonly chatId: string;
    readonly ownerUserId: string;
    readonly runId: string;
    readonly latestCompactionId: string | null;
    /** Whether this turn's bound model template renders the catalog at all. */
    readonly modelReferencesSkills: boolean;
  },
): Promise<SkillTurnState> {
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
    return {
      baseline: stored,
      notice: deriveCatalogNotice({
        deps,
        told: input.chat.skillCatalogTold ?? toldFromBaseline(stored),
        runId: input.runId,
        modelReferencesSkills: input.modelReferencesSkills,
      }),
    };
  }
  return startSkillEpoch(deps, input);
}

/**
 * Start a new epoch: resolve the catalog, freeze it on the chat, and reset the
 * told state to that baseline.
 *
 * No delta is computed across the boundary — the baseline is itself what the
 * model is now shown, and the told state it establishes is what a later turn
 * compares against, so old notices are never replayed.
 */
async function startSkillEpoch(
  deps: SkillTurnStateDeps,
  input: {
    readonly tx: Db;
    readonly chatId: string;
    readonly ownerUserId: string;
    readonly latestCompactionId: string | null;
  },
): Promise<SkillTurnState> {
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
    deps.reportUnavailable?.(catalog.getSnapshot().diagnostics);
    return { baseline: undefined, notice: undefined };
  }
  // Both writes ride the accepted-turn transaction the caller owns, so they
  // commit with the message and Run or not at all.
  const chats = new ChatsRepository(input.tx);
  await chats.setSkillCatalogBaseline({
    chatId: input.chatId,
    ownerUserId: input.ownerUserId,
    baseline,
    rebakedFrom: input.latestCompactionId,
  });
  await chats.updateSkillCatalogTold(input.chatId, input.ownerUserId, [
    ...toldFromBaseline(baseline),
  ]);
  return { baseline, notice: undefined };
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
      input.deps.reportUnavailable?.(current.getSnapshot().diagnostics);
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
