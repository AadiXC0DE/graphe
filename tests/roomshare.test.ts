/** What is filling the conversation, and the line between reckoned and guessed.
 *
 * The model hands us one number and no breakdown, and even that number is only
 * counted as far as its last reply — everything since is sized by chars/4, and
 * before the first reply the whole figure is. Everything below the total is our
 * own reading of the text on screen, so the failure this guards against is not
 * an arithmetic slip — it is an interface that shows an estimate in the shape of
 * a measurement. A share printed as a size, or a note that drops the
 * word "estimate", turns a rough proportion into a figure somebody will quote
 * back at us, and there is nothing in the product that would catch it.
 *
 * The arithmetic is here too, because a split that misfiles tool results as
 * something the person said is a confident lie about their own conversation.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ROOM_WORDS, sharesOf, saysRoom, type Share } from '../src/lib/roomshare';
import type { Turn } from '../src/lib/thread';

let next = 0;
const id = () => `t-${(next += 1)}`;

const you = (text: string): Turn => ({ kind: 'said', id: id(), from: 'you', text, streaming: false });
const graphe = (text: string): Turn => ({
  kind: 'said',
  id: id(),
  from: 'graphe',
  text,
  streaming: false,
});
const did = (label: string, detail?: string): Turn => ({
  kind: 'did',
  id: id(),
  callId: id(),
  state: 'done',
  label,
  detail,
});
const trouble = (what: string): Turn => ({
  kind: 'trouble',
  id: id(),
  trouble: { what, because: what, actionLabel: 'Got it' },
});

const kinds = (shares: readonly Share[]) => shares.map((share) => share.kind);
const of = (shares: readonly Share[], kind: Share['kind']) =>
  shares.find((share) => share.kind === kind);

describe('bucketing a conversation by where its text came from', () => {
  it('files every kind of turn under the right heading', () => {
    const shares = sharesOf([
      you('a'.repeat(400)),
      graphe('b'.repeat(400)),
      did('Reading', 'c'.repeat(393)),
      trouble('d'.repeat(200)),
    ]);
    expect(kinds(shares).sort()).toEqual(['graphe', 'trouble', 'work', 'you']);
    // Every bucket was handed the same amount of text, down to the character.
    for (const share of shares) expect(share.part, share.kind).toBeCloseTo(0.25, 4);
  });

  /* A question about a tool call is the tool call's text, not the person's:
     nobody typed it, and filing it under "what you said" would make a careful
     Guard look like a talkative user. */
  it('counts a confirmation question as work rather than as something you said', () => {
    const shares = sharesOf([
      { kind: 'asked', id: id(), callId: id(), question: 'q'.repeat(100), answered: null },
    ]);
    expect(kinds(shares)).toEqual(['work']);
  });

  /* A plan is two voices in one turn: the message somebody typed, held back
     until they answer, and the steps proposed in reply to it. */
  it('splits a plan between the message held back and the steps proposed', () => {
    const shares = sharesOf([
      { kind: 'plan', id: id(), text: 'x'.repeat(200), steps: ['y'.repeat(200)], caveats: [], questions: [], answered: null },
    ]);
    expect(of(shares, 'you')?.part).toBeCloseTo(0.5, 2);
    expect(of(shares, 'graphe')?.part).toBeCloseTo(0.5, 2);
  });

  it('leaves out a heading with nothing under it', () => {
    expect(kinds(sharesOf([you('hello there')]))).toEqual(['you']);
  });

  it('puts the biggest first and keeps the order steady', () => {
    const turns = [you('a'.repeat(100)), graphe('b'.repeat(900)), did('Ran a check', 'c'.repeat(400))];
    expect(kinds(sharesOf(turns))).toEqual(['graphe', 'work', 'you']);
    expect(kinds(sharesOf(turns))).toEqual(kinds(sharesOf([...turns].reverse())));
  });

  it('adds up to the whole conversation', () => {
    const shares = sharesOf([
      you('a'.repeat(137)),
      graphe('b'.repeat(911)),
      did('Ran a check', 'c'.repeat(29)),
      trouble('d'.repeat(53)),
    ]);
    expect(shares.reduce((sum, share) => sum + share.part, 0)).toBeCloseTo(1, 6);
  });

  it('says nothing about an empty conversation', () => {
    expect(sharesOf([])).toEqual([]);
    expect(sharesOf([{ kind: 'tidying', id: id(), state: 'done' }])).toEqual([]);
  });

  /* The shape a long agent turn actually takes: pages of tool results and not
     one sentence from anybody. It must come back as one full band, not as an
     empty bar. */
  it('reads a stretch of nothing but tool calls as one whole band', () => {
    const shares = sharesOf([did('Reading', 'r'.repeat(4000)), did('Searching', 's'.repeat(9000))]);
    expect(kinds(shares)).toEqual(['work']);
    expect(shares[0]?.part).toBe(1);
    expect(shares[0]?.roughly).toBeGreaterThan(0);
  });
});

