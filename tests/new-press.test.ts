/** One press of New is one conversation.
 *
 * The window asks the shell for a new chat, and the same request can arrive
 * twice: a retry, a renderer that asked again, a second IPC for one button.
 * Without a name for the press, the second arrival is a second conversation
 * nobody asked for, and two chats with nothing in them are two chats nobody can
 * tell apart. A genuine second press carries a name of its own and is still
 * allowed to make its own draft, which is the half the plan is emphatic about.
 *
 *  Source text, not behaviour: what reaches startConversation and with which argument; no behavioural test can reach it — main.ts needs an Electron process and no test renders App.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { Answered } from '../src/lib/answered';
import { openingFor } from '../src/agent/pi/conversations';

const MAIN = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
const PRELOAD = readFileSync(join(process.cwd(), 'electron', 'preload.ts'), 'utf8');
const APP = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

const AT = 1_700_000_000_000;

describe('the answer to one press', () => {
  it('is the same answer when the same press arrives twice', async () => {
    const answers = new Answered<{ conversation: string }>();
    const make = vi.fn(async () => ({ conversation: `chat-${String(make.mock.calls.length)}` }));

    const first = await answers.answering('press-1', make, AT);
    const again = await answers.answering('press-1', make, AT + 1_000);

    expect(make).toHaveBeenCalledTimes(1);
    expect(again).toEqual(first);
    // And one record, which is the whole point: the factory is what writes it.
    expect(first.conversation).toBe('chat-1');
  });

  it('is a second answer when somebody really did press it again', async () => {
    const answers = new Answered<string>();
    const make = (which: string) => async (): Promise<string> => which;
    expect(await answers.answering('press-1', make('one'), AT)).toBe('one');
    expect(await answers.answering('press-2', make('two'), AT)).toBe('two');
    expect(answers.held).toBe(2);
  });

  it('is forgotten once the press is old, so nobody is handed yesterday', async () => {
    const answers = new Answered<string>({ window: 60_000 });
    const make = vi.fn(async () => 'made');
    await answers.answering('press-1', make, AT);
    await answers.answering('press-1', make, AT + 90_000);
    expect(make).toHaveBeenCalledTimes(2);
    expect(answers.held).toBe(1);
  });

  it('is not kept when there was no answer to keep', async () => {
    const answers = new Answered<string>();
    let tries = 0;
    const failing = async (): Promise<string> => {
      tries += 1;
      throw new Error('the session would not start');
    };
    await expect(answers.answering('press-1', failing, AT)).rejects.toThrow();
    await expect(answers.answering('press-1', failing, AT + 1)).rejects.toThrow();
    // Two tries, because a refusal is not something to answer the next press
    // with.
    expect(tries).toBe(2);
    expect(answers.held).toBe(0);
  });

  it('does not grow without bound over a long sitting', async () => {
    const answers = new Answered<string>({ most: 4 });
    for (let one = 0; one < 20; one += 1) {
      await answers.answering(`press-${String(one)}`, async () => String(one), AT + one);
    }
    expect(answers.held).toBe(4);
  });
});

describe('how a press reaches the shell', () => {
  it('travels with the opening, and only when a fresh chat was asked for', () => {
    expect(openingFor(null, true, 'press-1')).toEqual({ kind: 'fresh', key: 'press-1' });
    // A saved conversation is idempotent by its own address; the press is not
    // what makes it one.
    expect(openingFor('/chats/one.jsonl', true, 'press-1')).toEqual({
      kind: 'carry-on',
      path: '/chats/one.jsonl',
    });
    // A key that came from nowhere is the same as no key at all.
    expect(openingFor(null, true, '  ')).toEqual({ kind: 'fresh' });
    expect(openingFor(null, true)).toEqual({ kind: 'fresh' });
  });

  it('is remembered by the shell for the short window, by press and project', () => {
    const start = MAIN.slice(
      MAIN.indexOf('async function startConversation('),
      MAIN.indexOf('type Started ='),
    );
    expect(start).toContain('presses.answering(`${open.path}\\u0000${pressed}`');
    // Fresh opens are serialized by the press; a saved one still by its address.
    expect(start).toContain('openingConversations');
  });

  it('is named by the window when it presses New, and by nobody else', () => {
    // Generated at the press, so two presses are two conversations.
    expect(APP).toContain('newPress()');
    expect(APP).toContain('path === null ? newPress() : null');
    // And it is the third argument, ahead of the call's own context.
    expect(PRELOAD).toContain('fresh ? pressed : null,');
    expect(PRELOAD).toContain('named(where),');
  });
});
