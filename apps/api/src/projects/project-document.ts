/**
 * Pure renderers for the `projects://` read documents (project-discovery D5).
 *
 * A listing carries Project metadata only; a detail adds the literal stored
 * instructions and the owner's linked repositories with every registered
 * checkout. Both are pure: they sort copies of their inputs with
 * `compareCodePoints`, never touch a datastore, executor, or filesystem, and
 * never normalize a stored value.
 *
 * All model-facing framing lives in `prompts/project-document.md`. This module
 * supplies only view values: closed-kind booleans, ordinals, and each encoded
 * field body as a ready fenced block. Every authored or registered scalar is
 * contained as a JSON literal inside a fenced field body: JSON string encoding
 * first, then `\u` escapes for the Unicode `Cc` code points and U+2028/U+2029
 * that JSON leaves literal. A value longer than `MAX_FIELD_CHUNK_CODE_POINTS`
 * becomes a JSON array of chunks, one chunk per source line, so the widest
 * encoded line stays far below the 16000 code-unit native source-line ceiling
 * even for all-control and non-BMP text. Field text can therefore never forge a
 * heading, an entry, a label, or a cap notice; the Markdown outline exposes
 * generated headings only.
 */

import { compareCodePoints } from '../canonical-json';
import type { CheckoutKind, Project } from '../db/schema';
import { loadPackagedTemplate } from '../prompts/template-engine';

/** Longest scalar kept on one JSON literal line; longer values are chunked. */
const MAX_FIELD_CHUNK_CODE_POINTS = 1000;

/**
 * What a listing may read: no instructions, no repositories. Passing a full
 * `Project` row is assignable, so a caller never has to project first.
 */
export type ProjectListingRecord = Pick<
  Project,
  'id' | 'name' | 'description' | 'archivedAt'
>;

/** What a detail reads: the listing fields plus the literal instructions. */
export type ProjectDetailRecord = Pick<
  Project,
  'id' | 'name' | 'description' | 'instructions' | 'archivedAt'
>;

/** One owner-registered checkout, as the detail reports it verbatim. */
export type ProjectCheckoutView = {
  readonly id: string;
  readonly kind: CheckoutKind;
  readonly parentCheckoutId: string | null;
  readonly executorId: string;
  readonly locator: string;
};

/** One linked repository and every owner checkout registered for it. */
export type ProjectRepositoryView = {
  readonly id: string;
  readonly alias: string;
  readonly displayName: string;
  readonly canonicalRemote: string | null;
  readonly isPrimary: boolean;
  readonly checkouts: ReadonlyArray<ProjectCheckoutView>;
};

/** One encoded field: a fenced JSON body, plus whether it is a chunk array. */
type FencedScalar = {
  readonly fenced: string;
  readonly chunked: boolean;
};

type ListingEntryView = {
  readonly ordinal: number;
  readonly id: string;
  readonly name: FencedScalar;
  readonly description: FencedScalar;
  readonly archiveState: string;
  readonly locator: string;
};

type ProjectView = {
  readonly id: string;
  readonly name: FencedScalar;
  readonly description: FencedScalar;
  readonly descriptionAbsent: boolean;
  readonly archiveState: string;
  readonly instructions: FencedScalar;
  readonly instructionsAbsent: boolean;
};

type CheckoutEntryView = {
  readonly ordinal: number;
  readonly id: string;
  readonly kind: string;
  readonly parentCheckoutId: string;
  readonly executorId: FencedScalar;
  readonly locator: FencedScalar;
};

type RepositoryEntryView = {
  readonly ordinal: number;
  readonly id: string;
  readonly alias: FencedScalar;
  readonly displayName: FencedScalar;
  readonly canonicalRemote: FencedScalar;
  readonly canonicalRemoteAbsent: boolean;
  readonly primary: string;
  readonly hasCheckouts: boolean;
  readonly checkouts: ReadonlyArray<CheckoutEntryView>;
};

type ProjectDocumentView = {
  readonly isDetail: boolean;
  readonly archived: boolean;
  readonly hasProjects: boolean;
  readonly projects: ReadonlyArray<ListingEntryView>;
  readonly project: ProjectView | undefined;
  readonly hasRepositories: boolean;
  readonly repositories: ReadonlyArray<RepositoryEntryView>;
};

const renderProjectDocument = loadPackagedTemplate<ProjectDocumentView>(
  __dirname,
  'project-document',
);

/** Everything JSON string encoding leaves line-breaking or invisible. */
const UNSAFE_ENCODED_CHARACTER = /[\p{Cc}\u2028\u2029]/gu;

function escapeUnsafeCharacter(character: string): string {
  const hex = character.charCodeAt(0).toString(16).padStart(4, '0');

  return `\\u${hex}`;
}

function encodeJsonString(value: string): string {
  return JSON.stringify(value).replaceAll(
    UNSAFE_ENCODED_CHARACTER,
    escapeUnsafeCharacter,
  );
}

function encodeFieldValue(value: string | null): ReadonlyArray<string> {
  if (value === null) return ['null'];

  // At most 1000 UTF-16 units is at most 1000 code points.
  if (value.length <= MAX_FIELD_CHUNK_CODE_POINTS)
    return [encodeJsonString(value)];

  const codePoints = Array.from(value);

  if (codePoints.length <= MAX_FIELD_CHUNK_CODE_POINTS)
    return [encodeJsonString(value)];

  const chunks: Array<string> = [];

  for (
    let start = 0;
    start < codePoints.length;
    start += MAX_FIELD_CHUNK_CODE_POINTS
  ) {
    chunks.push(
      encodeJsonString(
        codePoints.slice(start, start + MAX_FIELD_CHUNK_CODE_POINTS).join(''),
      ),
    );
  }

  // A chunked value is always at least three body lines: `[`, chunks, `]`.
  return [
    '[',
    ...chunks.map(
      (chunk, index) => `  ${chunk}${index + 1 === chunks.length ? '' : ','}`,
    ),
    ']',
  ];
}

