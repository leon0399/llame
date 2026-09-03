import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response as ExpressResponse } from 'express';

import { CurrentUser } from '../auth/auth-context';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import { type Run, type RunEvent } from '../db/schema';
import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { ModelContextSnapshotsRepository } from './model-context-snapshots.repository';
import {
  ContextReceiptResponse,
  ListRunEventsQuery,
  RunResponse,
  toContextReceiptResponse,
  toRunResponse,
  UpdateRunDto,
} from './dto/runs.dto';

/** Poll cadence for new events while a run is in flight. */
const EVENT_POLL_MS = 500;
/** Hard cap on one SSE connection — clients reconnect with their cursor. */
const MAX_STREAM_MS = 5 * 60 * 1000;

const TERMINAL_STATUSES: ReadonlySet<Run['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

/**
 * Run read surface (#48/#49, SPEC §9.4) — the durable run row and its
 * replayable event stream. Identity comes only from the verified session
 * (SessionAuthGuard); a cross-tenant run id is indistinguishable from a
 * missing one (404, no existence leak).
 */
@ApiTags('runs')
@Controller('api/v1/runs')
export class RunsController {
  private readonly logger = new Logger(RunsController.name);

  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    private readonly aborts: RunAbortRegistry,
  ) {}

  @Get(':id')
  @ApiOperation({ operationId: 'getRun' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RunResponse })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse({ description: 'Run not found or not owned' })
  async getRun(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RunResponse> {
    const run = await this.findOwnedRun(id, userId);
    return toRunResponse(run);
  }

  @Get(':id/context-receipt')
  @ApiOperation({ operationId: 'getRunContextReceipt' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ContextReceiptResponse })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse({ description: 'Run not found or not owned' })
  async getContextReceipt(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContextReceiptResponse> {
    const receipt = await this.tenantDb.runAs(userId, async (tx) => {
      const run = await new RunsRepository(tx).findById(id, userId);
      if (!run) {
        return undefined;
      }

      const snapshot = await new ModelContextSnapshotsRepository(
        tx,
      ).findByOwnedRun(id, userId);
      return snapshot ? toContextReceiptResponse(run, snapshot) : undefined;
    });

    if (!receipt) {
      throw new NotFoundException(`Run ${id} not found`);
    }

    return receipt;
  }

  /**
   * Cancellation (#48) as a resource PATCH — `{status: 'cancelled'}` is the
   * only client-writable transition. Stamps cancel_requested_at (the durable,
   * cross-process signal: a queued run is settled at pickup) and aborts the
   * in-process controller when the run is executing here (mid-flight stop).
   * Idempotent: re-cancelling an already cancel-requested run returns 200.
   */
  @Patch(':id')
  @ApiOperation({ operationId: 'updateRun' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateRunDto })
  @ApiOkResponse({ type: RunResponse })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse({ description: 'Run not found or not owned' })
  @ApiConflictResponse({ description: 'Run already finished' })
  async updateRun(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    // Validated but unread: `cancelled` is the only value the DTO admits.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() input: UpdateRunDto,
  ): Promise<RunResponse> {
    const requested = await this.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).requestCancel(id, userId),
    );

    if (requested) {
      this.aborts.abort(id);
      return toRunResponse(requested);
    }

    // The atomic guard missed: missing/cross-tenant (404), already terminal
    // (409), or already cancel-requested (idempotent 200).
    const run = await this.findOwnedRun(id, userId);
    if (TERMINAL_STATUSES.has(run.status)) {
      throw new ConflictException('Run already finished');
    }
    return toRunResponse(run);
  }

  /**
   * SSE replay by cursor (SPEC §9.4): emits every stored event after
   * `after_sequence` (each frame's SSE `id:` is its sequence), then keeps
   * polling until the run reaches a terminal status — a refresh resumes from
   * the last id seen with nothing lost. A completed run streams its tail and
   * closes immediately.
   */
  @Get(':id/events')
  @ApiOperation({ operationId: 'streamRunEvents' })
  @ApiTags('streaming')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description:
      'Server-sent events; each frame: id = event sequence, data = {sequence, eventType, payload, createdAt}',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse({ description: 'Run not found or not owned' })
  async streamRunEvents(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListRunEventsQuery,
    @Req() request: Request,
    @Res() response: ExpressResponse,
  ): Promise<void> {
    // 404 (including cross-tenant) is decided BEFORE headers are sent.
    const run = await this.findOwnedRun(id, userId);

    response.status(200);
    response.setHeader('content-type', 'text/event-stream');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.flushHeaders();

    // Resume cursor: a native EventSource auto-reconnect re-requests the SAME
    // URL (stale or absent after_sequence) but sends the last `id:` it saw in
    // the Last-Event-ID header (SSE spec) — so the header, when present and
    // valid, wins over the query parameter.
    const cursor = lastEventId(request) ?? query.after_sequence ?? 0;

    try {
      await this.pumpRunEvents({ run, userId, request, response, cursor });
    } catch (error) {
      // Headers are long flushed — the exception filter can't respond on this
      // stream. Log and fall through to the finally, which closes it; the
      // client reconnects with its cursor and loses nothing.
      this.logger.error(
        `Run event stream failed for run ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      response.end();
    }
  }

  /**
   * Re-checks a run's terminal status after new events drained. Status
   * re-read is gated on drained events by the RunEventType invariant
   * (runs-repository.ts): terminal status transitions always append their
   * run.<status> event in the same transaction, so a terminal run ALWAYS
   * surfaces new events past any cursor — an idle poll can never be hiding a
   * terminal transition. Returns `undefined` if the run was deleted mid-stream
   * (chat delete cascades) — the caller closes out.
   */
  private async refreshTerminalSeen(
    runId: string,
    userId: string,
  ): Promise<boolean | undefined> {
    const current = await this.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );
    return current ? TERMINAL_STATUSES.has(current.status) : undefined;
  }

  /** Fetches events past `cursor` and writes each as an SSE frame. */
  private async drainRunEvents(
    runId: string,
    userId: string,
    cursor: number,
    response: ExpressResponse,
  ): Promise<{ cursor: number; count: number }> {
    const events = await this.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId, {
        afterSequence: cursor,
      }),
    );
    let nextCursor = cursor;
    for (const event of events) {
      response.write(formatSseEvent(event));
      nextCursor = event.sequence;
    }
    return { cursor: nextCursor, count: events.length };
  }

  /**
   * The event-poll loop backing `streamRunEvents`, split out so the caller's
   * try/catch/finally isn't itself one more nesting level around every branch
   * below.
   */
  private async pumpRunEvents(options: {
    run: Run;
    userId: string;
    request: Request;
    response: ExpressResponse;
    cursor: number;
  }): Promise<void> {
    const { run, userId, request, response } = options;
    const startedAt = Date.now();
    let cursor = options.cursor;
    let terminalSeen = TERMINAL_STATUSES.has(run.status);
    let sendDone = false;
    const clientGone = () => response.writableEnded || request.destroyed;
    const deadlineExceeded = () => Date.now() - startedAt > MAX_STREAM_MS;

    // Both bail conditions below just stop the loop: `sendDone` is only ever
    // set right before its own break, so every other exit — gone client,
    // deadline, or a run deleted mid-stream — leaves it false and the
    // fallthrough `if (sendDone)` below is a no-op. A single `break` per
    // check is therefore behaviorally identical to returning early.
    for (;;) {
      if (clientGone() || deadlineExceeded()) {
        break; // gone: nothing left to send; deadline: client reconnects with its cursor
      }

      const drained = await this.drainRunEvents(
        run.id,
        userId,
        cursor,
        response,
      );
      cursor = drained.cursor;

      // Terminal check AFTER draining, so the tail is never cut off. The
      // status is re-read each pass — the terminal event and status update
      // land in one transaction, but ordering against our poll is not
      // guaranteed, so the status row is the authority.
      if (terminalSeen && drained.count === 0) {
        sendDone = true;
        break;
      }

      if (!terminalSeen && drained.count > 0) {
        const resolved = await this.refreshTerminalSeen(run.id, userId);
        if (resolved === undefined) {
          break;
        }
        terminalSeen = resolved;
      }

      // A gone or deadline-exceeded client naturally falls out on the next
      // pass through the top-of-loop check above.
      if (drained.count === 0) {
        await sleep(EVENT_POLL_MS);
      }
    }

    if (sendDone) {
      response.write('data: [DONE]\n\n');
    }
  }

  private async findOwnedRun(runId: string, userId: string): Promise<Run> {
    const run = await this.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findById(runId, userId),
    );
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    return run;
  }
}

/** The SSE Last-Event-ID request header, parsed to a usable cursor. */
function lastEventId(request: Request): number | undefined {
  const raw = request.headers['last-event-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Blank counts as absent: Number('') coerces to 0, which would override a
  // valid query cursor and force a full replay.
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatSseEvent(event: RunEvent): string {
  const data = JSON.stringify({
    sequence: event.sequence,
    eventType: event.eventType,
    payload: event.payload ?? null,
    createdAt: event.createdAt,
  });

  return `id: ${event.sequence}\ndata: ${data}\n\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
