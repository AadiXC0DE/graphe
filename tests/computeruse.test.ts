/** Computer use: the enrolment behind Settings > Computer use.
 *
 * Codex draws this as Any App, a browser row, an Excel row, Locked use, and an
 * always-allowed list. What is guarded here is the join: a master left off
 * refuses instead of asking per press, an allowed app stills the question but
 * never a refusal, and Excel asks for its own row before it asks per press.
 * Absent enrolment is the behaviour the app has always had, so every old
 * sitting keeps asking the way it always did.
 */

import { describe, expect, it } from 'vitest';

import type { ToolCall } from '../src/agent/types';
import { evaluate, type GuardFacts } from '../src/agent/guard/policy';
import {
  allowApp,
  asComputerUse,
  defaultComputerUse,
  forgetApp,
  holdSite,
  isAppAllowed,
  isExcelTarget,
  releaseSite,
  sameComputerUse,
  siteReachable,
} from '../src/work/computeruse';

const ROOT = '/work/site';

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 'c1', name, input };
}

const ctx: GuardFacts = { projectRoot: ROOT };

function enrolled(over: Partial<NonNullable<GuardFacts['computerUse']>> = {}): GuardFacts {
  return {
    ...ctx,
    computerUse: {
      anyApp: true,
      browser: true,
      excel: true,
      lockedUse: false,
      allowedApps: [],
      browserSites: [],
      ...over,
    },
  };
}

describe('the enrolment itself', () => {
  it('leaves what already worked on, and everything it grants off', () => {
    expect(defaultComputerUse.anyApp).toBe(true);
    expect(defaultComputerUse.excel).toBe(false);
    expect(defaultComputerUse.lockedUse).toBe(false);
    expect(defaultComputerUse.allowedApps).toEqual([]);
    expect(defaultComputerUse.browserSites).toEqual([]);
    expect(defaultComputerUse.browser).toBe(true);
  });

  it('reads back defensively, so a hand-edited file cannot grant itself more', () => {
    expect(asComputerUse(null)).toEqual(defaultComputerUse);
    expect(asComputerUse({ anyApp: false }).anyApp).toBe(false);
    expect(asComputerUse({ excel: 1 }).excel).toBe(false);
    expect(asComputerUse({ lockedUse: 'sure' }).lockedUse).toBe(false);
    expect(asComputerUse({ allowedApps: ['Figma', 'figma', '', 42] }).allowedApps).toEqual([
      'Figma',
    ]);
    expect(
      asComputerUse({ browserSites: ['HTTPS://Figma.com/a', 'figma.com', 'nope'] }).browserSites,
    ).toEqual(['figma.com']);
  });

  it('adds and forgets apps without doubling them', () => {
    const one = allowApp(defaultComputerUse, 'Figma');
    expect(one.allowedApps).toEqual(['Figma']);
    expect(allowApp(one, 'figma')).toBe(one);
    expect(allowApp(one, '   ')).toBe(one);
    expect(forgetApp(one, 'FIGMA').allowedApps).toEqual([]);
    expect(forgetApp(one, 'Mail')).toBe(one);
  });

  it('holds and releases sites by their host', () => {
    const one = holdSite(defaultComputerUse, 'https://www.figma.com/files');
    expect(one.browserSites).toEqual(['figma.com']);
    expect(holdSite(one, 'figma.com')).toBe(one);
    expect(holdSite(one, 'not a site')).toBe(one);
    expect(releaseSite(one, 'FIGMA.COM').browserSites).toEqual([]);
  });

  it('compares enrolments field by field', () => {
    expect(sameComputerUse(defaultComputerUse, asComputerUse(null))).toBe(true);
    expect(
      sameComputerUse(defaultComputerUse, { ...defaultComputerUse, anyApp: false }),
    ).toBe(false);
  });
});

describe('matching calls to the lists', () => {
  it('matches an app by its name field, exactly', () => {
    expect(isAppAllowed({ app: 'Figma' }, { allowedApps: ['Figma'] })).toBe(true);
    expect(isAppAllowed({ app: 'figma' }, { allowedApps: ['Figma'] })).toBe(true);
    expect(isAppAllowed({ app: 'Figma 2' }, { allowedApps: ['Figma'] })).toBe(false);
    expect(isAppAllowed({}, { allowedApps: ['Figma'] })).toBe(false);
  });

  it('recognises Excel without reading cell text', () => {
    expect(isExcelTarget({ app: 'Microsoft Excel' })).toBe(true);
    expect(isExcelTarget({ app: 'excel' })).toBe(true);
    expect(isExcelTarget({ app: 'Numbers' })).toBe(true);
    expect(isExcelTarget({ app: 'Figma' })).toBe(false);
    expect(isExcelTarget({ text: '=SUM(A1:A9)' })).toBe(false);
  });

  it('holds subdomains of a held site, and the open web when nothing is held', () => {
    expect(siteReachable('figma.com', { browserSites: [] })).toBe(true);
    expect(siteReachable('files.figma.com', { browserSites: ['figma.com'] })).toBe(true);
    expect(siteReachable('figma.com.evil.test', { browserSites: ['figma.com'] })).toBe(false);
    expect(siteReachable('example.test', { browserSites: ['figma.com'] })).toBe(false);
  });
});

