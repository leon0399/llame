/**
 * Live update protocol: database change notifications in, owner-scoped
 * WebSocket messages out. Pure functions only; the hub and gateway own I/O.
 *
 * Every message is an invalidation hint or a run progress summary. None
 * carries record content: clients refetch records through the RLS-scoped
 * HTTP API.
 */

import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import { TERMINAL_RUN_STATUSES } from '../runs/run-status';

/** The NOTIFY channel `llame_notify_change` writes to. */
export const LIVE_CHANGES_CHANNEL = 'llame_changes';

export type ChangeOp = 'insert' | 'update' | 'delete';

export type ChangeNotification =
  | { k: 'chat'; op: ChangeOp; owner: string; chat: string }
  | { k: 'project'; op: ChangeOp; owner: string; project: string }
  | { k: 'pin'; op: ChangeOp; owner: string; item: string }
  | {
      k: 'run';
      op: ChangeOp;
      owner: string;
      chat: string;
      run: string;
      status: string;
    }
  | {
      k: 'run_event';
      op: ChangeOp;
      owner: string;
      chat: string;
      run: string;
      seq: number;
      type: string;
    };

export type RunPhase = 'queued' | 'thinking' | 'tool' | 'writing' | 'finished';

export type LiveChange = 'created' | 'updated' | 'deleted';

export type LiveMessage =
  | { type: 'chat.changed'; chatId: string; change: LiveChange }
  | { type: 'project.changed'; projectId: string; change: LiveChange }
  | { type: 'pin.changed'; itemId: string }
  | {
      type: 'run.progress';
      runId: string;
      chatId: string;
      status: string;
      phase: RunPhase;
      step: number;
    }
  | { type: 'resync' };

const OPS: ReadonlySet<string> = new Set(['insert', 'update', 'delete']);

function isOp(value: unknown): value is ChangeOp {
  return isString(value) && OPS.has(value);
}

/** Field reader over a parsed payload; `undefined` unless it is a non-empty string. */
function str(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return isString(value) && value !== '' ? value : undefined;
}

/**
 * Parse one NOTIFY payload. Returns `undefined` for anything malformed or
 * ownerless, so a bad notification is dropped rather than broadcast.
 */
export function parseChangeNotification(
  raw: string,
): ChangeNotification | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isOp(parsed['op'])) return undefined;
  const op = parsed['op'];
  const owner = str(parsed, 'owner');
  if (!owner) return undefined;
  switch (parsed['k']) {
    case 'chat': {
      const chat = str(parsed, 'chat');
      return chat ? { k: 'chat', op, owner, chat } : undefined;
    }
    case 'project': {
      const project = str(parsed, 'project');
      return project ? { k: 'project', op, owner, project } : undefined;
    }
    case 'pin': {
      const item = str(parsed, 'item');
      return item ? { k: 'pin', op, owner, item } : undefined;
    }
    case 'run':
      return parseRun(parsed, op, owner);
    case 'run_event':
      return parseRunEvent(parsed, op, owner);
    default:
      return undefined;
  }
}

function parseRun(
  parsed: UnknownRecord,
  op: ChangeOp,
  owner: string,
): ChangeNotification | undefined {
  const chat = str(parsed, 'chat');
  const run = str(parsed, 'run');
  const status = str(parsed, 'status');
  if (!chat || !run || !status) return undefined;
  return { k: 'run', op, owner, chat, run, status };
}

function parseRunEvent(
  parsed: UnknownRecord,
  op: ChangeOp,
  owner: string,
): ChangeNotification | undefined {
  const chat = str(parsed, 'chat');
  const run = str(parsed, 'run');
  const type = str(parsed, 'type');
  const seq = parsed['seq'];
  if (!chat || !run || !type || !isNumber(seq)) return undefined;
  return { k: 'run_event', op, owner, chat, run, seq, type };
}

const CHANGE_OF_OP: Record<ChangeOp, LiveChange> = {
  insert: 'created',
  update: 'updated',
  delete: 'deleted',
};

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_RUN_STATUSES);
const FINISHED_CAP = 1024;

