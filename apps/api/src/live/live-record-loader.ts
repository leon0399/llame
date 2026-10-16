/**
 * Reads the records a live update carries, as their owner and through the
 * same repositories and response mappers as the HTTP API, so a record pushed
 * over the socket is exactly what the matching HTTP endpoint returns and is
 * subject to the same row-level security.
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
