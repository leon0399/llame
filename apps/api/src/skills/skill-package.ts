import { parse as parseYaml } from 'yaml';

import {
  isBoolean,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { isValidSkillName } from './skill-name';

/** The largest `description` the Agent Skills specification allows. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

export type SkillPackageMetadata = {
  /** Raw `SKILL.md` frontmatter, preserved wholesale for inert extension fields. */
  readonly frontmatter: UnknownRecord;
  readonly name: string;
  readonly description: string;
};

/**
 * The outcome of reading one package's `SKILL.md`. An invalid package is
 * reported with a diagnostic and never carries partial metadata: later layers
 * must not act on a half-read package.
 */
export type SkillPackageParseResult =
  | ({ readonly status: 'parsed' } & SkillPackageMetadata)
  | { readonly status: 'invalid'; readonly diagnostic: string };

/** The interpreted value of one consulted invocation control. */
export type InvocationControlValue = boolean | 'absent' | 'invalid';

/**
 * Read one package's `SKILL.md`: split its YAML frontmatter from the
 * instruction body, parse it, and validate the required metadata against the
 * package's directory name.
 */
export function parseSkillPackage(
  text: string,
  directoryName: string,
): SkillPackageParseResult {
  const block = frontmatterBlock(text);
  if (block.status === 'invalid') return block;

  const frontmatter = parseFrontmatterMapping(block.yaml);
  if (frontmatter.status === 'invalid') return frontmatter;

  const metadata = readSkillMetadata(frontmatter.value, directoryName);
  if (metadata.status === 'invalid') return metadata;

  return {
    status: 'parsed',
    frontmatter: frontmatter.value,
    name: metadata.name,
    description: metadata.description,
  };
}

/**
 * Interpret one consulted sidecar's `policy.allow_implicit_invocation`. A
 * sidecar present without that control falls through; a malformed document or
 * a non-boolean control invalidates the package rather than falling through.
 * The YAML is parsed here so an unparseable sidecar cannot be mistaken for an
 * absent control.
 */
export function readSidecarInvocationControl(
  text: string,
): InvocationControlValue {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch {
    return 'invalid';
  }
  if (!isRecord(document)) return 'invalid';
  const policy = document.policy;
  if (policy === undefined) return 'absent';
  if (!isRecord(policy)) return 'invalid';
  const control = policy.allow_implicit_invocation;
  if (control === undefined) return 'absent';
  return isBoolean(control) ? control : 'invalid';
}

/**
 * Interpret `SKILL.md` frontmatter's `disable-model-invocation`, whose boolean
 * meaning is inverted. Only consulted when no higher-precedence control is
 * present, so an unconfigured value stays inert.
 */
export function readFrontmatterInvocationControl(
  frontmatter: UnknownRecord,
): InvocationControlValue {
  const control = frontmatter['disable-model-invocation'];
  if (control === undefined) return 'absent';
  return isBoolean(control) ? !control : 'invalid';
}

function frontmatterBlock(
  text: string,
):
  | { readonly status: 'ok'; readonly yaml: string }
  | { readonly status: 'invalid'; readonly diagnostic: string } {
  const lines = text.split(/\r?\n/u);
  if (lines[0] !== '---') {
    return {
      status: 'invalid',
      diagnostic: 'SKILL.md must start with a YAML frontmatter block',
    };
  }
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trimEnd() === '---',
  );
  if (closingIndex === -1) {
    return {
      status: 'invalid',
      diagnostic: 'SKILL.md frontmatter block is not closed',
    };
  }
  return { status: 'ok', yaml: lines.slice(1, closingIndex).join('\n') };
}

function parseFrontmatterMapping(
  yaml: string,
):
  | { readonly status: 'ok'; readonly value: UnknownRecord }
  | { readonly status: 'invalid'; readonly diagnostic: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (error) {
    return {
      status: 'invalid',
      diagnostic: `SKILL.md frontmatter is not valid YAML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      status: 'invalid',
      diagnostic: 'SKILL.md frontmatter must be a YAML mapping',
    };
  }
  return { status: 'ok', value: parsed };
}

function readSkillMetadata(
  frontmatter: UnknownRecord,
  directoryName: string,
):
  | {
      readonly status: 'ok';
      readonly name: string;
      readonly description: string;
    }
  | { readonly status: 'invalid'; readonly diagnostic: string } {
  const name = frontmatter.name;
  if (!isString(name) || !isValidSkillName(name)) {
    return {
      status: 'invalid',
      diagnostic:
        'SKILL.md frontmatter `name` must be 1-64 lowercase letters, digits, or hyphens without a leading, trailing, or consecutive hyphen',
    };
  }
  if (name !== directoryName) {
    return {
      status: 'invalid',
      diagnostic: `SKILL.md frontmatter \`name\` "${name}" does not match its directory "${directoryName}"`,
    };
  }

  const description = frontmatter.description;
  if (
    !isString(description) ||
    description.trim().length === 0 ||
    description.length > SKILL_DESCRIPTION_MAX_LENGTH
  ) {
    return {
      status: 'invalid',
      diagnostic: `SKILL.md frontmatter \`description\` must be a non-empty string of at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters`,
    };
  }

  return { status: 'ok', name, description };
}
