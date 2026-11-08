import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { observeWorkspaceRoot } from '../git-state/git-observe-root';
import { GitSnapshotService } from '../git-state/git-snapshot.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import { ExecutorGit } from '../machines/executor-git.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { ChatsService } from './chats.service';
import { toGitStateResponse, type GitStateResponse } from './dto/git-state.dto';

/**
 * The owner's live git state of a Chat's Workspace root (design D10). The
 * owner-scoped Chat load comes first, so another owner's id reaches no git. The
 * owner reads state the tool permissions may not admit the model to read, so
 * the admission is open; the only gate is that this process can serve the
 * executor the Chat is bound to.
 */
@Injectable()
export class ChatGitStateService {
  constructor(
    @Inject(ChatsService)
    private readonly chats: Pick<ChatsService, 'getChatById'>,
    @Inject(GitSnapshotService)
    private readonly snapshots: Pick<GitSnapshotService, 'observe'>,
    @Inject(ExecutorGit)
    private readonly executors: Pick<ExecutorGit, 'locate'>,
    @Inject(MachineConnector)
    private readonly connector: Pick<MachineConnector, 'reachable'>,
  ) {}

  async read(chatId: string, ownerUserId: string): Promise<GitStateResponse> {
    const chat = await this.chats.getChatById(chatId, ownerUserId);
    if (chat === undefined)
      throw new NotFoundException(`Chat ${chatId} not found`);
    const root = chat.workspaceRoot;
    if (root === null) return { status: 'unbound' };

    let machine: string | undefined;
    const observation = await observeWorkspaceRoot(
      {
        snapshots: this.snapshots,
        executors: {
          // A binding on another executor than the one this root addresses
          // here is unavailable before any git call.
          locate: (address) => {
            const target = this.executors.locate(address);
            if (target.executorId !== chat.workspaceExecutorId) {
              throw new ExecutorGitError(
                'executor_unavailable',
                'The Chat is bound to another executor.',
              );
            }
            machine = target.machine;
            return target;
          },
        },
      },
      {
        root,
        admit: () => true,
        // A key of its own: a Run attempt's cached verdict never answers here.
        reachable: () =>
          machine === undefined
            ? Promise.resolve(true)
            : this.connector.reachable(machine, `route:${crypto.randomUUID()}`),
      },
    );
    return toGitStateResponse(observation);
  }
}
