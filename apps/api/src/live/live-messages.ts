/**
 * Live update protocol, server side: database change notifications in,
 * owner-scoped messages out. Pure functions only; the hub and gateway own
 * I/O.
 *
 * A notification is a pointer. The hub turns it into a record job, reads the
 * record as its owner through `LiveRecordLoader`, and sends the record in the
 * shape the HTTP API returns. Run progress needs no read: it is folded from
 * run event types alone.
 */

import {
  isBoolean,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import type { ChatListItemResponse } from '../chats/dto/chats.dto';
import { runStatus, type RunStatus } from '../db/schema/chats';
import type { PinnedItemResponse } from '../pins/dto/pins.dto';
import type { ProjectResponse } from '../projects/dto/projects.dto';
import type { RunResponse } from '../runs/dto/runs.dto';
import { TERMINAL_RUN_STATUSES } from '../runs/run-status';
import type { RunProgressMessage } from './generated/live-protocol';
import type { LiveRecordLoader } from './live-record-loader';

export type { LiveMessage } from './generated/live-protocol';

export type RunPhase = RunProgressMessage['phase'];

/**
 * A message before serialization: records as the API's response mappers
 * build them (`Date` fields). The hub serializes it to JSON and validates the
 * result against the generated wire schema before sending.
 */
export type ServerLiveMessage =
  | { type: 'chat.upserted'; chat: ChatListItemResponse }
  | { type: 'chat.deleted'; chatId: string }
  | { type: 'project.upserted'; project: ProjectResponse }
  | { type: 'project.deleted'; projectId: string }
  | { type: 'pins.replaced'; items: Array<PinnedItemResponse> }
  | { type: 'run.updated'; run: RunResponse }
  | RunProgressMessage
  | { type: 'resync' };

/** The NOTIFY channel `llame_notify_change` writes to. */
export const LIVE_CHANGES_CHANNEL = 'llame_changes';

export type ChangeNotification =
  | { k: 'chat'; owner: string; chat: string; deleted: boolean }
  | { k: 'project'; owner: string; project: string; deleted: boolean }
  | { k: 'pin'; owner: string }
  | { k: 'run'; owner: string; run: string; status: RunStatus }
  | { k: 'run_event'; owner: string; chat: string; run: string; type: string };

const RUN_STATUSES: ReadonlySet<string> = new Set(runStatus.enumValues);

function isRunStatus(value: string | undefined): value is RunStatus {
  return value !== undefined && RUN_STATUSES.has(value);
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
  if (!isRecord(parsed)) return undefined;
  const owner = str(parsed, 'owner');
  return owner ? parseKind(parsed, owner) : undefined;
}

function parseKind(
  parsed: UnknownRecord,
  owner: string,
): ChangeNotification | undefined {
  const deleted = parsed['deleted'];
  const chat = str(parsed, 'chat');
  const run = str(parsed, 'run');
  switch (parsed['k']) {
    case 'chat':
      return chat && isBoolean(deleted)
        ? { k: 'chat', owner, chat, deleted }
        : undefined;
    case 'project': {
      const project = str(parsed, 'project');
      return project && isBoolean(deleted)
        ? { k: 'project', owner, project, deleted }
        : undefined;
    }
    case 'pin':
      return { k: 'pin', owner };
    case 'run': {
      const status = str(parsed, 'status');
      return run && isRunStatus(status)
        ? { k: 'run', owner, run, status }
        : undefined;
    }
    case 'run_event': {
      const type = str(parsed, 'type');
      return chat && run && type
        ? { k: 'run_event', owner, chat, run, type }
        : undefined;
    }
    default:
      return undefined;
  }
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);
/** `run.<status>` events that end a Run. */
const TERMINAL_EVENTS: ReadonlySet<string> = new Set(
  TERMINAL_RUN_STATUSES.map((status) => `run.${status}`),
);
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

type RunProgress = { phase: RunPhase; step: number };

/**
 * Per-process run progress tracker. Folds run events into one phase-and-step
 * summary per Run and emits `run.progress` only when either changes, so a
 * stream of `model.delta` events produces one message, not one per delta. A
 * Run is forgotten once its status is terminal; its final state reaches
 * clients as `run.updated`. Needs no database read.
 */
export class RunProgressTracker {
  private readonly runs = new Map<string, RunProgress>();
  private readonly finished = new Set<string>();

  apply(n: ChangeNotification): RunProgressMessage | undefined {
    if (n.k === 'run' && TERMINAL.has(n.status)) {
      this.finish(n.run);
      return undefined;
    }
    if (n.k !== 'run_event') return undefined;
    if (TERMINAL_EVENTS.has(n.type)) {
      this.finish(n.run);
      return undefined;
    }
    if (this.finished.has(n.run)) return undefined;
    const phase = phaseOfEvent(n.type);
    const stepped = n.type === 'model.requested' ? 1 : 0;
    if (!phase && !stepped) return undefined;
    const previous = this.runs.get(n.run);
    const next: RunProgress = {
      phase: phase ?? previous?.phase ?? 'queued',
      step: (previous?.step ?? 0) + stepped,
    };
    if (
      previous !== undefined &&
      previous.phase === next.phase &&
      previous.step === next.step
    ) {
      return undefined;
    }
    this.runs.set(n.run, next);
    return {
      type: 'run.progress',
      runId: n.run,
      chatId: n.chat,
      phase: next.phase,
      step: next.step,
    };
  }

  private finish(runId: string): void {
    this.runs.delete(runId);
    // Bounded: past the cap a very late straggler can at worst emit one stale
    // progress message, which a client ignores for a finished Run.
    if (this.finished.size >= FINISHED_CAP) this.finished.clear();
    this.finished.add(runId);
  }
}

/**
 * The record read a notification calls for. `key` identifies the record, so
 * a second notification for a record whose read has not started yet is
 * coalesced into the first; a job without a key is never coalesced.
 */
export type RecordJob = {
  key?: string;
  load: (loader: LiveRecordLoader) => Promise<ServerLiveMessage | undefined>;
};

/** The record job for one notification; `undefined` when it needs none. */
export function recordJobFor(n: ChangeNotification): RecordJob | undefined {
  switch (n.k) {
    case 'chat':
      return n.deleted
        ? ready({ type: 'chat.deleted', chatId: n.chat })
        : chatJob(n.owner, n.chat);
    case 'project':
      return n.deleted
        ? ready({ type: 'project.deleted', projectId: n.project })
        : projectJob(n.owner, n.project);
    case 'pin':
      return {
        key: 'pins',
        load: async (loader) => ({
          type: 'pins.replaced',
          items: await loader.pins(n.owner),
        }),
      };
    case 'run':
      return runJob(n.owner, n.run);
    case 'run_event':
      return undefined;
  }
}

function chatJob(owner: string, chatId: string): RecordJob {
  return {
    key: `chat:${chatId}`,
    load: async (loader) => {
      const chat = await loader.chat(owner, chatId);
      return chat && { type: 'chat.upserted', chat };
    },
  };
}

function projectJob(owner: string, projectId: string): RecordJob {
  return {
    key: `project:${projectId}`,
    load: async (loader) => {
      const project = await loader.project(owner, projectId);
      return project && { type: 'project.upserted', project };
    },
  };
}

function runJob(owner: string, runId: string): RecordJob {
  return {
    key: `run:${runId}`,
    load: async (loader) => {
      const run = await loader.run(owner, runId);
      return run && { type: 'run.updated', run };
    },
  };
}

function ready(message: ServerLiveMessage): RecordJob {
  return { load: () => Promise.resolve(message) };
}
