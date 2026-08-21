/** Recording a flow rather than a page.
 *
 * The pictures cannot be tested here — they are Chromium. What can, and what
 * this covers, is everything that decides *what a frame means*: the sentence
 * attached to it, the order they come back in, and whether a state nobody could
 * photograph is reported as one nobody could photograph. A run with a silent
 * gap in it is worse than no run at all, because it looks complete.
 */

import { describe, expect, it } from 'vitest';

import {
  DIDS,
  frameOf,
  headlineFor,
  howLong,
  isDid,
  readsWell,
  saysItMissed,
  saysItStopped,
  saysWhatHappened,
  sinceStart,
  walkthrough,
  whatIsMissing,
  type Doing,
  type Frame,
  type Recording,
} from '../src/diff/flow';
import { APART, record, type Camera } from '../src/diff/recorder';
import { SAYS as PANE_SAYS, recordControl } from '../src/components/BrowserPane';
import { recordedIn } from '../src/lib/projects';
import {
  didFor,
  DRAIN_WATCHING,
  nameOf,
  readDrained,
  WATCHING_SCRIPT,
  worthHovering,
} from '../src/diff/watching';

function doing(did: Doing['did'], what: string | null, at = 0): Doing {
  return { did, what, at };
}

/** A camera that hands back a picture named after the call, so the order frames
 *  come back in can be read off the fixtures. */
function counting(): Camera & { taken: number } {
  const camera: Camera & { taken: number } = {
    taken: 0,
    snap: () => {
      camera.taken += 1;
      return Promise.resolve(`shot-${String(camera.taken)}`);
    },
  };
  return camera;
}

/** A camera that does not hand anything back until it is told to. */
function held(): {
  camera: Camera;
  asked: () => number;
  letGo: (which: number, shot: string | null) => void;
} {
  const waiting: ((shot: string | null) => void)[] = [];
  return {
    camera: {
      snap: () =>
        new Promise<string | null>((give) => {
          waiting.push(give);
        }),
    },
    asked: () => waiting.length,
    letGo: (which, shot) => {
      waiting[which]?.(shot);
    },
  };
}

/** Let everything already queued run. */
function tick(): Promise<void> {
  return new Promise((carry) => setTimeout(carry, 0));
}

function runOf(frames: readonly Frame[], note: string | null = null): Recording {
  return { id: 'r', says: '', startedAt: 0, frames, note };
}

/* ========================================================================== */
/* E-01 the sentence attached to a state                                       */
/* ========================================================================== */

describe('E-01 what produced this state, in plain words', () => {
  it('says what was done and what it was done to', () => {
    expect(saysWhatHappened(doing('pressed', 'Add to basket'))).toBe(
      'After pressing Add to basket',
    );
    expect(saysWhatHappened(doing('typed', 'Email'))).toBe('After typing in Email');
    expect(saysWhatHappened(doing('chose', 'Large'))).toBe('After choosing Large');
    expect(saysWhatHappened(doing('hovered', 'Add to basket'))).toBe(
      'With the cursor on Add to basket',
    );
    expect(saysWhatHappened(doing('focused', 'Email'))).toBe('With Email focused');
    expect(saysWhatHappened(doing('sent', 'Checkout'))).toBe('After sending Checkout');
  });

  it('says something true about a state that nobody caused', () => {
    // The toast, the spinner finishing, the panel that arrives on its own. It
    // has no action behind it, and pretending it does would be a lie about
    // somebody's own app.
    expect(saysWhatHappened(doing('changed', null))).toBe('After the page changed on its own');
    expect(saysWhatHappened(doing('waited', null))).toBe('A moment later');
  });

  it('still says something when the page had nothing to call it', () => {
    for (const did of DIDS) {
      const said = saysWhatHappened(doing(did, ''));
      expect(said.length).toBeGreaterThan(0);
      expect(said).not.toMatch(/\s\s|\sundefined|\snull/);
    }
  });

  it('shortens a name that is really a paragraph', () => {
    const long = 'Add this rather nicely priced item to your basket right now';
    const said = saysWhatHappened(doing('pressed', long));
    expect(said.startsWith('After pressing ')).toBe(true);
    expect(said.length).toBeLessThan(long.length + 15);
    expect(said.endsWith('…')).toBe(true);
  });

  it('tidies the whitespace a page happens to contain', () => {
    expect(saysWhatHappened(doing('pressed', '  Add to\n  basket '))).toBe(
      'After pressing Add to basket',
    );
  });

  it('reads the clock the way somebody would say it', () => {
    expect(sinceStart(0)).toBe('At the start');
    expect(sinceStart(120)).toBe('At the start');
    expect(sinceStart(1200)).toBe('1.2s in');
    expect(sinceStart(61_000)).toBe('1m 1s in');
    expect(sinceStart(120_000)).toBe('2m in');
    expect(sinceStart(Number.NaN)).toBe('At the start');
  });
});

