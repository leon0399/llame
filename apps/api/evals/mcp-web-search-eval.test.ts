/**
 * Opt-in real-service MCP web-search evaluation (OpenSpec task 4.6).
 *
 * This suite is excluded from deterministic unit/integration acceptance. Run it
 * explicitly with:
 *
 *   RUN_MCP_WEB_SEARCH_EVAL=1 \
 *   MCP_WEB_SEARCH_URL=https://example.invalid/mcp \
 *   MCP_WEB_SEARCH_AUTH_HEADER=authorization \
 *   MCP_WEB_SEARCH_AUTH_VALUE='Bearer ...' \
 *   MCP_WEB_SEARCH_TOOL=search \
 *   MCP_WEB_SEARCH_QUERY_FIELD=query \
 *   pnpm --filter api test:evals:mcp-web-search
 *
 * The URL and tool shape are configuration rather than a vendor contract. The
 * selected tool must accept the generated query in the configured string field.
 */

import {
  McpServerClient,
  type McpDiscoveredTool,
} from '@workspace/tool-runtime/mcp-server-client';
import { isRecord } from '@workspace/runtime-safety';

const ENV_NAMES = [
  'MCP_WEB_SEARCH_URL',
  'MCP_WEB_SEARCH_AUTH_HEADER',
  'MCP_WEB_SEARCH_AUTH_VALUE',
  'MCP_WEB_SEARCH_TOOL',
  'MCP_WEB_SEARCH_QUERY_FIELD',
] as const;

type LiveEvalConfig = {
  readonly url: string;
  readonly authHeader: string;
  readonly authValue: string;
  readonly tool: string;
  readonly queryField: string;
};

type CapturedConsole = {
  readonly values: ReadonlyArray<unknown>;
  readonly restore: () => void;
};

type LiveEvalConfigResolution = {
  readonly config?: LiveEvalConfig;
  readonly optOutReason?: string;
};

const LIVE_TOOL_EXECUTION_TIMEOUT_MS = 30_000;
const LIVE_SEARCH_QUERY =
  'Run a live web search now. Find one source that states the current UTC date in YYYY-MM-DD format. ' +
  'Return non-empty sourced evidence including an HTTP(S) reference and that exact date.';

