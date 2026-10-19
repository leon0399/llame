/**
 * Reads the records a live update carries, as their owner and through the
 * same repositories and response mappers as the HTTP API, so a record pushed
 * over the socket is exactly what the matching HTTP endpoint returns and is
 * subject to the same row-level security. The one instance-wide record, a
 * Machine, is read the way its own endpoint reads it, without an owner.
 */

import { Inject, Injectable } from '@nestjs/common';

import { ChatsRepository } from '../chats/chats-repository';
import {
  toChatListItemResponse,
  type ChatListItemResponse,
} from '../chats/dto/chats.dto';
import { MessagesRepository } from '../chats/messages-repository';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import {
  toMachineResponse,
  type MachineResponse,
} from '../machines/dto/machines.dto';
import { machineStatusView } from '../machines/machines-status';
import { MachinesStatusRepository } from '../machines/machines-status.repository';
import {
  toPinnedItemResponse,
  type PinnedItemResponse,
} from '../pins/dto/pins.dto';
import { PinsRepository } from '../pins/pins-repository';
import {
  toProjectResponse,
  type ProjectResponse,
} from '../projects/dto/projects.dto';
import { ProjectsRepository } from '../projects/projects-repository';
import { toRunResponse, type RunResponse } from '../runs/dto/runs.dto';
import { RunsRepository } from '../runs/runs-repository';

/** Record reads the hub needs; an absent record is `undefined`. */
export type LiveRecordLoader = {
  chat(
    owner: string,
    chatId: string,
  ): Promise<ChatListItemResponse | undefined>;
  machine(name: string): Promise<MachineResponse | undefined>;
  project(
    owner: string,
    projectId: string,
  ): Promise<ProjectResponse | undefined>;
  pins(owner: string): Promise<Array<PinnedItemResponse>>;
  run(owner: string, runId: string): Promise<RunResponse | undefined>;
};

export const LIVE_RECORD_LOADER = Symbol('LIVE_RECORD_LOADER');

@Injectable()
export class TenantLiveRecordLoader implements LiveRecordLoader {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    private readonly machines: MachinesStatusRepository,
  ) {}

  chat(owner: string, chatId: string) {
    return this.tenantDb.runAs(owner, async (tx) => {
      const [chat, [lastMessage]] = await Promise.all([
        new ChatsRepository(tx).findById(chatId, owner),
        new MessagesRepository(tx).findLatestPerOwnedChat(owner, chatId),
      ]);
      return chat ? toChatListItemResponse(chat, lastMessage) : undefined;
    });
  }

  /** The row the trigger named, in the same shape `GET /api/v1/machines` uses. */
  async machine(name: string): Promise<MachineResponse | undefined> {
    const row = await this.machines.findForLive(name);
    return row && toMachineResponse(machineStatusView(name, row, Date.now()));
  }

  project(owner: string, projectId: string) {
    return this.tenantDb.runAs(owner, async (tx) => {
      const project = await new ProjectsRepository(tx).findById(
        projectId,
        owner,
      );
      return project ? toProjectResponse(project) : undefined;
    });
  }

  pins(owner: string) {
    return this.tenantDb.runAs(owner, async (tx) =>
      (await new PinsRepository(tx).listWithCards(owner)).map(
        toPinnedItemResponse,
      ),
    );
  }

  run(owner: string, runId: string) {
    return this.tenantDb.runAs(owner, async (tx) => {
      const run = await new RunsRepository(tx).findById(runId, owner);
      return run ? toRunResponse(run) : undefined;
    });
  }
}
