import { AppModule } from '../app.module';
import {
  SkillCatalog,
  type SkillCatalogEntry,
  type SkillCatalogSnapshot,
} from './skill-catalog';
import { SkillsController } from './skills.controller';
import {
  SKILL_CATALOG_DEFAULT_LIMIT,
  SKILL_CATALOG_MAX_LIMIT,
} from './dto/skill-catalog.dto';
import { SkillsModule } from './skills.module';

function entry(name: string): SkillCatalogEntry {
  return {
    name,
    description: `The ${name} skill.`,
    proactive: true,
    sourceDirectory: '/opt/skills',
    skillDirectory: `/opt/skills/${name}`,
    available: true,
    diagnostics: [],
  };
}

function snapshotOf(entries: Array<SkillCatalogEntry>): SkillCatalogSnapshot {
  return {
    available: true,
    directories: ['/opt/skills'],
    entries,
    diagnostics: [],
  };
}

function controllerFor(snapshot: SkillCatalogSnapshot): SkillsController {
  return new SkillsController({ getSnapshot: () => snapshot });
}

describe('SkillsController', () => {
  it('is wired into the application module', () => {
    const imports: unknown = Reflect.getMetadata('imports', AppModule);
    expect(imports).toContain(SkillsModule);
  });

  it('exports the catalog port', () => {
    const exports: unknown = Reflect.getMetadata('exports', SkillsModule);
    expect(exports).toContain(SkillCatalog);
  });

  it('applies the default page limit', () => {
    const entries = Array.from(
      { length: SKILL_CATALOG_DEFAULT_LIMIT + 1 },
      (_, index) => entry(`skill-${String(index).padStart(3, '0')}`),
    );

    const page = controllerFor(snapshotOf(entries)).listSkills({});

    expect(page.items).toHaveLength(SKILL_CATALOG_DEFAULT_LIMIT);
    expect(page.total).toBe(entries.length);
    expect(page.nextCursor).toBe(entries[SKILL_CATALOG_DEFAULT_LIMIT - 1].name);
  });

  it('resumes after the cursor and ends the paging', () => {
    const page = controllerFor(
      snapshotOf([entry('alpha'), entry('beta'), entry('gamma')]),
    ).listSkills({ limit: 2 });

    expect(page.items.map((item) => item.name)).toEqual(['alpha', 'beta']);
    expect(page.nextCursor).toBe('beta');

    const next = controllerFor(
      snapshotOf([entry('alpha'), entry('beta'), entry('gamma')]),
    ).listSkills({ limit: 2, after: page.nextCursor ?? undefined });

    expect(next.items.map((item) => item.name)).toEqual(['gamma']);
    expect(next.nextCursor).toBeNull();
  });

  it('discloses an unavailable catalog with its diagnostics', () => {
    const page = controllerFor({
      available: false,
      directories: ['/opt/skills'],
      entries: [],
      diagnostics: ['A configured skill source is missing or unreadable.'],
    }).listSkills({ limit: SKILL_CATALOG_MAX_LIMIT });

    expect(page.available).toBe(false);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.diagnostics).toHaveLength(1);
    expect(page.directories).toEqual(['/opt/skills']);
  });

  it('reports manual-only and unavailable entries to owners', () => {
    const manualOnly: SkillCatalogEntry = {
      ...entry('review'),
      proactive: false,
    };
    const broken: SkillCatalogEntry = {
      name: 'broken',
      description: null,
      proactive: false,
      sourceDirectory: '/opt/skills',
      skillDirectory: '/opt/skills/broken',
      available: false,
      diagnostics: ['SKILL.md frontmatter is missing a description.'],
    };

    const page = controllerFor(snapshotOf([broken, manualOnly])).listSkills({});

    expect(page.items.map((item) => item.name)).toEqual(['broken', 'review']);
    expect(page.items[1].proactive).toBe(false);
    expect(page.items[0].available).toBe(false);
    expect(page.items[0].diagnostics).toHaveLength(1);
  });
});