/* ========================================================================== */
/* E-02 a state nobody could photograph                                        */
/* ========================================================================== */

describe('E-02 honesty about what could not be captured', () => {
  it('never lets a missing picture pass without a reason', () => {
    const frame = frameOf({ id: 'f1', doing: doing('pressed', 'Pay'), after: 10, shot: null });
    expect(frame.shot).toBeNull();
    expect(frame.missing).not.toBeNull();
    expect((frame.missing ?? '').length).toBeGreaterThan(0);
  });

  it('keeps the reason it was given', () => {
    const frame = frameOf({
      id: 'f1',
      doing: doing('pressed', 'Pay'),
      after: 10,
      shot: null,
      missing: 'The window went away first.',
    });
    expect(frame.missing).toBe('The window went away first.');
  });

  it('does not leave a reason hanging off a picture that came out', () => {
    const frame = frameOf({
      id: 'f1',
      doing: doing('pressed', 'Pay'),
      after: 10,
      shot: 'data:image/jpeg;base64,x',
      missing: 'nonsense',
    });
    expect(frame.missing).toBeNull();
  });

  it('counts the states that did not come out rather than dropping them', () => {
    const frames = [
      frameOf({ id: '1', doing: doing('opened', 'Basket'), after: 0, shot: 'a' }),
      frameOf({ id: '2', doing: doing('pressed', 'Pay'), after: 900, shot: null }),
      frameOf({ id: '3', doing: doing('changed', null), after: 1800, shot: 'c' }),
    ];

    expect(whatIsMissing(frames)).toHaveLength(1);
    const said = readsWell(runOf(frames));
    expect(said.ok).toBe(false);
    expect(said.says).toBe('Three states. One of them couldn’t be photographed.');
  });

  it('says so plainly when every state came out', () => {
    const frames = [
      frameOf({ id: '1', doing: doing('opened', 'Basket'), after: 0, shot: 'a' }),
      frameOf({ id: '2', doing: doing('pressed', 'Pay'), after: 900, shot: 'b' }),
    ];
    expect(readsWell(runOf(frames))).toEqual({ ok: true, says: 'Two states, all photographed.' });
  });

  it('carries a note about the run itself into the same sentence', () => {
    const frames = [frameOf({ id: '1', doing: doing('opened', 'Basket'), after: 0, shot: 'a' })];
    const said = readsWell(runOf(frames, saysItMissed(2)));
    expect(said.says).toBe(
      'One state, photographed. Two states went by too quickly to photograph.',
    );
  });

  it('has an honest answer for a run with nothing in it', () => {
    expect(readsWell(runOf([]))).toEqual({ ok: false, says: walkthrough.empty });
  });

  it('says when it stopped itself rather than pretending that was all of it', () => {
    expect(saysItStopped(12)).toBe('Stopped after twelve states — there were more.');
    expect(saysItStopped(40)).toBe('Stopped after 40 states — there were more.');
    expect(saysItMissed(1)).toBe('One state went by too quickly to photograph.');
  });
});

/* ========================================================================== */
/* E-03 the run, taken one picture at a time                                   */
/* ========================================================================== */

