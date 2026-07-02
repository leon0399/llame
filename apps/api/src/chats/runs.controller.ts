import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
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
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { ListRunEventsQuery, RunResponse, toRunResponse } from './dto/runs.dto';

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
  constructor(private readonly tenantDb: TenantDbService) {}

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
    let cursor = query.after_sequence ?? 0;
    let terminalSeen = TERMINAL_STATUSES.has(run.status);
    let sendDone = false;

    try {
      for (;;) {
        if (response.writableEnded || request.destroyed) {
          return;
        }
        if (Date.now() - startedAt > MAX_STREAM_MS) {
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
        if (response.writableEnded || request.destroyed) {
          return;
        }
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          break; // client reconnects with its cursor
        }

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
          if (response.writableEnded || request.destroyed) {
            return;
          }
        }
      }

      if (sendDone) {
        response.write('data: [DONE]\n\n');
      }
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
