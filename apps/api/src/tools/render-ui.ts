import { z } from 'zod';

import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { type Tool, type ToolResult } from './types';

/**
 * `render_ui`: the model hands the owner's client one A2UI v0.9 surface — a
 * flat list of components and the data model they bind to. The tool has no
 * effect of its own: the call's input is the surface, it persists with the
 * reply like any tool call, and the client renders it from there, live and on
 * reload.
 *
 * The catalog is a display-only subset of A2UI's basic catalog. `Image` is
 * left out on purpose: a model-chosen URL fetched by the owner's browser is a
 * channel out of the Chat. Interactive components are left out because a
 * surface has no way to send an action back to the Run yet.
 */

const MAX_COMPONENTS = 200;

/** The data model's bound as JSON text: enough for a table, not for a dump. */
const MAX_DATA_CHARS = 16_000;

/** How deep the data model may nest; a surface binds a few levels at most. */
const MAX_DATA_DEPTH = 12;

const componentId = z.string().min(1).max(64);

/** A literal, or a JSON Pointer into the surface's data model. The empty
 *  pointer is the current item itself: how an array of strings is shown. */
const dynamicString = z.union([
  z.string().max(4000),
  z.strictObject({ path: z.string().max(256) }),
]);

/** Fixed children, or one template repeated for each item of a data array. */
const childList = z.union([
  z.array(componentId).max(64),
  z.strictObject({
    componentId,
    path: z.string().min(1).max(256),
  }),
]);

const justify = z.enum([
  'start',
  'center',
  'end',
  'spaceBetween',
  'spaceAround',
  'spaceEvenly',
  'stretch',
]);

const align = z.enum(['start', 'center', 'end', 'stretch']);

const component = z.discriminatedUnion('component', [
  z.strictObject({
    id: componentId,
    component: z.literal('Text'),
    text: dynamicString,
    variant: z
      .enum(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'])
      .optional(),
  }),
  z.strictObject({
    id: componentId,
    component: z.literal('Row'),
    children: childList,
    justify: justify.optional(),
    align: align.optional(),
  }),
  z.strictObject({
    id: componentId,
    component: z.literal('Column'),
    children: childList,
    justify: justify.optional(),
    align: align.optional(),
  }),
  z.strictObject({
    id: componentId,
    component: z.literal('List'),
    children: childList,
    direction: z.enum(['vertical', 'horizontal']).optional(),
    align: align.optional(),
  }),
  z.strictObject({
    id: componentId,
    component: z.literal('Card'),
    child: componentId,
  }),
  z.strictObject({
    id: componentId,
    component: z.literal('Divider'),
    axis: z.enum(['horizontal', 'vertical']).optional(),
  }),
]);

const renderUiInputSchema = z.strictObject({
  components: z.array(component).min(1).max(MAX_COMPONENTS),
  data: z.record(z.string(), z.unknown()).optional(),
});

type RenderUiInput = z.output<typeof renderUiInputSchema>;

type Component = RenderUiInput['components'][number];

/** The ids a component names as its children. */
function referencedIds(node: Component): Array<string> {
  if (node.component === 'Card') return [node.child];

  if (node.component === 'Text' || node.component === 'Divider') return [];

  return Array.isArray(node.children)
    ? node.children
    : [node.children.componentId];
}

/** Whether `value` nests objects or lists more than `levels` deep. */
function nestsDeeperThan(value: unknown, levels: number): boolean {
  if (!(value instanceof Object)) return false;

  return (
    levels === 0 ||
    Object.values(value).some((inner) => nestsDeeperThan(inner, levels - 1))
  );
}

/** Why the data model is refused, or undefined when it is within bounds. */
function dataProblem(data: RenderUiInput['data']): string | undefined {
  if (data === undefined) return undefined;

  if (nestsDeeperThan(data, MAX_DATA_DEPTH)) {
    return `data nests more than ${MAX_DATA_DEPTH} levels deep.`;
  }

  return JSON.stringify(data).length > MAX_DATA_CHARS
    ? `data is larger than ${MAX_DATA_CHARS} characters of JSON.`
    : undefined;
}

/** Why the components do not form a surface, or undefined when they do. */
function surfaceProblem(components: Array<Component>): string | undefined {
  const ids = new Set<string>();

  for (const node of components) {
    if (ids.has(node.id)) return `Component id "${node.id}" is used twice.`;
    ids.add(node.id);
  }

  if (!ids.has('root')) return 'One component must have the id "root".';

  // A component under two parents would render once per path to it, so a
  // short list could expand without bound: the components form a tree.
  const parented = new Set<string>();

  for (const referenced of components.flatMap(referencedIds)) {
    if (!ids.has(referenced)) return `No component has the id "${referenced}".`;

    if (parented.has(referenced)) {
      return `Component "${referenced}" is the child of more than one component.`;
    }

    parented.add(referenced);
  }

  return undefined;
}

export const renderUiTool: Tool<RenderUiInput> = {
  id: 'render_ui',
  description: loadPackagedToolDescription('render_ui'),
  classification: 'read_only',
  // Declared as a JSON Schema document: the SDK's Zod conversion closes every
  // object, the free-form data model included, so a Zod declaration rejects
  // any call that carries `data`. `execute` validates with the Zod schema.
  inputSchema: z.toJSONSchema(renderUiInputSchema, { io: 'input' }),
  execute: (_context, args): Promise<ToolResult> => {
    const parsed = renderUiInputSchema.safeParse(args);

    const problem = parsed.success
      ? (surfaceProblem(parsed.data.components) ??
        dataProblem(parsed.data.data))
      : 'The surface does not match the render_ui component schema.';

    return Promise.resolve(
      problem === undefined
        ? { status: 'success', rendered: true }
        : { status: 'error', type: 'invalid_input', message: problem },
    );
  },
};
