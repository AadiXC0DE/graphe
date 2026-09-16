/** Source-level contracts for the Electron-only data paths.
 *
 * `register()` and the profile singleton intentionally live behind Electron,
 * so these checks lock the ordering and failure propagation at the seam while
 * the pure service suites exercise the actual storage behavior.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MAIN = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

function block(start: string, end: string): string {
  const at = MAIN.indexOf(start);
  expect(at, `${start} moved`).toBeGreaterThanOrEqual(0);
  const until = MAIN.indexOf(end, at + start.length);
  expect(until, `${end} moved after ${start}`).toBeGreaterThan(at);
  return MAIN.slice(at, until);
}

describe('PR #51 data durability wiring', () => {
  it('returns workspace-index write failures while keeping the queue alive', () => {
    const source = block('function saveWorkspaceIndex()', '/**\n * The repository a workspace');
    expect(source).toContain('const write = writingWorkspaceIndex.then(() => writeAtomically');
    expect(source).toContain('writingWorkspaceIndex = write.catch(() => undefined);');
    expect(source).toContain('return write;');
  });

  it('uses canonical identity before de-duplicating live project opens', () => {
    const source = block('function openProject(folder: string)', '/** A saved transcript');
    expect(source).toContain('const path = canonical(folder);');
    expect(source).not.toContain('const path = resolve(folder);');
  });

  it('uses canonical identity for every live project lookup', () => {
    const source = block('function projectAt(where: Where)', '/** The conversation named');
    expect(source).toContain('canonical(where.project)');
    expect(source).not.toContain('resolve(where.project)');
  });

  it('records a new conversation transcript before adopting its address', () => {
    const source = block('async function noteWhereItWorks(', '/**\n * A checkout that exists');
    expect(source).toContain('session: GrapheSession');
    expect(source).toContain('title: session.name ?? \'\'');
    expect(source).toContain('sessionFile: session.conversation');
    expect(MAIN).toContain('noteWhereItWorks(open, address, checkout?.folder ?? null, session)');
  });

  it('retains a stopped copy session until land/drop has really succeeded', () => {
    const land = block('async function landTheCopy(', 'handle<null>(CHANNEL.worktreeDrop');
    expect(land.indexOf('await stopCopyConversation')).toBeGreaterThanOrEqual(0);
    expect(land.indexOf('await stopCopyConversation')).toBeLessThan(land.indexOf('await reopenCheckout'));
    expect(land).toContain('await putDownCopyConversation');

    const drop = block('handle<null>(CHANNEL.worktreeDrop', '/* ------------------------------------------ every copy');
    expect(drop.indexOf('await stopCopyConversation')).toBeGreaterThanOrEqual(0);
    expect(drop).toContain('if (dropped.ok)');
    expect(drop.indexOf('await putDownCopyConversation')).toBeGreaterThan(drop.indexOf('if (dropped.ok)'));

    const review = block('handle<ReviewDecided>(CHANNEL.reviewLand', 'handle<');
    expect(review.indexOf('await stopCopyConversation')).toBeGreaterThanOrEqual(0);
    expect(review.indexOf('await stopCopyConversation')).toBeLessThan(review.indexOf('landWorktree'));
    expect(review).toContain('await putDownCopyConversation');
  });

  it('scopes restored views and terminals to the named project/workspace', () => {
    const views = block('handle<readonly ViewShown[]>(CHANNEL.viewsLook', '/* ---------------------------------------------------------------- canvas */');
    expect(views).toContain('viewInPaneForProject(index, pane, project.projectId)');
    expect(views).toContain('noteViewForProject(next, one, project.projectId)');
    expect(views).toContain('viewInProject(next, view, project.projectId)');
    const terminals = block('handle<readonly TerminalSession[]>(CHANNEL.terminalList', '/**\n   * What a New worktree');
    expect(terminals).toContain('canonical(folderFor(open, where))');
    expect(terminals).toContain('canonical(one.workspace) === folder');
  });

  it('cleans failed canvas worktree setup without discarding recovery ownership', () => {
    const canvas = block('async openLane(lane: Lane)', '    // eslint-disable-next-line @typescript-eslint/no-unused-vars');
    expect(canvas).toContain('let workspace: WorkspaceRecord | null = null;');
    expect(canvas).toContain('await started.session.stop().catch(() => undefined);');
    expect(canvas).toContain('putDown(open.held, started.address);');
    expect(canvas).toContain('dropWorktree(gitRunHereFor(), open.path, made.value.folder)');
    expect(canvas).toContain('markDeleted(workspaceIndex, workspace.workspaceId)');
    expect(canvas).toContain('Cleanup was incomplete');
  });
});
