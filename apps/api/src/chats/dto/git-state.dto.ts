import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

import { renderGitObservation } from '../../git-state/git-state-render';
import {
  GIT_ABSENCE_LABELS,
  type GitAbsenceReason,
  type GitObservation,
  type GitStateView,
} from '../../git-state/git-state-view';

const ABSENCE_REASONS = Object.keys(GIT_ABSENCE_LABELS);

export class GitStateUpstream {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  gone!: boolean;

  @ApiProperty({ type: 'integer', nullable: true })
  ahead!: number | null;

  @ApiProperty({ type: 'integer', nullable: true })
  behind!: number | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
}

export class GitStateHead {
  @ApiProperty()
  short!: string;

  @ApiProperty()
  oid!: string;
}

export class GitStateOperation {
  @ApiProperty()
  kind!: string;

  @ApiPropertyOptional({ type: 'integer' })
  step?: number;

  @ApiPropertyOptional({ type: 'integer' })
  total?: number;
}

export class GitStateCounts {
  @ApiProperty({ type: 'integer' })
  staged!: number;

  @ApiProperty({ type: 'integer' })
  unstaged!: number;

  @ApiProperty({ type: 'integer' })
  untracked!: number;

  @ApiProperty({ type: 'integer' })
  conflicted!: number;
}

export class GitStateEntry {
  @ApiProperty()
  xy!: string;

  @ApiProperty()
  path!: string;

  @ApiPropertyOptional()
  from?: string;
}

export class GitStateCommit {
  @ApiProperty()
  short!: string;

  @ApiProperty()
  subject!: string;
}

export class GitStateRemote {
  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'The normalized remote; never a raw URL or a credential.',
  })
  value!: string;
}

export class GitStateOkResponse {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty()
  toplevel!: string;

  @ApiProperty({
    description: 'Posix, relative to the toplevel; empty at the toplevel.',
  })
  rootRelative!: string;

  @ApiProperty({ type: String, nullable: true })
  branch!: string | null;

  @ApiProperty()
  detached!: boolean;

  @ApiProperty({ type: GitStateHead, nullable: true })
  head!: GitStateHead | null;

  @ApiProperty({ type: GitStateUpstream, nullable: true })
  upstream!: GitStateUpstream | null;

  @ApiProperty({ type: GitStateOperation, nullable: true })
  operation!: GitStateOperation | null;

  @ApiProperty({ type: GitStateCounts })
  counts!: GitStateCounts;

  @ApiProperty({ type: [GitStateEntry] })
  entries!: ReadonlyArray<GitStateEntry>;

  @ApiProperty({ type: 'integer' })
  omitted!: number;

  @ApiProperty({ type: [String] })
  submodules!: ReadonlyArray<string>;

  @ApiProperty({ type: [GitStateCommit] })
  commits!: ReadonlyArray<GitStateCommit>;

  @ApiProperty({ type: [GitStateRemote] })
  remotes!: ReadonlyArray<GitStateRemote>;

  @ApiProperty({ type: 'integer' })
  remotesOmitted!: number;
}

export class GitStateUnboundResponse {
  @ApiProperty({ enum: ['unbound'] })
  status!: 'unbound';
}

export class GitStateNotARepositoryResponse {
  @ApiProperty({ enum: ['not_a_repository'] })
  status!: 'not_a_repository';

  @ApiProperty({ description: '`not a git repository`' })
  line!: string;
}

export class GitStateUnavailableResponse {
  @ApiProperty({ enum: ['unavailable'] })
  status!: 'unavailable';

  @ApiProperty({ enum: ABSENCE_REASONS })
  reason!: GitAbsenceReason;

  @ApiProperty({ description: '`git state unavailable: <label>`' })
  line!: string;
}

export type GitStateResponse =
  | GitStateOkResponse
  | GitStateUnboundResponse
  | GitStateNotARepositoryResponse
  | GitStateUnavailableResponse;

export const GIT_STATE_RESPONSE_MODELS = [
  GitStateOkResponse,
  GitStateUnboundResponse,
  GitStateNotARepositoryResponse,
  GitStateUnavailableResponse,
];

/** The route's body: a union on `status`. */
export const GIT_STATE_RESPONSE_SCHEMA = {
  oneOf: GIT_STATE_RESPONSE_MODELS.map((model) => ({
    $ref: getSchemaPath(model),
  })),
  discriminator: {
    propertyName: 'status',
    mapping: {
      ok: getSchemaPath(GitStateOkResponse),
      unbound: getSchemaPath(GitStateUnboundResponse),
      not_a_repository: getSchemaPath(GitStateNotARepositoryResponse),
      unavailable: getSchemaPath(GitStateUnavailableResponse),
    },
  },
};

function upstreamFields(upstream: GitStateView['upstream']) {
  return upstream === null
    ? null
    : {
        name: upstream.name,
        gone: upstream.gone,
        ahead: upstream.ahead,
        behind: upstream.behind,
        updatedAt: upstream.updatedAt,
      };
}

function operationFields(operation: GitStateView['operation']) {
  return operation === null
    ? null
    : {
        kind: operation.kind,
        ...(operation.step !== undefined && { step: operation.step }),
        ...(operation.total !== undefined && { total: operation.total }),
      };
}

function listFields(view: GitStateView) {
  return {
    entries: view.entries.map((entry) => ({
      xy: entry.xy,
      path: entry.path,
      ...(entry.from !== undefined && { from: entry.from }),
    })),
    submodules: [...view.submodules],
    commits: view.commits.map(({ short, subject }) => ({ short, subject })),
    remotes: view.remotes.map(({ name, value }) => ({ name, value })),
  };
}

/**
 * The response copies each declared field, so a property later added to the
 * view never reaches the HTTP body unless the DTO declares it.
 */
function okFields(view: GitStateView) {
  const { staged, unstaged, untracked, conflicted } = view.counts;

  return {
    toplevel: view.toplevel,
    rootRelative: view.rootRelative,
    branch: view.branch,
    detached: view.detached,
    head:
      view.head === null
        ? null
        : { short: view.head.short, oid: view.head.oid },
    upstream: upstreamFields(view.upstream),
    operation: operationFields(view.operation),
    counts: { staged, unstaged, untracked, conflicted },
    ...listFields(view),
    omitted: view.omitted,
    remotesOmitted: view.remotesOmitted,
  };
}

export function toGitStateResponse(
  observation: GitObservation,
): GitStateResponse {
  switch (observation.kind) {
    case 'state':
      return { status: 'ok', ...okFields(observation.view) };
    case 'not_a_repository':
      return {
        status: 'not_a_repository',
        line: renderGitObservation(observation),
      };
    case 'unavailable':
      return {
        status: 'unavailable',
        reason: observation.reason,
        line: renderGitObservation(observation),
      };
  }
}
