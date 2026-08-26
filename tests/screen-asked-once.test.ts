/** A yes to working the screen lasts the turn.
 *
 * Every press, every screenshot and every click used to put its own card up,
 * at every rung, with nothing that turned it off. A run of twenty moves in
 * Figma became a queue of twenty questions, each waiting on a hand.
 */

import { describe, expect, it } from 'vitest';
import { asksAboutTheScreen, evaluate, worksAScreen } from '../src/agent/guard/policy';
import type { GuardFacts } from '../src/agent/guard/policy';
import type { ToolCall } from '../src/agent/guard/policy';

const call = (name: string, input: Record<string, unknown>): ToolCall =>
  ({ name, input, id: '1' }) as ToolCall;
const at = (extra: Partial<GuardFacts> = {}): GuardFacts =>
  ({ reach: 'doing', projectRoot: '/p', trusted: true, ...extra }) as GuardFacts;

const A_KEY = `sk-ant-api03-${'A'.repeat(80)}`;

describe('the first time, it asks', () => {
  for (const [what, one] of [
    ['a press on this computer', call('desktop_do', { steps: [{ do: 'click', x: 1, y: 2 }] })],
    ['a picture of the screen', call('desktop_picture', {})],
    ['a press in the browser', call('browser_click', { what: 'Sign in' })],
    ['a run in the browser', call('browser_steps', { steps: [{ do: 'click', what: 'a' }] })],
  ] as const) {
    it(what, () => {
      expect(evaluate(one, at()).kind).toBe('confirm');
    });
  }
});

describe('after yes, the rest of the turn goes', () => {
  for (const [what, one] of [
    ['a press on this computer', call('desktop_do', { steps: [{ do: 'click', x: 1, y: 2 }] })],
    ['a picture of the screen', call('desktop_picture', {})],
    ['a press in the browser', call('browser_click', { what: 'Sign in' })],
    ['a run in the browser', call('browser_steps', { steps: [{ do: 'click', what: 'a' }] })],
  ] as const) {
    it(what, () => {
      expect(evaluate(one, at({ screenSaidYes: true })).kind).toBe('allow');
    });
  }
});

describe('what a yes does not buy', () => {
  it('never carries a key into a program', () => {
    const one = call('desktop_do', { steps: [{ do: 'type', text: A_KEY }] });
    expect(evaluate(one, at()).kind).toBe('deny');
    expect(evaluate(one, at({ screenSaidYes: true })).kind).toBe('deny');
  });

  it('never carries a key into a page', () => {
    const one = call('browser_steps', { steps: [{ do: 'type', text: A_KEY }] });
    expect(evaluate(one, at({ screenSaidYes: true })).kind).toBe('deny');
  });

  it('still asks which site to open, because that is a different question', () => {
    const one = call('browser_open', { url: 'https://figma.com' });
    expect(evaluate(one, at({ screenSaidYes: true })).kind).toBe('confirm');
  });

  it('does nothing for work that is not the screen', () => {
    const one = call('bash', { command: 'rm -rf /' });
    expect(evaluate(one, at({ screenSaidYes: true })).kind).not.toBe('allow');
  });
});

describe('driving the screen from a shell command', () => {
  for (const command of [
    '/opt/homebrew/bin/cliclick c:400,150',
    `osascript -e 'tell application "Figma" to activate'`,
    'xdotool mousemove 400 150 click 1',
  ]) {
    it(`refuses ${command.split(' ')[0] ?? ''} and names the tool that does it`, () => {
      const verdict = evaluate(call('bash', { command }), at());
      expect(verdict.kind).toBe('deny');
      if (verdict.kind !== 'deny') return;
      expect(verdict.reason).toMatch(/desktop_do/);
    });
  }
});

describe('which calls a yes is remembered for', () => {
  it('counts a picture of the screen, which worksAScreen does not', () => {
    expect(asksAboutTheScreen(call('desktop_picture', {}))).toBe(true);
    expect(worksAScreen(call('desktop_picture', {}))).toBe(false);
  });

  it('does not count reading what is open', () => {
    expect(asksAboutTheScreen(call('desktop_apps', {}))).toBe(false);
  });
});