function resolveLiveEvalConfig(): LiveEvalConfigResolution {
  if (process.env.RUN_MCP_WEB_SEARCH_EVAL !== '1') {
    return { optOutReason: 'set RUN_MCP_WEB_SEARCH_EVAL=1 to opt in' };
  }

  const missing = ENV_NAMES.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `MCP web-search evaluation is enabled but missing ${missing.join(', ')}.`,
    );
  }

  const values = {
    MCP_WEB_SEARCH_URL: process.env.MCP_WEB_SEARCH_URL!.trim(),
    MCP_WEB_SEARCH_AUTH_HEADER: process.env.MCP_WEB_SEARCH_AUTH_HEADER!.trim(),
    MCP_WEB_SEARCH_AUTH_VALUE: process.env.MCP_WEB_SEARCH_AUTH_VALUE!.trim(),
    MCP_WEB_SEARCH_TOOL: process.env.MCP_WEB_SEARCH_TOOL!.trim(),
    MCP_WEB_SEARCH_QUERY_FIELD: process.env.MCP_WEB_SEARCH_QUERY_FIELD!.trim(),
  };

  let url: URL;
  try {
    url = new URL(values.MCP_WEB_SEARCH_URL);
  } catch {
    throw new Error('MCP_WEB_SEARCH_URL must be a valid absolute URL.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(
      'MCP_WEB_SEARCH_URL must use HTTP(S) and must not contain userinfo.',
    );
  }
  try {
    new Headers({
      [values.MCP_WEB_SEARCH_AUTH_HEADER]: values.MCP_WEB_SEARCH_AUTH_VALUE,
    });
  } catch {
    throw new Error('The configured MCP web-search auth header is invalid.');
  }

  return {
    config: {
      url: url.href,
      authHeader: values.MCP_WEB_SEARCH_AUTH_HEADER,
      authValue: values.MCP_WEB_SEARCH_AUTH_VALUE,
      tool: values.MCP_WEB_SEARCH_TOOL,
      queryField: values.MCP_WEB_SEARCH_QUERY_FIELD,
    },
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- accepts whatever the MCP eval captured (console args, tool output, thrown errors) purely to stringify it for diagnostics; there is no domain type to parse into.
function inspectableJson(value: unknown): string {
  try {
    return (
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- mirrors JSON.stringify's own replacer signature (`(key: string, value: any) => any` in lib.es5.d.ts), narrowed to `unknown`.
      JSON.stringify(value, (_key, item: unknown) =>
        item instanceof Error
          ? { name: item.name, message: item.message, cause: item.cause }
          : item,
      ) ?? ''
    );
  } catch {
    throw new Error('The MCP eval could not inspect a captured value safely.');
  }
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- forwards directly to `inspectableJson` above for credential-leak scanning; same rationale, no domain type to parse into.
function assertCredentialAbsent(value: unknown, credential: string): void {
  if (inspectableJson(value).includes(credential)) {
    throw new Error('A credential escaped the MCP adapter boundary.');
  }
}

function captureConsole(): CapturedConsole {
  const values: Array<unknown> = [];
  const capture = (...args: Array<unknown>) => {
    values.push(args);
  };
  const spies = [
    vi.spyOn(console, 'debug').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
    vi.spyOn(console, 'info').mockImplementation(capture),
    vi.spyOn(console, 'log').mockImplementation(capture),
    vi.spyOn(console, 'warn').mockImplementation(capture),
  ];
  return {
    values,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

function findTool(
  tools: ReadonlyArray<McpDiscoveredTool>,
  configuredName: string,
): McpDiscoveredTool {
  const tool = tools.find(
    ({ definition }) =>
      definition.remoteName === configuredName ||
      definition.id === configuredName,
  );
  if (tool === undefined) {
    throw new Error('The configured MCP web-search tool was not discovered.');
  }
  return tool;
}

function assertStringQueryField(tool: McpDiscoveredTool, field: string): void {
  const properties = tool.definition.inputSchema['properties'];
  const querySchema = isRecord(properties) ? properties[field] : undefined;
  const type = isRecord(querySchema) ? querySchema['type'] : undefined;
  const acceptsString =
    type === 'string' ||
    (Array.isArray(type) && type.some((entry) => entry === 'string'));
  if (!acceptsString) {
    throw new Error(
      'MCP_WEB_SEARCH_QUERY_FIELD must name a discovered string property.',
    );
  }
}

function assertCurrentSourcedEvidence(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the MCP tool's raw output, forwarded to `inspectableJson` for evidence-substring inspection; the eval treats it as opaque diagnostic text, not a domain value.
  output: unknown,
  expectedUtcDate: string,
): void {
  const evidence = inspectableJson(output);
  if (evidence.trim().length === 0) {
    throw new Error('The MCP web-search tool returned no evidence.');
  }
  if (!evidence.includes(expectedUtcDate)) {
    throw new Error(
      'The MCP web-search evidence did not establish the exact current UTC date.',
    );
  }
  if (!/https?:\/\/[^\s<>"')\]}]+/u.test(evidence)) {
    throw new Error(
      'The MCP web-search evidence did not include an HTTP(S) reference.',
    );
  }
}

describe('current sourced evidence gate', () => {
  it('does not supply a numeric date or year in the search query', () => {
    expect(LIVE_SEARCH_QUERY).not.toMatch(/\b\d{4}(?:-\d{2}-\d{2})?\b/u);
  });

  it('rejects copied current-year prose paired with an unrelated URL', () => {
    expect(() =>
      assertCurrentSourcedEvidence(
        {
          result:
            'The request concerns 2026. Archived material: https://example.test/archive/1999',
        },
        '2026-08-11',
      ),
    ).toThrow('did not establish the exact current UTC date');
  });

  it('accepts the exact current UTC date with a source', () => {
    expect(() =>
      assertCurrentSourcedEvidence(
        {
          result: 'The current UTC date is 2026-08-11.',
          source: 'https://example.test/current-time',
        },
        '2026-08-11',
      ),
    ).not.toThrow();
  });

  it('fails an explicit opt-in when required configuration is missing', () => {
    const prior = Object.fromEntries(
      ['RUN_MCP_WEB_SEARCH_EVAL', ...ENV_NAMES].map((name) => [
        name,
        process.env[name],
      ]),
    );
    process.env.RUN_MCP_WEB_SEARCH_EVAL = '1';
    for (const name of ENV_NAMES) delete process.env[name];

    try {
      expect(() => resolveLiveEvalConfig()).toThrow(
        'MCP web-search evaluation is enabled but missing',
      );
    } finally {
      for (const [name, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

const resolved = resolveLiveEvalConfig();
const d = resolved.config === undefined ? describe.skip : describe;

d(
  `real MCP web-search evaluation (${resolved.optOutReason ?? 'explicit opt-in active'})`,
  () => {
    it('discovers and executes current sourced search without exposing credentials', async () => {
      const config = resolved.config;
      if (config === undefined) {
        throw new Error(
          'The real MCP web-search evaluation was not configured.',
        );
      }
      const captured = captureConsole();
      let client: McpServerClient | undefined;
      let safeFailure: Error | undefined;

      try {
        client = await McpServerClient.connect({
          serverId: 'real_search',
          url: config.url,
          headers: { [config.authHeader]: config.authValue },
        });
        const catalog = await client.discover();
        assertCredentialAbsent(catalog, config.authValue);

        const tool = findTool(catalog.tools, config.tool);
        assertStringQueryField(tool, config.queryField);

        const expectedUtcDate = new Date().toISOString().slice(0, 10);
        const options = {
          toolCallId: crypto.randomUUID(),
          messages: [],
          abortSignal: AbortSignal.timeout(LIVE_TOOL_EXECUTION_TIMEOUT_MS),
        };
        const outcome = await tool.execute(
          { [config.queryField]: LIVE_SEARCH_QUERY },
          options,
        );
        assertCredentialAbsent(outcome, config.authValue);
        if (
          outcome.disposition !== 'none' ||
          outcome.result.status !== 'success'
        ) {
          throw new Error(
            'The MCP web-search tool did not execute successfully.',
          );
        }
        assertCurrentSourcedEvidence(outcome.result['output'], expectedUtcDate);

        // This exercises the adapter's failure path without issuing a second
        // remote call: protected arguments are rejected before execution.
        const rejected = await tool.execute(
          { [config.queryField]: config.authValue },
          options,
        );
        assertCredentialAbsent(rejected, config.authValue);
        if (
          rejected.disposition !== 'call_local' ||
          rejected.result.status !== 'error' ||
          rejected.result.type !== 'invalid_input'
        ) {
          throw new Error(
            'The MCP adapter did not reject a protected argument safely.',
          );
        }
      } catch (error) {
        try {
          assertCredentialAbsent(error, config.authValue);
        } catch {
          safeFailure = new Error(
            'The real MCP web-search evaluation failed its credential boundary.',
          );
        }
        safeFailure ??= new Error(
          'The real MCP web-search evaluation failed before proving sourced evidence.',
        );
      } finally {
        await client?.close();
        captured.restore();
      }

      assertCredentialAbsent(captured.values, config.authValue);
      if (safeFailure !== undefined) throw safeFailure;
    });
  },
);
