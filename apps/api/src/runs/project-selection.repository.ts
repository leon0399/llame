/**
 * Persistence of the Project selection a Run freezes at first dispatch
 * (project-discovery D2).
 *
 * Three operations share one invariant: a Run's selected Project guidance is
 * decided once, before the first model request, and every later attempt,
 * segment, recovery, quota wake, and compaction reuses it. Nothing here reads
 * live Project rows after `run.project_bound` exists, and nothing here treats
 * a failed read as "no Project".
 *
 * Ownership is enforced twice: every statement filters the owner id and the
 * tenant transaction's RLS policies filter it again. A missing Chat or an
 * inconsistent affiliation is a failure — never a null selection, which is
 * reserved for a Chat the owner really left unfiled.
 */
import { and, eq, sql } from 'drizzle-orm';

import { canonicalJson } from '../canonical-json';
import { chats, messages, projects, runs } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ModelContextExecutionError } from './model-context-errors';
import {
  parseProjectBoundPayload,
  type ProjectBoundPayload,
  type ProjectSelection,
} from './project-selection';
import { dispatchedRunPredicate, RunEventsRepository } from './runs-repository';

/** Fixed, value-free diagnostics: authored Project text never reaches them. */
const INVALID_SELECTION =
  'The Project selection payload is invalid or unsupported.';

const DISPATCHED_WITHOUT_SELECTION =
  'The Run was dispatched before a Project selection was recorded.';

const MISSING_RUN = 'Project selection requires an owned Run.';
const MISSING_CHAT = 'Project selection requires an owned Chat.';

const INCONSISTENT_AFFILIATION =
  'The Chat Project affiliation has no owned Project.';

/**
 * Resolve the Project selection for a Run's next attempt.
 *
 * A recorded `run.project_bound` event is authoritative and is restored
 * without a live Project read, even when the Chat has since moved, been
 * unfiled, or lost its Project. Without that event, a Run whose existing
 * dispatch record (a `model.requested` event, or the run row's persisted
 * availability/completion state) proves it already dispatched fails closed
 * rather than inventing a selection from current rows. Only a Run with no
 * prior dispatch resolves the Chat's current owned affiliation, in this tenant
 * transaction.
 */
export async function resolveRunProjectSelection(
  tx: Db,
  run: { runId: string; chatId: string; userId: string },
): Promise<ProjectBoundPayload> {
  const events = new RunEventsRepository(tx);

  const bound = await events.findFirstByType(
    run.runId,
    run.userId,
    'run.project_bound',
  );

  if (bound !== undefined) {
    const selection = parseProjectBoundPayload(bound.payload);

    if (selection === undefined) {
      throw new ModelContextExecutionError(INVALID_SELECTION);
    }

    return selection;
  }

  const requested = await events.findFirstByType(
    run.runId,
    run.userId,
    'model.requested',
  );

  if (requested !== undefined) {
    throw new ModelContextExecutionError(DISPATCHED_WITHOUT_SELECTION);
  }

  const prior = await priorDispatchEvidence(tx, run);

  if (prior === 'missing') {
    throw new ModelContextExecutionError(MISSING_RUN);
  }

  if (prior === 'dispatched') {
    throw new ModelContextExecutionError(DISPATCHED_WITHOUT_SELECTION);
  }

  return resolveLiveProjectSelection(tx, run);
}

/** The run row's persisted dispatch state, as the existing predicate reads it. */
async function priorDispatchEvidence(
  tx: Db,
  run: { runId: string; userId: string },
): Promise<'missing' | 'dispatched' | 'undispatched'> {
  // The availability-only legacy case: an older worker wrote
  // `turn_tool_availability` (or completed the Run) without the selection
  // event. Reusing the existing dispatch predicate keeps this check identical
  // to every other "already dispatched" read.
  const [row] = await tx
    .select({
      id: runs.id,
      dispatched: sql<boolean>`${dispatchedRunPredicate()}`,
    })
    .from(runs)
    .where(and(eq(runs.id, run.runId), eq(runs.userId, run.userId)))
    .limit(1);

  if (row === undefined) return 'missing';

  return row.dispatched ? 'dispatched' : 'undispatched';
}

/**
 * One statement reads the owned Chat and its owned Project together, so a
 * concurrent move or unfiling cannot pair an affiliation from one snapshot
 * with details from another. A Chat with no affiliation is a real null
 * selection; a non-null affiliation whose Project row is absent is a failure,
 * not an invented null.
 */
