import {
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response as ExpressResponse } from 'express';

import { CurrentUser } from '../auth/auth-context';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { TenantDbService } from '../db/tenant-db.service';
import { type Run, type RunEvent } from '../db/schema';
import { RunAbortRegistry } from './run-abort-registry';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import {
  ListRunEventsQuery,
  RunResponse,
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
@UseGuards(SessionAuthGuard)
@Controller('api/v1/runs')
export class RunsController {
  private readonly logger = new Logger(RunsController.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly aborts: RunAbortRegistry,
  ) {}

  @Get(':id')
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

  /**
   * Cancellation (#48) as a resource PATCH — `{status: 'cancelled'}` is the
   * only client-writable transition. Stamps cancel_requested_at (the durable,
   * cross-process signal: a queued run is settled at pickup) and aborts the
   * in-process controller when the run is executing here (mid-flight stop).
   * Idempotent: re-cancelling an already cancel-requested run returns 200.
   */
  @Patch(':id')
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

    const startedAt = Date.now();
    // Resume cursor: a native EventSource auto-reconnect re-requests the SAME
    // URL (stale or absent after_sequence) but sends the last `id:` it saw in
    // the Last-Event-ID header (SSE spec) — so the header, when present and
    // valid, wins over the query parameter.
    let cursor = lastEventId(request) ?? query.after_sequence ?? 0;
    let terminalSeen = TERMINAL_STATUSES.has(run.status);
    let sendDone = false;
    const clientGone = () => response.writableEnded || request.destroyed;
    const deadlineExceeded = () => Date.now() - startedAt > MAX_STREAM_MS;

    try {
      for (;;) {
        if (clientGone()) {
          return;
        }
        if (deadlineExceeded()) {
          break; // client reconnects with its cursor
        }

        const events = await this.tenantDb.runAs(userId, (tx) =>
          new RunEventsRepository(tx).listByRunId(id, userId, {
            afterSequence: cursor,
          }),
        );

        for (const event of events) {
          response.write(formatSseEvent(event));
          cursor = event.sequence;
        }

        // Terminal check AFTER draining, so the tail is never cut off. The
        // status is re-read each pass — the terminal event and status update
        // land in one transaction, but ordering against our poll is not
        // guaranteed, so the status row is the authority.
        if (terminalSeen && events.length === 0) {
          sendDone = true;
          break;
        }
        if (clientGone()) {
          return;
        }
        if (deadlineExceeded()) {
          break; // client reconnects with its cursor
        }

        // Status re-read is gated on drained events by the RunEventType
        // invariant (runs-repository.ts): terminal status transitions always
        // append their run.<status> event in the same transaction, so a
        // terminal run ALWAYS surfaces new events past any cursor — an idle
        // poll can never be hiding a terminal transition.
        if (!terminalSeen && events.length > 0) {
          const current = await this.tenantDb.runAs(userId, (tx) =>
            new RunsRepository(tx).findById(id, userId),
          );
          if (!current) {
            break; // run deleted mid-stream (chat delete cascades) — close out
          }
          terminalSeen = TERMINAL_STATUSES.has(current.status);
        }

        if (events.length === 0) {
          await sleep(EVENT_POLL_MS);
          if (clientGone()) {
            return;
          }
        }
      }

      if (sendDone) {
        response.write('data: [DONE]\n\n');
      }
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