describe('E-03 recording a run', () => {
  it('takes one picture per state, in the order they happened', async () => {
    const camera = counting();
    const taking = record({ camera, clock: () => 1000 });

    taking.saw(doing('opened', 'Basket', 1000));
    taking.saw(doing('pressed', 'Pay', 1600));
    taking.saw(doing('changed', null, 2400));

    const run = await taking.finish();
    expect(run.frames.map((frame) => frame.shot)).toEqual(['shot-1', 'shot-2', 'shot-3']);
    expect(run.frames.map((frame) => frame.says)).toEqual([
      'When Basket opened',
      'After pressing Pay',
      'After the page changed on its own',
    ]);
    expect(run.frames.map((frame) => frame.after)).toEqual([0, 600, 1400]);
    expect(run.note).toBeNull();
  });

  it('takes one picture at a time, however fast the states arrive', async () => {
    // Two pictures in flight at once are two pictures of whichever state the
    // page reached first, and a run read out of order says the wrong thing
    // happened.
    const gate = held();
    const taking = record({ camera: gate.camera, clock: () => 0 });

    taking.saw(doing('pressed', 'One', 0));
    taking.saw(doing('pressed', 'Two', 100));

    const finished = taking.finish();
    await tick();
    expect(gate.asked()).toBe(1);

    gate.letGo(0, 'first');
    await tick();
    expect(gate.asked()).toBe(2);
    gate.letGo(1, 'second');

    const run = await finished;
    expect(run.frames.map((frame) => frame.says)).toEqual([
      'After pressing One',
      'After pressing Two',
    ]);
    expect(run.frames.map((frame) => frame.shot)).toEqual(['first', 'second']);
  });

  it('reports a state it could not photograph rather than skipping it', async () => {
    const camera: Camera = {
      snap: () => Promise.reject(new Error('the window went away')),
    };
    const taking = record({ camera, clock: () => 0 });

    taking.saw(doing('pressed', 'Pay', 0));
    const run = await taking.finish();

    expect(run.frames).toHaveLength(1);
    expect(run.frames[0]?.says).toBe('After pressing Pay');
    expect(run.frames[0]?.shot).toBeNull();
    expect(run.frames[0]?.missing).not.toBeNull();
  });

  it('treats the same thing twice in a moment as one state', async () => {
    const camera = counting();
    const taking = record({ camera, clock: () => 0 });

    taking.saw(doing('scrolled', '', 0));
    taking.saw(doing('scrolled', '', 100));
    taking.saw(doing('scrolled', '', 200));

    const run = await taking.finish();
    expect(run.frames).toHaveLength(1);
  });

  it('does not fold together two things that happen to look alike', async () => {
    const camera = counting();
    const taking = record({ camera, clock: () => 0 });

    // Far enough apart to be somebody scrolling twice, and a press is never
    // folded into anything: every one of them changed something.
    taking.saw(doing('scrolled', '', 0));
    taking.saw(doing('scrolled', '', APART + 200));
    taking.saw(doing('pressed', 'Pay', APART + 300));
    taking.saw(doing('pressed', 'Pay', APART + 350));

    const run = await taking.finish();
    expect(run.frames).toHaveLength(4);
  });

  it('stops itself rather than recording forever, and says that it did', async () => {
    const camera = counting();
    const taking = record({ camera, clock: () => 0, most: 3 });

    for (let index = 0; index < 10; index += 1) {
      taking.saw(doing('pressed', `Button ${String(index)}`, index * 1000));
    }

    const run = await taking.finish();
    expect(run.frames).toHaveLength(3);
    expect(run.note).toBe(saysItStopped(3));
    expect(taking.running).toBe(false);
  });

  it('ignores anything that happens after it has been stopped', async () => {
    const camera = counting();
    const taking = record({ camera, clock: () => 0 });

    taking.saw(doing('pressed', 'One', 0));
    const run = await taking.finish();
    taking.saw(doing('pressed', 'Two', 500));

    expect(run.frames).toHaveLength(1);
    expect(camera.taken).toBe(1);
  });

  it('never lets the clock run backwards, however the page reports it', async () => {
    const camera = counting();
    const taking = record({ camera, clock: () => 0 });

    taking.saw(doing('pressed', 'One', 900));
    taking.saw(doing('pressed', 'Two', 400));

    const run = await taking.finish();
    expect(run.frames.map((frame) => frame.after)).toEqual([900, 900]);
    expect(howLong(run)).toBe(900);
  });
});

/* ========================================================================== */
/* E-04 what the page reports                                                  */
/* ========================================================================== */

