import { CliError } from "./errors";
import { WorkspaceFiles, type DirectoryListing } from "./workspace-files";

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
}

interface FoldedField {
  readonly value: string;
  readonly index: number;
}

function foldedBlock(lines: ReadonlyArray<string>, start: number): FoldedField {
  const parts: Array<string> = [];
  let index = start;
  // A blank line inside a folded block continues it; only a new unindented
  // line (a sibling key, or the frontmatter's end) stops it.
  while (
    lines[index + 1] !== undefined &&
    (lines[index + 1] === "" || /^\s/.test(lines[index + 1] ?? ""))
  ) {
    parts.push((lines[++index] ?? "").trim());
  }
  return { value: parts.filter(Boolean).join(" "), index };
}

function scalarField(raw: string): string {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** Instruction-only subset: scalar/folded name and description; no YAML tags. */
export function skillMetadata(source: string): SkillSummary {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match?.[1])
    throw new CliError("skill_format", "Skill requires YAML frontmatter.");
  const fields = new Map<string, string>();
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const field = /^(name|description):\s*(.*)$/.exec(lines[index] ?? "");
    if (!field?.[1]) continue;
    let value = field[2] || "";
    if (/^[>|][-+]?$/.test(value)) {
      const folded = foldedBlock(lines, index);
      value = folded.value;
      index = folded.index;
    } else {
      value = scalarField(value);
    }
    if (fields.has(field[1]))
      throw new CliError("skill_format", "Duplicate skill metadata.");
    fields.set(field[1], value);
  }
  const name = fields.get("name") || "";
  const description = fields.get("description") || "";
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    name.length > 64 ||
    !description ||
    description.length > 1024
  ) {
    throw new CliError(
      "skill_format",
      "Skill needs a kebab-case name and a bounded scalar description.",
    );
  }
  return { name, description };
}

export interface SkillsListing {
  readonly skills: ReadonlyArray<SkillSummary>;
  readonly truncated: boolean;
}

export function skillsList(files: WorkspaceFiles): SkillsListing {
  let listing: DirectoryListing;
  try {
    listing = files.list(".agents/skills");
  } catch {
    return { skills: [], truncated: false };
  }
  const results: Array<SkillSummary> = [];
  for (const item of listing.entries) {
    if (!item.directory || !/^[a-z0-9-]{1,64}$/.test(item.name)) continue;
    try {
      const summary = skillMetadata(
        files.read(`.agents/skills/${item.name}/SKILL.md`).content,
      );
      if (summary.name === item.name) results.push(summary);
    } catch {
      /* Unsupported/unsafe skills are not installed implicitly. */
    }
  }
  return { skills: results, truncated: listing.truncated };
}