async function resolveLiveProjectSelection(
  tx: Db,
  run: { chatId: string; userId: string },
): Promise<ProjectBoundPayload> {
  const [row] = await tx
    .select({
      projectId: chats.projectId,
      projectName: projects.name,
      projectDescription: projects.description,
      projectInstructions: projects.instructions,
    })
    .from(chats)
    .leftJoin(
      projects,
      and(
        eq(projects.id, chats.projectId),
        eq(projects.ownerUserId, run.userId),
      ),
    )
    .where(and(eq(chats.id, run.chatId), eq(chats.ownerUserId, run.userId)))
    .limit(1);

  if (row === undefined) {
    throw new ModelContextExecutionError(MISSING_CHAT);
  }

  if (row.projectId === null) {
    return { v: 1, project: null };
  }

  if (row.projectName === null) {
    throw new ModelContextExecutionError(INCONSISTENT_AFFILIATION);
  }

  return projectBoundSelection({
    id: row.projectId,
    name: row.projectName,
    description: row.projectDescription,
    instructions: row.projectInstructions,
    locator: `projects://${row.projectId}`,
  });
}

/** Validate the assembled live selection exactly as a recovered one is. */
function projectBoundSelection(project: ProjectSelection): ProjectBoundPayload {
  const selection = parseProjectBoundPayload({ v: 1, project });

  if (selection === undefined) {
    throw new ModelContextExecutionError(INVALID_SELECTION);
  }

  return selection;
}

/**
 * Record the selection under the caller's existing attempt fence, immediately
 * before its `model.requested` append in the dispatch transaction.
 *
 * The event is write-once. If it exists, the supplied selection must mean
 * exactly the same thing (canonical comparison of the parsed values) and
 * nothing is appended, so retries and recovery are idempotent. The Run is
 * never rebound. An absent event on a Run that already has `model.requested`
 * proves the transaction is not the first dispatch and fails closed. Only the
 * first successful dispatch appends, including for a real null selection.
 *
 * The availability row is deliberately not dispatch proof here: `dispatchAttempt`
 * writes it in this same transaction before this call.
 */
export async function recordRunProjectSelection(
  tx: Db,
  run: { runId: string; userId: string },
  selection: ProjectBoundPayload,
): Promise<void> {
  const payload = parseProjectBoundPayload(selection);

  if (payload === undefined) {
    throw new ModelContextExecutionError(INVALID_SELECTION);
  }

  const events = new RunEventsRepository(tx);

  const bound = await events.findFirstByType(
    run.runId,
    run.userId,
    'run.project_bound',
  );

  if (bound !== undefined) {
    const recorded = parseProjectBoundPayload(bound.payload);

    if (
      recorded === undefined ||
      canonicalJson(recorded) !== canonicalJson(payload)
    ) {
      throw new ModelContextExecutionError(INVALID_SELECTION);
    }

    return;
  }

  const requested = await events.findFirstByType(
    run.runId,
    run.userId,
    'model.requested',
  );

  if (requested !== undefined) {
    throw new ModelContextExecutionError(DISPATCHED_WITHOUT_SELECTION);
  }

  await events.append(run.runId, 'run.project_bound', payload);
}

/**
 * Whether this owner's Chat has ever durably received Project context.
 *
 * This is a historical-presence fact, not the active-epoch told comparison:
 * every stored message row counts, including rows a checkpoint absorbed,
 * because the summary may retain their guidance. One owner-scoped EXISTS over
 * `json_array_elements` (the `json` column's set-returning function, matching
 * the existing visible-text read) avoids loading the transcript and stores no
 * extra state. Only a text-bearing `data-context` part authored by this
 * revision's `project` producer counts; metadata-only items do not.
 */
export async function hasProjectContextHistory(
  tx: Db,
  chatId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ present: sql<number>`1` })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(chats.ownerUserId, userId),
        sql`exists (
          select 1
          from json_array_elements(${messages.parts}) as part
          where part ->> 'type' = 'data-context'
            and part -> 'data' ->> 'producer' = 'project'
            and part -> 'data' ->> 'text' ~ '\\S'
        )`,
      ),
    )
    .limit(1);

  return row !== undefined;
}
