/** The shell-safe reader of Pi's own workflow prompt files.
 *
 * Pi turns `*.md` in a prompts folder into a slash command, so the workflow
 * the window can list and trigger is exactly the one the running agent can
 * answer — the same folder, read the same way, by the process that holds the
 * session. Nothing here executes a workflow; it reads the markdown and leaves
 * the parsing to the pure work in `src/work/workflows.ts`, which is what is
 * tested.
 */

import { homedir } from 'node:os';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { FolderRead, Workflow } from '../../work/workflows';
import { workflowsFrom } from '../../work/workflows';

/** Project roots match Pi's own upward search, stopping at the repository edge. */
async function projectRoots(project: string): Promise<string[]> {
  const roots: string[] = [];
  let here = resolve(project);
  while (true) {
    roots.push(join(here, '.pi', 'prompts'));
    const parent = dirname(here);
    if (parent === here || (await stat(join(here, '.git')).catch(() => null)) !== null) break;
    here = parent;
  }
  return roots;
}

async function readFolder(folderWithSource: {
  path: string;
  source: 'global' | 'project';
}): Promise<FolderRead> {
  const dir = folderWithSource.path;
  const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: { name: string; body: string }[] = [];
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const body = await readFile(join(dir, entry.name), 'utf8').catch(() => '');
    if (body === '') continue;
    out.push({ name: entry.name, body });
  }
  return out;
}

/** Every workflow the window and the agent can both see, for one project. */
export async function availableWorkflows(
  project: string | null,
  agentDir: string,
): Promise<readonly Workflow[]> {
  const globalCells: { path: string; source: 'global' | 'project' }[] = [
    { path: join(agentDir, 'prompts'), source: 'global' },
    { path: join(homedir(), '.pi', 'prompts'), source: 'global' },
  ];
  const projectCells: { path: string; source: 'global' | 'project' }[] = [];
  if (project !== null && project !== '') {
    for (const path of await projectRoots(project)) projectCells.push({ path, source: 'project' });
  }

  const global = (
    await Promise.all(globalCells.map((cell) => readFolder(cell)))
  ).flat();
  const proj = (
    await Promise.all(projectCells.map((cell) => readFolder(cell)))
  ).flat();

  return workflowsFrom(proj, global);
}

/** The one a typed `/command` names, or null. */
export async function workflowNamed(
  project: string | null,
  agentDir: string,
  command: string,
): Promise<Workflow | null> {
  const wanted = command.startsWith('/') ? command : `/${command}`;
  return (await availableWorkflows(project, agentDir)).find((one) => one.command === wanted) ?? null;
}
