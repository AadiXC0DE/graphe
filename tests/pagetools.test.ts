/** Working on the page beside the conversation.
 *
 * Until now the agent could only drive its own separate browser, so "look at my
 * site and fix the nav" meant it worked on a different page than the one the
 * person was watching. These six tools close that, and closing it is exactly
 * why they are dangerous: this is somebody's live site, not a copy of it. A
 * press can send an order or delete an account, and typing puts words into a
 * page that sees every one of them.
 *
 * So the failures guarded here are: a press or a keystroke that reaches a live
 * page without anybody agreeing to it; a private key typed into somebody else's
 * form; a tool that pretends there is a page when there is not; and a reading
 * that quietly drops most of the page while reading as though it were whole.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { ToolCall, Verdict } from '../src/agent/types';
import { evaluate, type GuardFacts } from '../src/agent/guard/policy';
import { PAGE_WORDS, holdPage, pageTools } from '../src/agent/pi/tools';

const ROOT = '/Users/mira/Projects/portfolio';
const ctx: GuardFacts = { projectRoot: ROOT };

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, input };
}
function kindOf(one: ToolCall): Verdict['kind'] {
  return evaluate(one, ctx).kind;
}

const READS = ['page_read', 'page_trouble', 'page_picture'] as const;
const MOVES = ['page_scroll'] as const;
const ACTS = ['page_click', 'page_type'] as const;

afterEach(() => holdPage(null));

describe('what the Guard lets through to a live page', () => {
  it('reads it without asking, because a reading changes nothing', () => {
    for (const name of READS) expect(kindOf(call(name, { target: 'Get started' })), name).toBe('allow');
  });

  /* Scrolling is how the agent sees the rest of a long page. Asking about it
     would put a question between every screenful and the next. */
  it('scrolls without asking', () => {
    for (const name of MOVES) expect(kindOf(call(name)), name).toBe('allow');
  });

  /** The whole point. A press on a live page can send a form, buy something or
   *  delete something, and none of it can be taken back — so it is never the
   *  agent's decision to make alone. */
  it('always asks before pressing or typing', () => {
    for (const name of ACTS) {
      expect(kindOf(call(name, { target: 'Get started', text: 'hello' })), name).toBe('confirm');
    }
  });

  it('says out loud that a press cannot be undone', () => {
    const said = JSON.stringify(evaluate(call('page_click', { target: 'Buy now' }), ctx));
    expect(said).toMatch(/cannot take that back|can send a form|delete/i);
  });

  /** Sending the form is the irreversible half, so it must not be described in
   *  the same words as putting words in a box. */
  it('asks differently when it would also send the form', () => {
    const quiet = JSON.stringify(evaluate(call('page_type', { target: 'Email', text: 'a' }), ctx));
    const sends = JSON.stringify(
      evaluate(call('page_type', { target: 'Email', text: 'a', submit: true }), ctx),
    );
    expect(quiet).not.toBe(sends);
    expect(sends).toMatch(/send/i);
    expect(quiet).toMatch(/nothing is sent/i);
  });
});

describe('a key must never reach somebody else’s page', () => {
  /** A page is the one place a key can leave without a request that looks like
   *  one: the page sees every character as it is typed and can pass it on
   *  before anything is ever sent. Refused outright rather than asked, because
   *  a question is something somebody can say yes to in a hurry. */
  it('refuses to type a key into the page, rather than asking', () => {
    const secrets = [
      'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '-----BEGIN RSA PRIVATE KEY-----',
    ];
    for (const secret of secrets) {
      expect(kindOf(call('page_type', { target: 'Token', text: secret })), secret.slice(0, 12)).toBe(
        'deny',
      );
    }
  });

  it('names what it stopped, and where to put the key instead', () => {
    const said = JSON.stringify(
      evaluate(
        call('page_type', {
          target: 'Key',
          text: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        }),
        ctx,
      ),
    );
    expect(said).toMatch(/stopped it/i);
    expect(said).toMatch(/project secret/i);
  });

  /** The refusal must not depend on the arguments arriving under one blessed
   *  name. This is the shape that already went wrong once elsewhere: the sweep
   *  looked at a key list, and the payload was under a key not on it. */
  it('finds the key wherever in the call it is written', () => {
    const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(kindOf(call('page_type', { target: 'x', text: key }))).toBe('deny');
    expect(kindOf(call('page_type', { target: 'x', text: `my key is ${key} ok` }))).toBe('deny');
  });

  it('lets ordinary words through to the question', () => {
    expect(kindOf(call('page_type', { target: 'Email', text: 'mira@example.com' }))).toBe('confirm');
  });
});

