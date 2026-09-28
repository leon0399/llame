import { type WebAdapterConfig } from '../../../instance-config/llame-config';
import { compileRegexMatcher } from '../../permissions/matcher';
import type { WebFetchFailure } from '../http-client';
import {
  classifyFetchFailure,
  isFatalAdapterFailure,
  type WebAdapter,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from './contract';
import {
  expandRewriteTarget,
  parseRewriteTarget,
  type RewriteTarget,
} from './rewrite-target';
import { renderWebDocument } from '../pipeline';

/** Creates one validated operator rewrite route. */
export function createRewriteAdapter(config: WebAdapterConfig): WebAdapter {
  const target = parseRewriteTarget(config.target);
  if ('error' in target) {
    throw new Error(`Invalid rewrite target for adapter "${config.id}".`);
  }
  const pathMatcher =
    config.pathPattern === undefined
      ? undefined
      : compileRegexMatcher(
          config.pathPattern,
          `tools.webAdapters[${config.id}].pathPattern`,
        );

  return {
    id: config.id,
    route: 'rewrite',
    match(source) {
      if (!config.hosts.includes(source.hostname)) return false;
      return (
        pathMatcher === undefined || pathMatcher.matchesExact(source.pathname)
      );
    },
    read(source, io) {
      return readRewriteAdapter(source, io, target);
    },
  };
}

async function readRewriteAdapter(
  source: URL,
  io: WebAdapterIo,
  target: RewriteTarget,
): Promise<WebAdapterOutcome> {
  const expanded = expandRewriteTarget(target, source);
  if (expanded === undefined) {
    return { kind: 'failed', failure: 'permission' };
  }

  const fetched = await io.fetch(expanded);
  if ('type' in fetched) return failureOutcome(fetched);
  if (fetched.body.trim().length === 0) {
    return { kind: 'failed', failure: 'empty' };
  }

  try {
    const rendered = renderWebDocument(fetched, { raw: false });
    if (rendered.method === 'raw') {
      return { kind: 'failed', failure: 'parse' };
    }
    return {
      kind: 'rendered',
      content: rendered.content,
      origin: target.origin,
      notes: [
        `content came through the operator-configured origin ${target.origin}`,
      ],
    };
  } catch {
    return { kind: 'failed', failure: 'parse' };
  }
}

function failureOutcome(failure: WebFetchFailure): WebAdapterOutcome {
  const outcome: WebAdapterOutcome = {
    kind: 'failed',
    failure: classifyFetchFailure(failure),
  };
  if (isFatalAdapterFailure(failure)) {
    return { ...outcome, fatal: failure };
  }
  return outcome;
}