describe('the total, and how far its grounding actually reaches', () => {
  it('states it plainly, and says where the counting stops', () => {
    const said = saysRoom(42_000, 200_000);
    expect(said).toContain('42k');
    expect(said).toContain('200k');
    expect(said).toContain('21%');
    expect(said).toContain(ROOM_WORDS.counted);
  });

  /* Right after a tidy the model has nothing to report. Zeros there would read
     as an empty conversation, which is the one thing it certainly is not. */
  it('says it does not know rather than showing nothing used', () => {
    const said = saysRoom(null, 200_000);
    expect(said).toBe(ROOM_WORDS.notKnown);
    expect(said).not.toMatch(/\d/);
    expect(said).not.toMatch(/\b0\b|zero/i);
  });

  it('does not claim more than full', () => {
    expect(saysRoom(300_000, 200_000)).toContain('100%');
  });
});

describe('nothing here presents an estimate as a measurement', () => {
  const words = Object.values(ROOM_WORDS);
  const source = readFileSync(new URL('../src/components/RoomShare.tsx', import.meta.url), 'utf8');

  /** Every sentence the panel can say, whichever branch it takes. */
  const everything = [...words, saysRoom(9_000, 200_000), saysRoom(null, 200_000)];

  /* A band label carrying a figure is the exact mistake: "What you said ·
     12k" reads as counted, and nothing in it was. Only the total sentence is
     allowed a number. */
  it('keeps every figure out of the words around the bar', () => {
    for (const word of words) expect(word, word).not.toMatch(/\d/);
  });

  it('says in plain words that the split is a reading and not a count', () => {
    expect(ROOM_WORDS.estimated).toMatch(/\b(estimate|reading|rough)/i);
    expect(ROOM_WORDS.estimated).toMatch(/not a count/i);
  });

  it('names the total as the model\u2019s own, so the two are never read alike', () => {
    expect(ROOM_WORDS.counted).toMatch(/counted/i);
    expect(saysRoom(9_000, 200_000)).toContain(ROOM_WORDS.counted);
  });

  /** The claim this replaced. Pi builds the figure as the usage reported on the
   *  last assistant reply plus chars/4 for everything after it, and returns
   *  chars/4 for all of it before the first reply. "Counted by the model
   *  itself", flat, is a claim the number cannot carry — and it sat directly
   *  above a note telling the reader that figure was the counted one. */
  it('never claims the whole figure was counted', () => {
    expect(ROOM_WORDS.counted).not.toMatch(/^counted by the model itself$/i);
    // Whatever the wording, it has to admit a boundary.
    expect(ROOM_WORDS.counted).toMatch(/\b(since|last reply|reckon)/i);
  });

  it('does not tell the reader the total is exact', () => {
    expect(ROOM_WORDS.estimated).not.toMatch(/only the figure above is counted/i);
  });

  /* The house language rule. A panel about how full a conversation is, is
     exactly where the machinery's vocabulary tries to get back in. */
  it('says none of it in the words of the machinery', () => {
    for (const said of everything) {
      expect(said, said).not.toMatch(/token|context\s*window|compact|prompt|payload/i);
    }
  });

  /* Every sentence the component shows has to come from the file that this
     test sweeps. A line typed straight into the JSX would be invisible here. */
  it('leaves no sentence written into the component itself', () => {
    // Comments are prose and say what they like; only the code is swept.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const [literal] of code.matchAll(/'[^'\n]*'|"[^"\n]*"/g)) {
      expect(literal.slice(1, -1), literal).not.toMatch(/\S\s\S/);
    }
  });

  /* The state with no total to report has to be the one written down here,
     not a bar full of zeros drawn because nobody handled the null. */
  it('reaches for the not-known words when there is no total', () => {
    expect(source).toContain('ROOM_WORDS.notKnown');
  });
});

describe('the empty state does not contradict the total', () => {
  /** The model reports room in use before either of you has said a word — its
   *  instructions and its tool list are already in there. "Nothing in here"
   *  printed under a real number reads as one of the two being wrong. */
  it('names what is filling it instead of claiming nothing is', () => {
    expect(ROOM_WORDS.empty).not.toMatch(/^nothing in here/i);
    expect(ROOM_WORDS.empty).toMatch(/instructions/i);
  });

  it('still says nothing has been said', () => {
    expect(ROOM_WORDS.empty).toMatch(/nothing said/i);
  });
});