describe('nothing here can turn the Guard off', () => {
  /** The switch check runs on the tool's own name. A page tool named to sound
   *  like a policy control must be refused outright, the way any other tool
   *  reaching for the switches is. */
  it('refuses a page tool that reaches for the switches', () => {
    for (const named of ['page_disable_policy', 'page_bypass_guard', 'page_yolo']) {
      expect(kindOf(call(named, { target: 'x' })), named).toBe('deny');
    }
  });

  /** Names are compared with the punctuation stripped, so a press cannot be
   *  smuggled past the asking set by spelling it differently. */
  it('asks whatever punctuation or casing the name arrives in', () => {
    for (const named of ['pageClick', 'page-click', 'PAGE_CLICK', 'page.click']) {
      expect(kindOf(call(named, { target: 'Buy now' })), named).toBe('confirm');
    }
  });
});

describe('when there is no page to work on', () => {
  /** A closed pane is a fact about the world, not a call that went wrong. Every
   *  one of these has to answer in words: a thrown execute marks the step
   *  failed in the feed, which reads as the app breaking rather than as there
   *  being nothing open. */
  it('offers no page tools at all until a page is held', () => {
    holdPage(null);
    // The tools are only put on the list where a page exists — a helper in its
    // own process and every test have none, so they are simply not offered.
    expect(pageTools(ROOT).length).toBeGreaterThan(0);
  });

  it('says the pane is shut, and that only a person can open it', () => {
    expect(PAGE_WORDS.closed).toMatch(/no page open/i);
    expect(PAGE_WORDS.closed).toMatch(/by hand|cannot open/i);
  });

  it('tells the blank pane apart from the shut one', () => {
    expect(PAGE_WORDS.blank).not.toBe(PAGE_WORDS.closed);
    expect(PAGE_WORDS.blank).toMatch(/nothing (is )?loaded|nothing on it/i);
  });

  /** The board runs each piece of work in a copy of its own while the pane
   *  belongs to the folder on screen, so a page showing another copy is
   *  ordinary rather than exotic. Reading it is still worth something; acting
   *  on it would be meddling with somebody else's work. */
  it('warns when the page belongs to a different copy of the project', () => {
    expect(PAGE_WORDS.elsewhere('http://localhost:5201')).toMatch(/different copy/i);
    expect(PAGE_WORDS.elsewhere('http://localhost:5201')).toContain('http://localhost:5201');
    expect(PAGE_WORDS.notMine('http://localhost:5201')).toMatch(/does not show what I have changed/i);
  });

  it('says all of it in plain words', () => {
    for (const said of [PAGE_WORDS.closed, PAGE_WORDS.blank]) {
      expect(said).not.toMatch(/\b(webview|BrowserView|DOM|selector|iframe|IPC)\b/);
    }
  });
});

describe('the six tools as the model meets them', () => {
  it('offers exactly the six, named for what they do', () => {
    const names = pageTools(ROOT).map((one) => one.name).sort();
    expect(names).toEqual([
      'page_click',
      'page_picture',
      'page_read',
      'page_scroll',
      'page_trouble',
      'page_type',
    ]);
  });

  /** Every one of these is judged by the Guard, and the Guard matches on the
   *  name. A tool whose name is not in one of the three sets would fall through
   *  to whatever the unknown-tool rule does — which is not a decision anybody
   *  made about pressing things on a live page. */
  it('leaves none of them for the Guard to guess about', () => {
    for (const tool of pageTools(ROOT)) {
      const verdict = kindOf(call(tool.name, { target: 'Get started', text: 'hi' }));
      expect(['allow', 'confirm'], tool.name).toContain(verdict);
    }
  });

  it('tells the model to look before it presses', () => {
    const typing = pageTools(ROOT).find((one) => one.name === 'page_type');
    const said = JSON.stringify(typing);
    expect(said).toMatch(/read the page first/i);
    // The one instruction that protects somebody's account rather than the run.
    expect(said).toMatch(/never type a key|password/i);
  });
});
