import { Inject, Injectable } from '@nestjs/common';

import { type Db } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { TOOL_REGISTRY } from '../tools/registry';
import { matchesCodeOwnedToolId } from '../tools/tool-id';
import {
  type TurnToolCandidate,
  type ToolUnavailableReason,
} from '../tools/turn-tool-catalog';
import { type Tool } from '../tools/types';

const KNOWLEDGE_TOOL_IDS = ['knowledge_search', 'knowledge_read'] as const;

type KnowledgeToolId = (typeof KNOWLEDGE_TOOL_IDS)[number];

export type KnowledgeToolCandidateResolverInput = {
  /** The already-open accepted-turn transaction; never opened here. */
  readonly tx: Db;
  /** Trusted authenticated owner identity from the accepted Run. */
  readonly ownerUserId: string;
  readonly allowedToolRules: ReadonlyArray<string>;
  /** Testable/static code-owned inventory; defaults to the immutable registry. */
  readonly codeOwnedTools?: Iterable<Tool>;
};

export type KnowledgeToolCandidateResolverPort = Pick<
  KnowledgeToolCandidateResolver,
  'resolve'
>;

/**
 * Binds static Knowledge declarations to owner-aware availability at Run
 * acceptance. This capability intentionally sees only config presence: local
 * root and child validation belongs to the worker execution boundary.
 */
@Injectable()
export class KnowledgeToolCandidateResolver {
  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  resolve(
    input: KnowledgeToolCandidateResolverInput,
  ): Promise<Array<TurnToolCandidate>> {
    const tools = [...(input.codeOwnedTools ?? TOOL_REGISTRY.values())];
    const shouldResolveOwner = tools.some(
      (tool) =>
        isKnowledgeToolId(tool.id) &&
        tool.classification === 'read_only' &&
        matchesCodeOwnedToolId(tool.id, input.allowedToolRules),
    );

    const unavailableReason = shouldResolveOwner
      ? this.resolveUnavailableReason()
      : undefined;

    return Promise.resolve(
      tools.map((tool) => {
        if (unavailableReason !== undefined && isKnowledgeToolId(tool.id)) {
          return {
            source: { type: 'code_owned' as const },
            state: 'unavailable' as const,
            id: tool.id,
            classification: tool.classification,
            reason: unavailableReason,
          };
        }

        return {
          source: { type: 'code_owned' as const },
          state: 'available' as const,
          tool,
        };
      }),
    );
  }

  private resolveUnavailableReason(): ToolUnavailableReason | undefined {
    return this.instanceConfig.config.knowledge.root === undefined
      ? 'knowledge_space_unavailable'
      : undefined;
  }
}

function isKnowledgeToolId(id: string): id is KnowledgeToolId {
  return id === 'knowledge_search' || id === 'knowledge_read';
}
