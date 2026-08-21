import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../src/lib/bridge.ts', import.meta.url), 'utf8');

describe('the branch panel describes the addressed conversation', () => {
  it('reads git and branches from its checkout rather than always open.path', () => {
    const start = main.indexOf('handle<Overview>(CHANNEL.overview');
    const block = main.slice(start, start + 1700);
    expect(block).toContain('checkoutEntryFor(open, where)?.folder ?? open.path');
    expect(block).toContain('readGitStatus(cwd)');
    expect(block).toContain('readBranches(cwd)');
    expect(block).not.toContain('readGitStatus(open.path)');
  });

  it('passes project and conversation through the window bridge', () => {
    expect(bridge).toContain('overview: (where) => api.overview(where)');
    expect(app).toContain('const refreshOverview = useCallback(async (path: string, conversation?: string | null)');
    expect(app).toContain('bridge.overview(where)');
    expect(app).toContain('refreshOverview(where, notice.conversation)');
  });

  it('targets branch controls at that same conversation checkout', () => {
    expect(app).toContain('branchMove((where) => bridge.branchSwitch(name, where))');
    expect(app).toContain('branchMove((where) => bridge.branchCreate(name, where))');
    const switched = main.slice(
      main.indexOf('handle<null>(CHANNEL.branchSwitch'),
      main.indexOf('handle<null>(CHANNEL.branchCreate'),
    );
    expect(switched).toContain('const cwd = entry?.folder ?? open.path');
    expect(switched).toContain("gitRun(cwd, ['checkout', name])");
  });

  it('records a branch the agent changed through bash before reopening', () => {
    expect(main).toContain('async function syncCheckoutBranch');
    expect(main).toContain("gitRun(one.folder, ['rev-parse', '--abbrev-ref', 'HEAD'])");
    expect(main).toContain('void syncCheckoutBranch(path, held, from.address)');
    expect(main).toContain('remembered.branch = name');
    expect(main).toContain('remembered.branch = clean');
  });
});