describe('E-04 naming what happened on the page', () => {
  it('calls a control what the page calls it', () => {
    expect(nameOf({ tagName: 'button', text: 'Add to basket' })).toBe('Add to basket');
    expect(nameOf({ tagName: 'button', ariaLabel: 'Close', text: '×' })).toBe('Close');
    expect(nameOf({ tagName: 'input', type: 'email', placeholder: 'you@example.com' })).toBe(
      'you@example.com',
    );
    expect(nameOf({ tagName: 'img', alt: 'The hero' })).toBe('The hero');
  });

  it('has nothing to say about something with no words at all', () => {
    expect(nameOf({ tagName: 'div' })).toBe('');
  });

  it('turns an event into the state it produced', () => {
    expect(didFor('click', { tagName: 'button', text: 'Pay' })).toBe('pressed');
    expect(didFor('click', { tagName: 'input', type: 'checkbox' })).toBe('chose');
    expect(didFor('input', { tagName: 'input', type: 'text' })).toBe('typed');
    expect(didFor('change', { tagName: 'select' })).toBe('chose');
    expect(didFor('submit', { tagName: 'form' })).toBe('sent');
    expect(didFor('focusin', { tagName: 'input', type: 'text' })).toBe('focused');
    expect(didFor('mutated', { tagName: 'body' })).toBe('changed');
  });

  it('does not invent a state for an event that produced none', () => {
    expect(didFor('mousemove', { tagName: 'div' })).toBeNull();
    expect(didFor('hover', { tagName: 'div' })).toBeNull();
    expect(didFor('hover', { tagName: 'button', text: 'Pay' })).toBe('hovered');
  });

  it('only counts a cursor resting on something that does anything', () => {
    expect(worthHovering({ tagName: 'button' })).toBe(true);
    expect(worthHovering({ tagName: 'a' })).toBe(true);
    expect(worthHovering({ tagName: 'div', role: 'button' })).toBe(true);
    expect(worthHovering({ tagName: 'p' })).toBe(false);
  });
});

/* ========================================================================== */
/* E-05 reading it back off the page                                           */
/* ========================================================================== */

describe('E-05 what comes back from the page', () => {
  it('reads a poll into states', () => {
    const drained = readDrained({
      doings: [
        { did: 'opened', what: 'Basket', at: 10 },
        { did: 'pressed', what: 'Pay', at: 900 },
      ],
      missed: 0,
      gone: false,
    });

    expect(drained.doings).toHaveLength(2);
    expect(drained.doings[1]).toEqual({ did: 'pressed', what: 'Pay', at: 900 });
    expect(drained.missed).toBe(0);
    expect(drained.gone).toBe(false);
  });

  it('drops anything it cannot name rather than guessing', () => {
    // A frame labelled with something we invented is worse than one that never
    // existed: it is evidence, and it would be wrong.
    const drained = readDrained({
      doings: [
        { did: 'summoned', what: 'Pay', at: 1 },
        null,
        'pressed',
        { what: 'Pay', at: 2 },
        { did: 'pressed', what: 'Pay', at: 3 },
      ],
      missed: 2,
    });

    expect(drained.doings).toHaveLength(1);
    expect(drained.doings[0]?.did).toBe('pressed');
    expect(drained.missed).toBe(2);
  });

  it('treats a page that cannot answer as one that has lost the script', () => {
    expect(readDrained(null).gone).toBe(true);
    expect(readDrained(undefined).gone).toBe(true);
    expect(readDrained('nothing').gone).toBe(true);
    expect(readDrained({ doings: [], missed: 0, gone: true }).gone).toBe(true);
  });

  it('knows which words are states and which are not', () => {
    expect(isDid('pressed')).toBe(true);
    expect(isDid('summoned')).toBe(false);
    expect(isDid(7)).toBe(false);
  });
});

/* ========================================================================== */
/* E-06 the script that runs on their page                                     */
/* ========================================================================== */

describe('E-06 the watching script', () => {
  it('is something a browser can read', () => {
    // Built rather than written, and it runs somewhere no test can reach, so
    // the least this can do is prove it parses. Compiled, never called: it
    // wants a window, and there is not one here.
    expect(() => new Function(WATCHING_SCRIPT)).not.toThrow();
  });

  it('is inert until something starts it', () => {
    expect(WATCHING_SCRIPT).toContain('var live = false;');
    expect(WATCHING_SCRIPT).toContain('window.__grapheWatching = {');
  });

  it('carries the same judgement the tests just ran', () => {
    // Built from the source of the function the tests above call directly, so
    // what the page decides and what is asserted here cannot drift apart.
    expect(WATCHING_SCRIPT).toContain('menuitem');
    expect(WATCHING_SCRIPT).toContain('checkbox');
    expect(WATCHING_SCRIPT).toContain('W.nameOf(');
    expect(WATCHING_SCRIPT).toContain('W.didFor(');
  });

  it('never records our own furniture', () => {
    expect(WATCHING_SCRIPT).toContain('data-graphe');
  });

  it('asks a page that has never seen it without breaking', () => {
    expect(DRAIN_WATCHING).toContain('window.__grapheWatching ?');
    expect(readDrained(JSON.parse('{"doings":[],"missed":0,"gone":true}')).gone).toBe(true);
  });
});

/* ========================================================================== */
/* E-07 what the strip says before anybody opens it                            */
/* ========================================================================== */

