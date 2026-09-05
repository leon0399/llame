import { CliError } from './errors';
import { WorkspaceFiles } from './workspace-files';

export interface SkillSummary { readonly name: string; readonly description: string; }

/** Instruction-only subset: scalar/folded name and description; no YAML tags. */
export function skillMetadata(source: string): SkillSummary {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match?.[1]) throw new CliError('skill_format', 'Skill requires YAML frontmatter.');
  const fields = new Map<string, string>();
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const field = /^(name|description):\s*(.*)$/.exec(lines[index] ?? '');
    if (!field?.[1]) continue;
    let value = field[2] || '';
    if (/^[>|][-+]?$/.test(value)) {
      const parts: string[] = [];
      while (/^\s/.test(lines[index + 1] ?? '')) parts.push((lines[++index] ?? '').trim());
      value = parts.join(' ');
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (fields.has(field[1])) throw new CliError('skill_format', 'Duplicate skill metadata.');
    fields.set(field[1], value);
  }
  const name = fields.get('name') || ''; const description = fields.get('description') || '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || !description || description.length > 1024) {
    throw new CliError('skill_format', 'Skill needs a kebab-case name and a bounded scalar description.');
  }
  return { name, description };
}

export function skillsList(files: WorkspaceFiles): SkillSummary[] {
  let names: { name: string; directory: boolean }[];
  try { names = files.list('.agents/skills').entries; }
  catch { return []; }
  const results: SkillSummary[] = [];
  for (const item of names) {
    if (!item.directory || !/^[a-z0-9-]{1,64}$/.test(item.name)) continue;
    try {
      const summary = skillMetadata(files.read(`.agents/skills/${item.name}/SKILL.md`).content);
      if (summary.name === item.name) results.push(summary);
    } catch { /* Unsupported/unsafe skills are not installed implicitly. */ }
  }
  return results;
}
