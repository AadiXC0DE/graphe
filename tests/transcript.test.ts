/** A conversation, ready to paste.
 *
 * Two things are being kept honest here. What comes out has to read as a
 * document once it lands in an issue or a message — speaker headings, the
 * answer and not the machinery. And nothing of ours may survive into it: a turn
 * id or a call number pasted into somebody's file is a leak, not a transcript.
 */

import { describe, expect, it } from 'vitest';

import { asMarkdown, wordsOf, worthCopying, COPY_WORDS } from '../src/lib/transcript';
import type { Turn } from '../src/lib/thread';
import type { ReviewVerdict } from '../src/agent/types';

function you(text: string): Turn {
  return { kind: 'said', id: 'turn-1', from: 'you', text, streaming: false };
}

function graphe(text: string): Turn {
  return { kind: 'said', id: 'turn-2', from: 'graphe', text, streaming: false };
}

function step(label: string, detail?: string): Turn {
  return { kind: 'did', id: 'turn-3', callId: 'call-9', state: 'done', label, detail };
}

const PLAN: Turn = {
  kind: 'plan',
  id: 'turn-4',
  text: 'Tighten the header',
  steps: ['Read the header', 'Change the padding', 'Look at it'],
  caveats: ['The mobile layout shares this file'],
  questions: [],
  answered: 'went-ahead',
};

function reviewed(verdict: ReviewVerdict): Turn {
  return { kind: 'review', id: 'turn-5', verdict, asked: false };
}

const REVIEW = reviewed({
  kind: 'needs-work',
  summary: 'Two things to fix before this lands.',
  findings: [
    { priority: 1, confidence: 90, file: 'src/App.tsx', line: 42, issue: 'The timer is never cleared.' },
    { priority: 2, confidence: 70, issue: 'No test covers the empty case.' },
  ],
});

/* ========================================================================== */
/* An exchange                                                                 */
/* ========================================================================== */

describe('a conversation as Markdown', () => {
  it('round-trips a two-turn exchange with a heading each', () => {
    expect(asMarkdown([you('Tighten the header'), graphe('Done — 24px instead of 40.')])).toBe(
      ['**You**', '', 'Tighten the header', '', '**Graphe**', '', 'Done — 24px instead of 40.'].join(
        '\n',
      ),
    );
  });

  it('writes the title over the top when there is one', () => {
    expect(asMarkdown([you('Hello')], { title: 'Landing page' })).toBe(
      ['# Landing page', '', '**You**', '', 'Hello'].join('\n'),
    );
  });
});

/* ========================================================================== */
/* The machinery, in and out                                                   */
/* ========================================================================== */

describe('the steps it took', () => {
  it('leaves them out by default — somebody pasting wants the answer', () => {
    const said = asMarkdown([you('Tighten it'), step('Read', 'src/App.css'), graphe('Done.')]);
    expect(said).not.toContain('Read');
    expect(said).toBe(['**You**', '', 'Tighten it', '', '**Graphe**', '', 'Done.'].join('\n'));
  });

  it('includes them when they are asked for', () => {
    const said = asMarkdown([you('Tighten it'), step('Read', 'src/App.css')], { steps: true });
    expect(said).toContain('- Read: src/App.css');
  });

  it('says nothing for a step with no detail beyond its label', () => {
    expect(asMarkdown([step('Looking around')], { steps: true })).toBe('- Looking around');
  });
});

/* ========================================================================== */
/* Plans and reviews                                                           */
/* ========================================================================== */

describe('a plan', () => {
  it('numbers its steps and says what was answered', () => {
    const said = asMarkdown([PLAN]);
    expect(said).toContain('1. Read the header');
    expect(said).toContain('2. Change the padding');
    expect(said).toContain('3. Look at it');
    expect(said).toContain('- The mobile layout shares this file');
    expect(said).toContain('**You** went ahead.');
  });
});

describe('a review', () => {
  it('renders the verdict in words and every finding under it', () => {
    const said = asMarkdown([REVIEW]);
    expect(said).toContain('Needs work: Two things to fix before this lands.');
    expect(said).toContain('- The timer is never cleared. (src/App.tsx:42)');
    expect(said).toContain('- No test covers the empty case.');
  });

  it('names the other two verdicts in words too', () => {
    const ships = asMarkdown([reviewed({ kind: 'ships', summary: 'Looks right.', findings: [] })]);
    expect(ships).toContain('Ready to ship: Looks right.');
    const stop = asMarkdown([
      reviewed({ kind: 'do-not-land', summary: 'It deletes the branch.', findings: [] }),
    ]);
    expect(stop).toContain('Do not land: It deletes the branch.');
  });
});

/* ========================================================================== */
/* Nothing to say                                                              */
/* ========================================================================== */

describe('when there is nothing worth pasting', () => {
  it('gives back the empty string for an empty conversation', () => {
    expect(asMarkdown([])).toBe('');
  });

  it('drops a turn that is only whitespace', () => {
    expect(asMarkdown([you('   \n  '), you('\t')])).toBe('');
    expect(asMarkdown([you('  '), graphe('Done.')])).toBe('**Graphe**\n\nDone.');
  });

  it('has a sentence for the empty case rather than an empty button', () => {
    expect(COPY_WORDS.nothing).toBe('Nothing has been said here yet.');
  });
});

/* ========================================================================== */
/* One turn's own words                                                        */
/* ========================================================================== */

describe('one turn on the clipboard', () => {
  it('is the text of what somebody said, trimmed', () => {
    expect(wordsOf(you('  Tighten the header  '))).toBe('Tighten the header');
  });

  it('is empty for machinery — a step, a tidy, a wait', () => {
    expect(wordsOf(step('Read', 'src/App.css'))).toBe('');
    expect(wordsOf({ kind: 'tidying', id: 'turn-6', state: 'running' })).toBe('');
    expect(wordsOf({ kind: 'holding', id: 'turn-7', state: 'running', seconds: 30 })).toBe('');
  });

  it('is the steps and the caveats for a plan, and the verdict for a review', () => {
    expect(wordsOf(PLAN)).toContain('1. Read the header');
    expect(wordsOf(REVIEW)).toContain('Needs work: Two things to fix before this lands.');
  });

  it('decides on its own whether a turn is worth a copy button', () => {
    expect(worthCopying(you('Tighten it'))).toBe(true);
    expect(worthCopying(you('   '))).toBe(false);
    expect(worthCopying(step('Read'))).toBe(false);
  });
});

/* ========================================================================== */
/* Nothing of ours gets out                                                    */
/* ========================================================================== */

describe('what does not survive into the paste', () => {
  it('carries no turn ids and no call numbers, steps or no steps', () => {
    const turns = [you('Tighten it'), step('Read', 'src/App.css'), PLAN, REVIEW, graphe('Done.')];
    for (const said of [asMarkdown(turns), asMarkdown(turns, { steps: true })]) {
      expect(said).not.toContain('turn-');
      expect(said).not.toContain('call-');
      expect(said).not.toContain('callId');
      expect(said).not.toContain('kind');
    }
  });
});
