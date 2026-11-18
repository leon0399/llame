import type { JSONValue } from '@ai-sdk/provider';

import { asDouble } from '../testing/support';
import { TOOL_REGISTRY, resolveAdvertisedTools } from './registry';
import { renderUiTool } from './render-ui';
import { admitToolInputSchema, safeParseArgs } from './schema-utils';
import { type ToolContext } from './types';

const context = asDouble<ToolContext>({});

/** The arguments as the model wrote them: unchecked JSON. */
type ModelArguments = {
  components: Array<Record<string, JSONValue>>;
  data?: Record<string, JSONValue>;
};

function render(input: ModelArguments) {
  return renderUiTool.execute(context, asDouble(input));
}

const CARD: ModelArguments['components'] = [
  { id: 'root', component: 'Card', child: 'body' },
  { id: 'body', component: 'Column', children: ['title', 'items'] },
  { id: 'title', component: 'Text', text: { path: '/title' }, variant: 'h3' },
  {
    id: 'items',
    component: 'List',
    children: { componentId: 'item', path: '/items' },
  },
  { id: 'item', component: 'Text', text: { path: 'name' } },
];

describe('render_ui', () => {
  it('is a registered read-only tool, offered only when allowlisted', () => {
    expect(TOOL_REGISTRY.get('render_ui')).toBe(renderUiTool);
    expect(renderUiTool.classification).toBe('read_only');
    expect(resolveAdvertisedTools(new Set(['render_ui']))).toEqual([
      renderUiTool,
    ]);
    expect(resolveAdvertisedTools(new Set(['wait']))).not.toContain(
      renderUiTool,
    );
  });

  it('declares a schema that admits a surface carrying a data model', async () => {
    const admission = await admitToolInputSchema(renderUiTool.inputSchema);

    if (!admission.success) throw new Error('render_ui schema not admitted');

    // The declaration the SDK validates a call against, before `execute`.
    expect(
      safeParseArgs(admission.inputSchema, {
        components: CARD,
        data: { title: 'Checks', items: [{ name: 'lint', nested: { ok: 1 } }] },
      }).success,
    ).toBe(true);
  });

  it('accepts a surface with bound text and a repeated child', async () => {
    await expect(
      render({
        components: CARD,
        data: { title: 'Open pull requests', items: [{ name: '#12' }] },
      }),
    ).resolves.toEqual({ status: 'success', rendered: true });
  });

  it('refuses a surface with no root, a reused id, or a child that does not exist', async () => {
    await expect(
      render({ components: [{ id: 'a', component: 'Text', text: 'x' }] }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_input',
      message: 'One component must have the id "root".',
    });
    await expect(
      render({
        components: [
          { id: 'root', component: 'Text', text: 'x' },
          { id: 'root', component: 'Divider' },
        ],
      }),
    ).resolves.toMatchObject({
      message: 'Component id "root" is used twice.',
    });
    await expect(
      render({
        components: [{ id: 'root', component: 'Card', child: 'missing' }],
      }),
    ).resolves.toMatchObject({
      message: 'No component has the id "missing".',
    });
  });

  it('refuses a component under two parents: a short list must not expand without bound', async () => {
    await expect(
      render({
        components: [
          { id: 'root', component: 'Column', children: ['a', 'a'] },
          { id: 'a', component: 'Text', text: 'x' },
        ],
      }),
    ).resolves.toMatchObject({
      type: 'invalid_input',
      message: 'Component "a" is the child of more than one component.',
    });
  });

  it('refuses a data model that is too deep or too large to be a surface', async () => {
    const root = [{ id: 'root', component: 'Text', text: 'x' }];
    let deep: JSONValue = 'leaf';

    for (let level = 0; level < 13; level += 1) deep = { inner: deep };

    await expect(
      render({ components: root, data: { deep } }),
    ).resolves.toMatchObject({
      type: 'invalid_input',
      message: 'data nests more than 12 levels deep.',
    });
    await expect(
      render({ components: root, data: { rows: ['x'.repeat(16_000)] } }),
    ).resolves.toMatchObject({
      type: 'invalid_input',
      message: 'data is larger than 16000 characters of JSON.',
    });
  });

  it.each(['Image', 'Button', 'TextField'])(
    'refuses a %s: the catalog is display only and loads no remote content',
    async (component) => {
      await expect(
        render({
          components: [{ id: 'root', component, url: 'https://example.com' }],
        }),
      ).resolves.toMatchObject({ status: 'error', type: 'invalid_input' });
    },
  );
});
