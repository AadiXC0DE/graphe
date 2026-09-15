/** The dialog host an add-on talks to, and what it does when there is no dialog
 *  to draw.
 *
 * The failure this guards is specific: an add-on asks a question, gets the
 * default no-op interface, and carries on as though somebody answered. So a
 * cancellation has to come back distinguishable from an answer, and the
 * terminal-only half has to be visible instead of silently successful.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  dialogsOver,
  unsupportedTerminal,
  type ExtensionAnswer,
  type ExtensionAsk,
} from '../src/agent/pi/extension-ui';

function answering(answer: ExtensionAnswer | ((ask: ExtensionAsk) => ExtensionAnswer)) {
  const asked: ExtensionAsk[] = [];
  const ask = (one: ExtensionAsk): Promise<ExtensionAnswer> => {
    asked.push(one);
    return Promise.resolve(typeof answer === 'function' ? answer(one) : answer);
  };
  return { ask, asked };
}

describe('a select', () => {
  it('sends the choices with their labels, and gives back the value chosen', async () => {
    const { ask, asked } = answering({ kind: 'select', value: 'two' });
    const host = dialogsOver(ask);
    expect(await host.select('Which one?', ['one', 'two'])).toBe('two');
    expect(asked[0]).toEqual({
      kind: 'select',
      title: 'Which one?',
      options: [
        { label: 'one', value: 'one' },
        { label: 'two', value: 'two' },
      ],
      timeoutMs: null,
    });
  });

  it('returns nothing chosen when it is cancelled, rather than an empty choice', async () => {
    const { ask } = answering({ kind: 'select', value: null });
    expect(await dialogsOver(ask).select('Which one?', ['one'])).toBeUndefined();
  });

  it('carries a timeout when the add-on asked for one', async () => {
    const { ask, asked } = answering({ kind: 'select', value: null });
    await dialogsOver(ask).select('Which one?', ['one'], { timeout: 5000 });
    expect(asked[0]?.kind === 'select' ? asked[0].timeoutMs : null).toBe(5000);
  });

  it('treats a zero timeout as none, which is what it means', async () => {
    const { ask, asked } = answering({ kind: 'select', value: null });
    await dialogsOver(ask).select('Which one?', ['one'], { timeout: 0 });
    expect(asked[0]?.kind === 'select' ? asked[0].timeoutMs : 1).toBeNull();
  });
});

describe('a confirmation', () => {
  it('is a yes when somebody said yes', async () => {
    const { ask } = answering({ kind: 'confirm', value: true });
    expect(await dialogsOver(ask).confirm('Delete it?', 'This cannot be undone.')).toBe(true);
  });

  it('is a no when nobody answered, which is not the same as a yes', async () => {
    const { ask } = answering({ kind: 'select', value: null });
    expect(await dialogsOver(ask).confirm('Delete it?', 'This cannot be undone.')).toBe(false);
  });

  it('asks with the sentence the add-on wrote', async () => {
    const { ask, asked } = answering({ kind: 'confirm', value: false });
    await dialogsOver(ask).confirm('Delete it?', 'This cannot be undone.');
    expect(asked[0]).toMatchObject({ kind: 'confirm', message: 'This cannot be undone.' });
  });
});

describe('an input', () => {
  it('gives back the text typed', async () => {
    const { ask } = answering({ kind: 'input', value: 'a name' });
    expect(await dialogsOver(ask).input('What shall it be called?')).toBe('a name');
  });

  it('distinguishes an empty answer from no answer', async () => {
    const empty = answering({ kind: 'input', value: '' });
    expect(await dialogsOver(empty.ask).input('Name?')).toBe('');
    const cancelled = answering({ kind: 'input', value: null });
    expect(await dialogsOver(cancelled.ask).input('Name?')).toBeUndefined();
  });

  it('passes the placeholder along when there is one', async () => {
    const { ask, asked } = answering({ kind: 'input', value: null });
    await dialogsOver(ask).input('Name?', 'index');
    expect(asked[0]?.kind === 'input' ? asked[0].placeholder : '').toBe('index');
  });
});

describe('an editor', () => {
  it('opens with what the add-on wanted to start from', async () => {
    const { ask, asked } = answering({ kind: 'editor', value: 'edited' });
    expect(await dialogsOver(ask).editor('Rewrite this', 'the original')).toBe('edited');
    expect(asked[0]).toEqual({ kind: 'editor', title: 'Rewrite this', prefill: 'the original' });
  });

  it('gives back nothing when it is closed without sending', async () => {
    const { ask } = answering({ kind: 'editor', value: null });
    expect(await dialogsOver(ask).editor('Rewrite this')).toBeUndefined();
  });
});

describe('the terminal-only half', () => {
  it('says so once per method, not once per call', () => {
    const say = vi.fn();
    const terminal = unsupportedTerminal(say);
    terminal.note('setWidget');
    terminal.note('setWidget');
    terminal.note('setFooter');
    expect(say).toHaveBeenCalledTimes(2);
    expect(say).toHaveBeenCalledWith('terminal', 'setWidget');
  });

  it('fails a promise rather than returning a component nobody can see', async () => {
    const say = vi.fn();
    await expect(unsupportedTerminal(say).fail('custom')).rejects.toThrow(/terminal/);
    expect(say).toHaveBeenCalledWith('terminal', 'custom');
  });

  it('refuses to hand back a theme it does not have', () => {
    const say = vi.fn();
    expect(() => unsupportedTerminal(say).theme()).toThrow(/terminal theme/);
    expect(say).toHaveBeenCalledWith('terminal', 'theme');
  });
});
