/** The small, shell-safe view of Pi skills that Graphe needs to draw.
 *
 * Pi discovers these again when it opens a session. This reader deliberately
 * mirrors its conventional folders so the library never promises a skill the
 * running agent cannot see. It does not execute, install, or trust anything.
 */
import { homedir } from 'node:os';
import { realpath, readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export type AvailableSkill = {
  id: string;
  name: string;
  handle: string;
  description: string;
  source: 'global' | 'project';
  path: string;
};

type Found = Omit<AvailableSkill, 'id' | 'handle'>;

function words(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function frontmatter(text: string, fallback: string): Pick<Found, 'name' | 'description'> {
  const head = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const fields = head?.[1] ?? '';
  const name = fields.match(/^name:\s*(.+)$/m)?.[1];
  const description = fields.match(/^description:\s*(.+)$/m)?.[1];
  return {
    name: name === undefined ? fallback : words(name),
    description: description === undefined ? 'Reusable instructions for this kind of work.' : words(description),
  };
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
}

async function skillFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        const own = join(path, 'SKILL.md');
        if ((await stat(own).catch(() => null))?.isFile()) found.push(own);
        else await walk(path);
      }
    }
  };
  await walk(root);
  return found;
}

async function inRoots(roots: readonly { path: string; source: Found['source'] }[]): Promise<Found[]> {
  const seen = new Set<string>();
  const found: Found[] = [];
  for (const root of roots) {
    for (const path of await skillFiles(root.path)) {
      const actual = await realpath(path).catch(() => path);
      if (seen.has(actual)) continue;
      seen.add(actual);
      const text = await readFile(path, 'utf8').catch(() => '');
      if (text === '') continue;
      const meta = frontmatter(text, basename(dirname(path)));
      found.push({ ...meta, source: root.source, path });
    }
  }
  return found;
}

/** Project roots match Pi's upward search, stopping at the repository edge. */
async function projectRoots(project: string): Promise<string[]> {
  const roots: string[] = [];
  let here = resolve(project);
  while (true) {
    roots.push(join(here, '.pi', 'skills'), join(here, '.agents', 'skills'));
    const parent = dirname(here);
    if (parent === here || (await stat(join(here, '.git')).catch(() => null)) !== null) break;
    here = parent;
  }
  return roots;
}

async function packageSkillRoots(agentDir: string): Promise<string[]> {
  const out: string[] = [];
  const npmRoot = join(agentDir, 'npm', 'node_modules');
  const pkgs = await readdir(npmRoot, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  for (const entry of pkgs) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const pkgPath = join(npmRoot, entry.name);
    if (entry.name.startsWith('@')) {
      const scoped = await readdir(pkgPath, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
      for (const sub of scoped) {
        if (!sub.isDirectory()) continue;
        const subPath = join(pkgPath, sub.name);
        out.push(join(subPath, 'skills'));
        out.push(subPath);
      }
    } else {
      out.push(join(pkgPath, 'skills'));
      out.push(pkgPath);
    }
  }
  return out;
}

export async function availableSkills(project: string | null, agentDir: string): Promise<readonly AvailableSkill[]> {
  const roots: { path: string; source: Found['source'] }[] = [
    { path: join(agentDir, 'skills'), source: 'global' },
    { path: join(homedir(), '.agents', 'skills'), source: 'global' },
  ];
  // Package-installed skills (e.g. via Add More → pi-subagents) live under agentDir/npm
  if (agentDir !== '') {
    for (const p of await packageSkillRoots(agentDir)) roots.push({ path: p, source: 'global' });
  }
  if (project !== null) {
    for (const path of await projectRoots(project)) roots.push({ path, source: 'project' });
  }
  const raw = await inRoots(roots);
  const used = new Map<string, number>();
  return raw.map((one, index) => {
    const base = slug(one.name);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return { ...one, id: `${one.source}:${index}:${one.path}`, handle: count === 1 ? base : `${base}-${count}` };
  });
}

/** Resolve only from the just-discovered library; callers never choose a path. */
export async function skillNamed(
  project: string | null,
  agentDir: string,
  id: string,
): Promise<AvailableSkill | null> {
  return (await availableSkills(project, agentDir)).find((skill) => skill.id === id) ?? null;
}

export async function selectedSkills(
  project: string,
  agentDir: string,
  text: string,
): Promise<readonly AvailableSkill[]> {
  const handles = [...text.matchAll(/(?:^|\s)@([a-z0-9][a-z0-9-]*)\b/gi)].map((match) => (match[1] ?? '').toLowerCase());
  // Read what is asked for before reading what exists. Finding out what exists
  // walks every skill folder on the machine and opens every file in them, and
  // this runs on every single thing anybody types — almost none of which names
  // a skill at all. That walk was silent time between pressing send and the
  // first word coming back.
  if (handles.length === 0) return [];

  const byHandle = new Map((await availableSkills(project, agentDir)).map((skill) => [skill.handle, skill]));
  return [...new Set(handles)].flatMap((handle) => {
    const skill = byHandle.get(handle);
    return skill === undefined ? [] : [skill];
  });
}

export async function skillContents(skill: AvailableSkill): Promise<string> {
  return readFile(skill.path, 'utf8');
}