function longestBacktickRun(text: string): number {
  let longest = 0;

  for (const run of text.match(/`+/gu) ?? [])
    longest = Math.max(longest, run.length);

  return longest;
}

/** A fence one backtick longer than any run in its own body. */
function fencedJsonLines(bodyLines: ReadonlyArray<string>): Array<string> {
  const longestRun = longestBacktickRun(bodyLines.join('\n'));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));

  return [`${fence}json`, ...bodyLines, fence];
}

function fencedScalar(value: string | null): FencedScalar {
  const bodyLines = encodeFieldValue(value);

  return {
    fenced: fencedJsonLines(bodyLines).join('\n'),
    chunked: bodyLines.length > 1,
  };
}

/** Listing order: name, then id, both by Unicode scalar value. */
function sortProjects(
  projects: ReadonlyArray<ProjectListingRecord>,
): Array<ProjectListingRecord> {
  return [...projects].sort(
    (left, right) =>
      compareCodePoints(left.name, right.name) ||
      compareCodePoints(left.id, right.id),
  );
}

/** Repository order: alias, then id, both by Unicode scalar value. */
function sortRepositories(
  repositories: ReadonlyArray<ProjectRepositoryView>,
): Array<ProjectRepositoryView> {
  return [...repositories].sort(
    (left, right) =>
      compareCodePoints(left.alias, right.alias) ||
      compareCodePoints(left.id, right.id),
  );
}

/** Checkout order: executor identity, locator, then id. */
function sortCheckouts(
  checkouts: ReadonlyArray<ProjectCheckoutView>,
): Array<ProjectCheckoutView> {
  return [...checkouts].sort(
    (left, right) =>
      compareCodePoints(left.executorId, right.executorId) ||
      compareCodePoints(left.locator, right.locator) ||
      compareCodePoints(left.id, right.id),
  );
}

function listingEntryView(
  project: ProjectListingRecord,
  index: number,
): ListingEntryView {
  return {
    ordinal: index + 1,
    id: fencedScalar(project.id).fenced,
    name: fencedScalar(project.name),
    description: fencedScalar(project.description),
    archiveState: fencedScalar(
      project.archivedAt === null ? 'active' : 'archived',
    ).fenced,
    locator: fencedScalar(`projects://${project.id}`).fenced,
  };
}

function projectView(project: ProjectDetailRecord): ProjectView {
  return {
    id: fencedScalar(project.id).fenced,
    name: fencedScalar(project.name),
    description: fencedScalar(project.description),
    descriptionAbsent: project.description === null,
    archiveState: fencedScalar(
      project.archivedAt === null ? 'active' : 'archived',
    ).fenced,
    instructions: fencedScalar(project.instructions),
    instructionsAbsent: project.instructions === null,
  };
}

function checkoutEntryView(
  checkout: ProjectCheckoutView,
  index: number,
): CheckoutEntryView {
  return {
    ordinal: index + 1,
    id: fencedScalar(checkout.id).fenced,
    kind: fencedScalar(checkout.kind).fenced,
    parentCheckoutId: fencedScalar(checkout.parentCheckoutId).fenced,
    executorId: fencedScalar(checkout.executorId),
    locator: fencedScalar(checkout.locator),
  };
}

function repositoryEntryView(
  repository: ProjectRepositoryView,
  index: number,
): RepositoryEntryView {
  const checkouts = sortCheckouts(repository.checkouts);

  return {
    ordinal: index + 1,
    id: fencedScalar(repository.id).fenced,
    alias: fencedScalar(repository.alias),
    displayName: fencedScalar(repository.displayName),
    canonicalRemote: fencedScalar(repository.canonicalRemote),
    canonicalRemoteAbsent: repository.canonicalRemote === null,
    primary: fencedJsonLines([repository.isPrimary ? 'true' : 'false']).join(
      '\n',
    ),
    hasCheckouts: checkouts.length > 0,
    checkouts: checkouts.map(checkoutEntryView),
  };
}

/**
 * One owner's active or archived Project metadata. Instructions and both
 * repository inventories stay out of this document entirely.
 */
export function renderProjectListing(
  projects: ReadonlyArray<ProjectListingRecord>,
  archived: boolean,
): string {
  const ordered = sortProjects(projects);

  return renderProjectDocument({
    isDetail: false,
    archived,
    hasProjects: ordered.length > 0,
    projects: ordered.map(listingEntryView),
    project: undefined,
    hasRepositories: false,
    repositories: [],
  });
}

/**
 * One owner Project's current stored record: identity, literal instructions,
 * and every linked repository with all main and worktree checkouts. Reading
 * this document neither activates guidance nor authorizes a location.
 */
export function renderProjectDetail(
  project: ProjectDetailRecord,
  repositories: ReadonlyArray<ProjectRepositoryView>,
): string {
  const ordered = sortRepositories(repositories);

  return renderProjectDocument({
    isDetail: true,
    archived: project.archivedAt !== null,
    hasProjects: false,
    projects: [],
    project: projectView(project),
    hasRepositories: ordered.length > 0,
    repositories: ordered.map(repositoryEntryView),
  });
}
