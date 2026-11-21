/**
 * The `project` context producer: the selected Project's identity, description,
 * locator, and literal owner-authored guidance, or the explicit absence of a
 * Project.
 *
 * The selection itself is frozen for a Run by `run.project_bound`; this module
 * never resolves live Project rows. It owns only the model-visible rendering
 * and the metadata needed for owner inspection, and it compares told state
 * against its own persisted text in reconstructed context.
 *
 * A Project association is not a Workspace binding. This producer grants no
 * tool authority, names no registered repository or checkout location, and
 * makes no navigation decision.
 */

import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  type ProjectBoundPayload,
  type ProjectSelection,
} from '../runs/project-selection';
import {
  escapeAngles,
  scanTagTokens,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  isContextItemPart,
  type AuthoredContextItemPart,
} from './context-item';
import { createRenderedContextItem } from './context-item-shared';

const PROJECT_PRODUCER = 'project';

/**
 * The persisted payload. `project` is null only for an absence snapshot.
 * Authored strings are stored in the neutralized form the model received, so
 * owner inspection compares like with like.
 */
interface ProjectSnapshotPayload extends UnknownRecord {
  readonly v: 1;
  readonly project: ProjectSelection | null;
}

/**
 * Tag-shaped tokens naming this producer's own field wrappers. Authored values
 * have already passed the shared sanitizer, which handles the rail's reserved
 * names and in-value closers; this extends the same containment to the field
 * labels the Project template generates, so a balanced forged
 * `<project_instructions>…</project_instructions>` inside a description or an
 * instruction cannot pass as snapshot framing.
 */
const PROJECT_FIELD_TAGS = new Set<string>([
  'project_snapshot',
  'project_name',
  'project_description',
  'project_instructions',
]);

const TAG_NAME = /^<\s*(?:\/\s*)?([A-Za-z][\w.:-]*)/u;

function neutralizeProjectField(value: string): string {
  // The shared sanitizer already escapes every reserved rail token; the scan
  // below extends that containment to this template's own field labels.
  const sanitized = sanitizeAuthoredText(value);

  let out = '';
  let cursor = 0;

  for (const { start, end, token } of scanTagTokens(sanitized)) {
    const name = TAG_NAME.exec(token)?.[1]?.toLowerCase();

    if (name === undefined || !PROJECT_FIELD_TAGS.has(name)) continue;

    out += sanitized.slice(cursor, start) + escapeAngles(token);
    cursor = end;
  }

  return out + sanitized.slice(cursor);
}

const renderProjectTemplate = loadPackagedTemplate<{
  readonly project: ProjectSelection | null;
}>(__dirname, 'project');

/** The selected fields, neutralized once and shared by payload and body. */
function toSnapshotProject(
  selection: ProjectSelection | null,
): ProjectSelection | null {
  if (selection === null) return null;

  return {
    id: selection.id,
    name: neutralizeProjectField(selection.name),
    description:
      selection.description === null
        ? null
        : neutralizeProjectField(selection.description),
    instructions:
      selection.instructions === null
        ? null
        : neutralizeProjectField(selection.instructions),
    locator: selection.locator,
  };
}

/**
 * Render one snapshot from the Run's frozen selection: a bound snapshot when a
 * Project is selected, otherwise the explicit absence snapshot. Suppression is
 * the caller's comparison job (`selectProjectSnapshot`), not this function's.
 */
export function createProjectSnapshotItem(input: {
  readonly runId: string;
  readonly selection: ProjectBoundPayload;
}): AuthoredContextItemPart {
  const project = toSnapshotProject(input.selection.project);

  const payload: ProjectSnapshotPayload = { v: 1, project };

  return createRenderedContextItem({
    producer: PROJECT_PRODUCER,
    form: 'snapshot',
    runId: input.runId,
    payload,
    body: renderProjectTemplate({ project }),
  });
}

/**
 * The latest own text-bearing Project item in the supplied reconstructed
 * order, or undefined when there is none.
 *
 * Metadata-only historical rows do not count. The payload is deliberately not
 * inspected: a future payload version whose text is present still counts, and
 * Run IDs or timestamps are never compared.
 */
export function projectSnapshotText(
  parts: Iterable<unknown>,
): string | undefined {
  let latest: string | undefined;

  for (const part of parts) {
    if (!isContextItemPart(part) || part.data.producer !== PROJECT_PRODUCER) {
      continue;
    }

    const text = part.data.text;

    if (text === undefined || text.length === 0) continue;

    latest = text;
  }

  return latest;
}

/**
 * The one snapshot a preparation step should stage.
 *
 * A bound selection always has presence and emits unless its rendered text
 * equals `toldText`. A null selection emits the absence snapshot when any prior
 * own Project text counts as presence (`toldText`, including an item that
 * survived a checkpoint) or when durable history shows Project context a
 * checkpoint absorbed (`historyPresent`). A null selection with neither emits
 * nothing, so a never-filed Chat gets no reminder.
 */
export function selectProjectSnapshot(input: {
  readonly runId: string;
  readonly selection: ProjectBoundPayload;
  readonly toldText: string | undefined;
  readonly historyPresent: boolean;
}): AuthoredContextItemPart | undefined {
  const hasPresence =
    input.selection.project !== null ||
    input.toldText !== undefined ||
    input.historyPresent;

  if (!hasPresence) return undefined;

  const item = createProjectSnapshotItem({
    runId: input.runId,
    selection: input.selection,
  });

  return input.toldText === item.data.text ? undefined : item;
}