describe('E-07 the headline', () => {
  it('uses the person’s own words when they gave any', () => {
    const run = { ...runOf([]), says: 'Went through the basket' };
    expect(headlineFor(run)).toBe('Went through the basket');
  });

  it('falls back to what it has, rather than to nothing', () => {
    const frames = [
      frameOf({ id: '1', doing: doing('opened', 'Basket'), after: 0, shot: 'a' }),
      frameOf({ id: '2', doing: doing('pressed', 'Pay'), after: 900, shot: 'b' }),
    ];
    expect(headlineFor(runOf(frames))).toBe('Two states, recorded');
    expect(headlineFor(runOf([]))).toBe(walkthrough.heading);
  });

  it('never uses a word the interface has retired', () => {
    const said = [
      walkthrough.button,
      walkthrough.working,
      walkthrough.stop,
      walkthrough.heading,
      walkthrough.empty,
      walkthrough.again,
      walkthrough.missing,
      walkthrough.stepping,
      walkthrough.all,
      ...DIDS.map((did) => saysWhatHappened(doing(did, 'Pay'))),
    ].join(' ');

    expect(said).not.toMatch(/\b(commit|branch|staged|DOM|screenshot|capture|API|session)\b/i);
  });
});

/* ========================================================================== */
/* E-08 the control that starts and stops a run                                */
/* ========================================================================== */

/** The failure guarded here is a control that reads the same whether or not it
 *  is running. Everything a recording costs is spent while it is on, and
 *  somebody who cannot tell leaves it on. */
describe('E-08 the record control', () => {
  it('offers to record the page when there is a page to record', () => {
    const off = recordControl({ recording: false, address: 'http://localhost:3000' });
    expect(off.label).toBe(walkthrough.button);
    expect(off.on).toBe(false);
    expect(off.ready).toBe(true);
  });

  it('says something different once it is running, not the same thing lit up', () => {
    const off = recordControl({ recording: false, address: 'http://localhost:3000' });
    const on = recordControl({ recording: true, address: 'http://localhost:3000' });
    expect(on.label).toBe(walkthrough.stop);
    expect(on.label).not.toBe(off.label);
    expect(on.on).toBe(true);
    expect(on.title).toBe(walkthrough.working);
  });

  it('cannot be pressed with nothing being served, and says why rather than failing', () => {
    const none = recordControl({ recording: false, address: null });
    expect(none.ready).toBe(false);
    expect(none.title).toBe(PANE_SAYS.nothing);
  });

  /* A run you can start and cannot stop is the worst of the states this can be
     in: the page keeps being photographed and the only way out is closing the
     pane. Stopping is always available. */
  it('can always be stopped, even once there is no address left', () => {
    expect(recordControl({ recording: true, address: null }).ready).toBe(true);
    expect(recordControl({ recording: true, address: null }).label).toBe(walkthrough.stop);
  });

  it('never uses a word the interface has retired', () => {
    const said = [
      recordControl({ recording: false, address: 'http://localhost:3000' }),
      recordControl({ recording: true, address: 'http://localhost:3000' }),
      recordControl({ recording: false, address: null }),
    ]
      .flatMap((one) => [one.label, one.title])
      .join(' ');

    expect(said).not.toMatch(/\b(commit|branch|staged|DOM|capture|API|session)\b/i);
  });
});

/* ========================================================================== */
/* E-09 what a stopped run is worth keeping                                    */
/* ========================================================================== */

/** Two failures. A run that saw nothing becoming a row in the conversation that
 *  says nothing, and a run made against one project being left over the next
 *  one's conversation when somebody switches folders. */
describe('E-09 keeping a run that has stopped', () => {
  const seen = runOf([
    frameOf({ id: '1', doing: doing('opened', 'Basket'), after: 0, shot: 'a' }),
    frameOf({ id: '2', doing: doing('pressed', 'Pay'), after: 900, shot: 'b' }),
  ]);

  it('keeps a run that saw something, against the project it was made in', () => {
    const kept = recordedIn('/p/paper-street', seen);
    expect(kept?.project).toBe('/p/paper-street');
    expect(kept?.recording.frames).toHaveLength(2);
  });

  it('keeps nothing from a run that saw nothing', () => {
    expect(recordedIn('/p/paper-street', runOf([]))).toBeNull();
  });

  it('keeps nothing when there is no project to hang it on', () => {
    expect(recordedIn(null, seen)).toBeNull();
  });

  it('keeps nothing when the run itself did not come back', () => {
    expect(recordedIn('/p/paper-street', null)).toBeNull();
  });
});