describe('the master switch', () => {
  it('leaves old sittings asking the way they always did', () => {
    expect(evaluate(call('desktop_picture', {}), ctx).kind).toBe('confirm');
    expect(
      evaluate(call('desktop_do', { steps: [{ do: 'click', x: 1, y: 1 }] }), ctx).kind,
    ).toBe('confirm');
    expect(evaluate(call('desktop_open', { app: 'Figma' }), ctx).kind).toBe('confirm');
  });

  it('refuses desktop control while Any App is off, with directions', () => {
    const off = enrolled({ anyApp: false });
    for (const one of [
      call('desktop_picture', {}),
      call('desktop_do', { steps: [{ do: 'click', x: 1, y: 1 }] }),
      call('desktop_open', { app: 'Figma' }),
    ]) {
      const verdict = evaluate(one, off);
      expect(verdict.kind, one.name).toBe('deny');
      if (verdict.kind === 'deny') expect(verdict.reason).toContain('Computer use');
    }
  });

  it('holds the refusal past a yes, past quiet, and past doing', () => {
    const off = enrolled({ anyApp: false });
    const doing = call('desktop_do', { steps: [{ do: 'click', x: 1, y: 1 }] });
    expect(evaluate(doing, { ...off, screenSaidYes: true }).kind).toBe('deny');
    expect(evaluate(doing, { ...off, stopAsking: true }).kind).toBe('deny');
    expect(evaluate(doing, { ...off, howFar: 'doing' }).kind).toBe('deny');
  });

  it('still lists and reads while off: looking is not controlling', () => {
    const off = enrolled({ anyApp: false });
    expect(evaluate(call('desktop_apps', {}), off).kind).toBe('allow');
    expect(evaluate(call('desktop_read', { app: 'Figma' }), off).kind).toBe('allow');
  });
});

describe('the always-allowed list', () => {
  it('stills the question for the app on it', () => {
    const use = enrolled({ allowedApps: ['Figma'] });
    expect(evaluate(call('desktop_open', { app: 'Figma' }), use).kind).toBe('allow');
    expect(
      evaluate(call('desktop_do', { steps: [{ do: 'click', x: 1, y: 1 }], app: 'Figma' }), use)
        .kind,
    ).toBe('allow');
  });

  it('asks for the app beside it', () => {
    const use = enrolled({ allowedApps: ['Figma'] });
    expect(evaluate(call('desktop_open', { app: 'Mail' }), use).kind).toBe('confirm');
  });

  it('never stills a refusal: a key stays a key on every list', () => {
    const use: GuardFacts = {
      ...enrolled({ allowedApps: ['Figma'] }),
      knownSecretValues: ['hunter2-plaintext-value'],
    };
    const verdict = evaluate(
      call('desktop_do', {
        steps: [{ do: 'type', text: 'hunter2-plaintext-value', target: 'a1' }],
        app: 'Figma',
      }),
      use,
    );
    expect(verdict.kind).toBe('deny');
  });
});

describe('the Excel row', () => {
  it('asks for its own row before it asks per press', () => {
    const without = enrolled({ excel: false });
    const verdict = evaluate(call('desktop_open', { app: 'Microsoft Excel' }), without);
    expect(verdict.kind).toBe('confirm');
    if (verdict.kind === 'confirm') expect(verdict.question).toContain('Excel');
  });

  it('asks per press once the row is on', () => {
    const withIt = enrolled({ excel: true });
    expect(evaluate(call('desktop_open', { app: 'Microsoft Excel' }), withIt).kind).toBe(
      'confirm',
    );
  });

  it('is not answered by the always-allowed list: the row is its own question', () => {
    const listed = enrolled({ excel: false, allowedApps: ['Microsoft Excel'] });
    expect(evaluate(call('desktop_open', { app: 'Microsoft Excel' }), listed).kind).toBe(
      'confirm',
    );
  });
});

describe('locked use', () => {
  const doing = call('desktop_do', { steps: [{ do: 'click', x: 1, y: 1 }] });

  it('refuses background work the computer until it is switched on', () => {
    const background: GuardFacts = { ...enrolled({ lockedUse: false }), unattended: true };
    const verdict = evaluate(doing, background);
    expect(verdict.kind).toBe('deny');
    if (verdict.kind === 'deny') expect(verdict.reason).toContain('Locked use');
  });

  it('holds that refusal past a yes and past doing', () => {
    const background: GuardFacts = { ...enrolled({ lockedUse: false }), unattended: true };
    expect(evaluate(doing, { ...background, screenSaidYes: true }).kind).toBe('deny');
    expect(evaluate(doing, { ...background, howFar: 'doing' }).kind).toBe('deny');
  });

  it('asks as usual once it is on, and never gets in the way of a conversation', () => {
    const background: GuardFacts = { ...enrolled({ lockedUse: true }), unattended: true };
    expect(evaluate(doing, background).kind).toBe('confirm');
    expect(evaluate(doing, enrolled({ lockedUse: false })).kind).toBe('confirm');
  });
});

describe('the browser row and its sites', () => {
  it('refuses the browser while its row is off', () => {
    const off = enrolled({ browser: false });
    expect(evaluate(call('browser_open', { url: 'https://figma.com' }), off).kind).toBe('deny');
    expect(
      evaluate(call('browser_click', { target: 'e1' }), { ...off, screenSaidYes: true }).kind,
    ).toBe('deny');
  });

  it('holds the browser to the named sites', () => {
    const held = enrolled({ browserSites: ['figma.com'] });
    expect(evaluate(call('browser_open', { url: 'https://figma.com/files' }), held).kind).toBe(
      'confirm',
    );
    expect(
      evaluate(call('browser_open', { url: 'https://files.figma.com/a' }), held).kind,
    ).toBe('confirm');
    const verdict = evaluate(call('browser_open', { url: 'https://example.test' }), held);
    expect(verdict.kind).toBe('deny');
    if (verdict.kind === 'deny') expect(verdict.reason).toContain('named sites');
  });
});