/** Phase implied by one run event type; `undefined` leaves the phase unchanged. */
export function phaseOfEvent(eventType: string): RunPhase | undefined {
  switch (eventType) {
    case 'model.requested':
    case 'reasoning.delta':
    case 'tool.completed':
      return 'thinking';
    case 'model.delta':
      return 'writing';
    case 'tool.requested':
    case 'tool.started':
      return 'tool';
    default:
      return undefined;
  }
}

type RunState = {
  chatId: string;
  status: string;
  phase: RunPhase;
  step: number;
};

type RunChange = { status?: string; phase?: RunPhase; stepped?: number };

/** Fold one change into a Run's summary. */
function nextRunState(
  previous: RunState | undefined,
  chatId: string,
  change: RunChange,
): RunState {
  // A Run first seen through a progress event (the hub started mid-Run) is
  // already executing.
  const status =
    change.status ??
    previous?.status ??
    (change.phase ? 'running_model' : 'queued');
  return {
    chatId,
    status,
    phase: TERMINAL.has(status)
      ? 'finished'
      : (change.phase ?? previous?.phase ?? 'queued'),
    step: (previous?.step ?? 0) + (change.stepped ?? 0),
  };
}

/**
 * Per-process run progress tracker. Folds run and run-event notifications into
 * one summary per Run and emits a `run.progress` message only when status,
 * phase or step changes, so a stream of `model.delta` events produces one
 * message, not one per delta. Terminal Runs are forgotten, which bounds the
 * map by the number of in-flight Runs.
 */
export class RunProgressTracker {
  private readonly runs = new Map<string, RunState>();
  private readonly finished = new Set<string>();

  /** Owner-scoped message for one notification, or `undefined` when nothing changed. */
  apply(n: ChangeNotification): LiveMessage | undefined {
    switch (n.k) {
      case 'chat':
        return {
          type: 'chat.changed',
          chatId: n.chat,
          change: CHANGE_OF_OP[n.op],
        };
      case 'project':
        return {
          type: 'project.changed',
          projectId: n.project,
          change: CHANGE_OF_OP[n.op],
        };
      case 'pin':
        return { type: 'pin.changed', itemId: n.item };
      case 'run':
        return this.update(n.run, n.chat, { status: n.status });
      case 'run_event':
        return this.onRunEvent(n.run, n.chat, n.type);
    }
  }

  private onRunEvent(
    runId: string,
    chatId: string,
    eventType: string,
  ): LiveMessage | undefined {
    const terminal = /^run\.(completed|failed|cancelled|expired)$/.exec(
      eventType,
    );
    if (terminal) {
      return this.update(runId, chatId, { status: terminal[1] });
    }
    const phase = phaseOfEvent(eventType);
    const stepped = eventType === 'model.requested' ? 1 : 0;
    if (!phase && !stepped) return undefined;
    return this.update(runId, chatId, { phase, stepped });
  }

  private update(
    runId: string,
    chatId: string,
    change: RunChange,
  ): LiveMessage | undefined {
    // A Run already reported terminal stays reported: a trailing run event or a
    // duplicate status notification must not resurrect it.
    if (this.finished.has(runId)) return undefined;
    const previous = this.runs.get(runId);
    const next = nextRunState(previous, chatId, change);
    const terminal = TERMINAL.has(next.status);
    if (
      previous &&
      next.status === previous.status &&
      next.phase === previous.phase &&
      next.step === previous.step
    ) {
      return undefined;
    }
    if (terminal) {
      this.runs.delete(runId);
      // Bounded: past the cap a very late straggler can at worst emit one
      // stale non-terminal message.
      if (this.finished.size >= FINISHED_CAP) this.finished.clear();
      this.finished.add(runId);
    } else {
      this.runs.set(runId, next);
    }
    return {
      type: 'run.progress',
      runId,
      chatId,
      status: next.status,
      phase: next.phase,
      step: next.step,
    };
  }
}
