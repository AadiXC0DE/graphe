// @vitest-environment jsdom
/** The Checkouts band, drawn: one card per conversation with a copy.
 *
 * The test that matters most here is the one about the press that removes
 * something. The band never draws a one-press way to lose writing no branch is
 * carrying; it draws the sentence that says why instead.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Result, WorkspaceFacts } from '../src/lib/ipc';
import { workspaceWords } from '../src/work/workspaces';

/* -------------------------------------------------------------------------- */
/* The band, drawn                                                             */
/* -------------------------------------------------------------------------- */

/** The shell, as the band asks it. Every press is one call, so the fakes are
 *  the whole of what the band is allowed to reach for. */
const asked = {
  checkouts: vi.fn((..._args: unknown[]) => Promise.resolve(EMPTY)),
  checkoutFront: vi.fn((..._args: unknown[]) => Promise.resolve(EMPTY)),
  checkoutLook: vi.fn((..._args: unknown[]) => Promise.resolve(NO_DIFF)),
  checkoutLand: vi.fn((..._args: unknown[]) => Promise.resolve(EMPTY)),
  checkoutPutAway: vi.fn((..._args: unknown[]) => Promise.resolve(EMPTY)),
};

const EMPTY: Result<readonly WorkspaceFacts[]> = { ok: true, value: [] };
const NO_DIFF: Result<string> = { ok: true, value: '' };

vi.mock('../src/lib/bridge', () => ({ bridge: asked }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

function facts(over: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
  return {
    address: '/sessions/a.jsonl',
    title: 'The header',
    branch: 'graphe/conversation-1',
    base: 'main',
    changed: 3,
    added: 40,
    removed: 4,
    lastAt: 1_000,
    cost: null,
    run: 'settled',
    landed: false,
    away: false,
    holdsWork: false,
    ...over,
  };
}

async function draw(all: readonly WorkspaceFacts[], props: Record<string, unknown> = {}) {
  asked.checkouts.mockResolvedValue({ ok: true, value: all });
  const { default: Checkouts } = await import('../src/components/Checkouts');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(Checkouts, { branch: 'main', ...props }));
    await Promise.resolve();
  });
  return host;
}

function pressNamed(where: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...where.querySelectorAll('button')].find((one) => one.textContent?.trim() === label);
}

describe('the band, drawn', () => {
  it('says so plainly when no conversation has a copy', async () => {
    const where = await draw([]);
    expect(where.textContent).toContain(workspaceWords.nothing);
  });

  it('puts the copy that wants a person above the one quietly getting on', async () => {
    const where = await draw([
      facts({ address: '/a', title: 'Quietly working', run: 'running', changed: 0 }),
      facts({ address: '/b', title: 'Stopped to ask', run: 'asking' }),
    ]);
    const names = [...where.querySelectorAll('.copies__name')].map((one) => one.textContent);
    expect(names).toEqual(['Stopped to ask', 'Quietly working']);
    expect(where.textContent).toContain('1 for you');
  });

  it('says the state, the tally and the branch on every card', async () => {
    const where = await draw([facts()]);
    expect(where.textContent).toContain(workspaceWords.states['ready to review']);
    expect(where.textContent).toContain('3 files +40 −4 from main');
    expect(where.querySelector('.copies__branch')?.textContent).toBe('graphe/conversation-1');
  });

  /* The one that matters. Putting a copy away is giving the folder back; a copy
     holding writing no branch carries keeps it, and the band has to say why
     rather than quietly doing nothing. */
  it('will not offer to put away a copy holding writing its branch does not', async () => {
    const where = await draw([facts({ holdsWork: true })]);
    const press = pressNamed(where, workspaceWords.putAway);
    expect(press?.disabled).toBe(true);
    expect(press?.title).toBe(workspaceWords.holds);
    expect(where.textContent).toContain(workspaceWords.holds);
  });

  it('never draws a press that throws work away', async () => {
    const where = await draw([facts(), facts({ address: '/b', holdsWork: true })]);
    const labels = [...where.querySelectorAll('button')].map((one) => one.textContent ?? '');
    expect(labels.some((one) => /discard|delete|throw/i.test(one))).toBe(false);
    expect(labels).toContain(workspaceWords.putAway);
  });

  it('offers landing only where there is something to land', async () => {
    const nothing = await draw([facts({ changed: 0, run: 'running' })]);
    expect(pressNamed(nothing, workspaceWords.land)).toBeUndefined();
    act(() => root?.unmount());
    host?.remove();

    const something = await draw([facts()]);
    expect(pressNamed(something, workspaceWords.land)).toBeDefined();
  });

  it('does not offer to move the project onto the branch it is already on', async () => {
    const where = await draw([facts({ branch: 'main' })]);
    expect(pressNamed(where, workspaceWords.bringForward)).toBeUndefined();
  });

  it('says where the work of a copy that was given back has gone', async () => {
    const where = await draw([facts({ away: true, run: 'settled' })]);
    expect(where.textContent).toContain(workspaceWords.awayDetail);
    expect(pressNamed(where, workspaceWords.putAway)).toBeUndefined();
  });

  it('asks the shell for the change, and draws it', async () => {
    asked.checkoutLook.mockResolvedValue({
      ok: true,
      value: [
        'diff --git a/one.txt b/one.txt',
        '--- a/one.txt',
        '+++ b/one.txt',
        '@@ -1 +1 @@',
        '-one',
        '+two',
      ].join('\n'),
    });
    const where = await draw([facts()]);
    await act(async () => {
      pressNamed(where, 'Compare')?.click();
      await Promise.resolve();
    });
    expect(asked.checkoutLook).toHaveBeenCalledWith('/sessions/a.jsonl', undefined);
    // Out to the body, so it is not trapped in the panel's stacking context.
    const sheet = document.body.querySelector('.sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.parentElement).toBe(document.body);
    expect(sheet?.textContent).toContain('one.txt');
  });

  it('hands the shell’s refusal back rather than swallowing it', async () => {
    asked.checkoutPutAway.mockResolvedValue({
      ok: false,
      trouble: { what: 'This copy is keeping its folder.', because: workspaceWords.holds, actionLabel: 'Got it' },
    });
    const where = await draw([facts()]);
    await act(async () => {
      pressNamed(where, workspaceWords.putAway)?.click();
      await Promise.resolve();
    });
    expect(where.querySelector('.copies__trouble')?.textContent).toContain(
      'This copy is keeping its folder.',
    );
  });
});
