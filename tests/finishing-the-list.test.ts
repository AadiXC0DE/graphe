/** The window wiring behind "it does one step and stops".
 *
 * Everything these check is in App.tsx, where a unit test cannot reach — so
 * they read the wiring out of the source the way the other wired tests here do.
 * They are the tripwire for somebody removing a guard while renaming things.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const APP = read('../src/App.tsx');
const GOAL = read('../src/work/goal.ts');

describe('FL-01 a list with steps left asks for the next one', () => {
  it('asks once the tracker has been advanced, not before', () => {
    const at = APP.indexOf("buildAdvance({ kind: 'finish'");
    expect(at).toBeGreaterThan(-1);
    const block = APP.slice(at, at + 1200);
    expect(block).toContain('carryOnWith(where, notice.conversation ?? null, runKey, answer.value)');
  });

  /* Goal Mode runs its own round of this. Both asking would send the
     conversation two messages for one settle. */
  it('stands down where Goal Mode is already doing it', () => {
    const at = APP.indexOf('carryOnWith(where,');
    const block = APP.slice(Math.max(0, at - 700), at);
    expect(block).toContain('goalNow.current.status === \'active\'');
    expect(block).toContain('where === goalProject.current');
    expect(APP).toContain('if (!goalHasIt) carryOnWith(');
  });

  it('goes out the same way every nudge does', () => {
    const at = APP.indexOf('carryOnPrompt(next ?? ');
    expect(at).toBeGreaterThan(-1);
    expect(APP.slice(at - 60, at + 120)).toContain('nudgeOn(project, conversation,');
  });

  /* Everything the app queues for itself goes through one place, so the two
     things the screen depends on cannot be forgotten at one call site and not
     another: the job that makes the tab spin, and staying out of the line. */
  it('behind the run, in the conversation that settled, spinning, and not in the line', () => {
    const at = APP.indexOf('const nudgeOn = useCallback(');
    expect(at).toBeGreaterThan(-1);
    const block = APP.slice(at, at + 1800);
    expect(block).toContain("queue: 'followUp'");
    expect(block).toContain('conversation === null ? {} : { conversation }');
    expect(block).toContain('doing: one.doing ?? started');
    expect(block).toContain('oursInLine.current');
  });
});

describe('FL-02 every way it stops', () => {
  it('stops when the person presses Escape, rather than treating it as a pause', () => {
    expect(APP).toContain('stoppedByHand.current = { ...stoppedByHand.current, [owner]: true }');
    const at = APP.indexOf('const carryOnWith = useCallback(');
    const block = APP.slice(at, at + 700);
    expect(block).toContain('stoppedByHand.current[runKey] === true');
  });

  it('starts its rounds again from zero when the person says something', () => {
    const at = APP.indexOf('const deliver = useCallback(');
    const block = APP.slice(at, at + 2600);
    expect(block).toContain('delete without[owner]');
    expect(block).toContain('carryOn.current = without');
  });

  it('says out loud whichever way it stopped', () => {
    const at = APP.indexOf('const carryOnWith = useCallback(');
    const block = APP.slice(at, at + 1800);
    expect(block).toContain("if (move.kind === 'stop')");
    expect(block).toContain('say(move.said)');
  });
});

describe('FL-03 a goal inherits the list it was set on', () => {
  /* The baseline skipped past every task that already existed, so setting a
     goal on a plan already being worked left it with nothing to check — it ran
     one round, said there was no checklist, and stood down. */
  it('reads the baseline from the plan rather than taking its highest number', () => {
    expect(APP).not.toMatch(/tasks\.reduce\(\(m, t\) => Math\.max\(m, t\.n\), 0\)/);
    expect(APP.match(/baselineFor\(buildPlanNow\.current\?\.plan\.tasks\)/g)).toHaveLength(3);
  });

  it('skips past a finished list and inherits an unfinished one', () => {
    const at = GOAL.indexOf('export function baselineFor');
    const block = GOAL.slice(at, at + 500);
    expect(block).toContain("one.status !== 'done'");
    expect(block).toContain('if (anyLeft) return 0');
  });
});

describe('FL-04 what the model is told while a list is live', () => {
  const PLAN = read('../src/work/buildplan.ts');

  it('says an advisor verdict does not end an unfinished list', () => {
    const at = PLAN.indexOf('export function planStanding');
    const block = PLAN.slice(at, at + 900);
    expect(block).toContain('advisor');
    expect(block).toContain('never permission to leave the list unfinished');
  });

  it('asks for the whole list rather than one step per reply', () => {
    const at = PLAN.indexOf('export function planStanding');
    expect(PLAN.slice(at, at + 900)).toContain('Work through the whole list in this reply');
  });
});

describe('FL-05 the board tells the conversation it has finished', () => {
  it('reads what the board looked like a moment ago, outside the state updater', () => {
    const at = APP.indexOf('const stopAway = bridge.onAway(');
    const block = APP.slice(at, at + 1400);
    expect(block).toContain('wentQuiet(awayNow.current[notice.project]?.pieces, notice.away.pieces)');
    // A message sent from inside a state updater would be sent twice.
    expect(block.indexOf('wentQuiet(')).toBeLessThan(block.indexOf('setAway((current)'));
  });

  it('only into a conversation with nothing already going', () => {
    const at = APP.indexOf('const stopAway = bridge.onAway(');
    expect(APP.slice(at, at + 1400)).toContain('desk.doing == null');
  });
});

describe('FL-06 the file tree keeps up with the work', () => {
  it('is read as steps finish rather than only when the reply settles', () => {
    expect(APP).toContain("if (notice.event.type === 'tool-end' && notice.project !== null)");
    expect(APP).toContain('refreshFilesSoon(notice.project)');
  });

  it('is throttled, so a step writing forty files does not walk the folder forty times', () => {
    const at = APP.indexOf('const refreshFilesSoon = useCallback(');
    const block = APP.slice(at, at + 600);
    expect(block).toContain('FILES_APART');
    expect(block).toContain('filesReadAt.current');
  });
});

describe('FL-07 changing a plan asks again rather than starting', () => {
  it('sends the changes back as another look rather than putting the words in the box', () => {
    const at = APP.indexOf('PLAN_WORDS.planAgain');
    expect(at).toBeGreaterThan(-1);
    const block = APP.slice(at - 600, at + 300);
    expect(block).toContain('decidedMessage(chosen.decision)');
    expect(block).toContain('lookFirst: true');
  });

  it('still falls back to the box when nothing was actually changed', () => {
    const at = APP.indexOf('PLAN_WORDS.planAgain');
    const block = APP.slice(at - 700, at + 300);
    expect(block).toContain('setDraft(text)');
  });
});

describe('FL-08 a line taken back leaves the conversation', () => {
  it('comes out of the thread as well as going into the box', () => {
    const at = APP.indexOf('bridge.takeBackQueue(');
    const block = APP.slice(at, at + 1200);
    expect(block).toContain('intoTheBox(was, words)');
    expect(block).toContain('withoutTakenBack(one.turns, words)');
  });
});

describe('FL-09 a run the app kept going still looks like it is running', () => {
  /* The loop worked and the tab stopped spinning, because everything that made
     the screen say "working" lived in `deliver` and these do not go through it. */
  it('goal mode goes round through the same nudge', () => {
    expect(APP).toContain('Continue toward the goal: ${activeGoal.objective}');
    const at = APP.indexOf('Continue toward the goal: ${activeGoal.objective}');
    expect(APP.slice(at - 200, at)).toContain('nudgeOn(');
  });

  it('so does the board when it goes quiet', () => {
    expect(APP).toContain('nudgeOn(notice.project, desk.address ?? null, quietWords(over))');
  });

  it('and none of the three are drawn as somebody waiting in line', () => {
    const at = APP.indexOf("if (notice.event.type === 'queued')");
    expect(APP.slice(at, at + 700)).toContain('withoutOurs(words, oursInLine.current[owner] ?? [])');
  });
});

describe('FL-10 a goal makes its own checklist', () => {
  it('asks for one instead of telling the person to go and write it', () => {
    const at = APP.indexOf('if (ownedCount === 0)');
    const block = APP.slice(at, at + 900);
    expect(block).toContain('goalWords.askForTheSteps');
    expect(block).not.toContain('Not auto-continuing');
  });

  it('asks once, then stops rather than going round on nothing to check', () => {
    const at = APP.indexOf('if (ownedCount === 0)');
    const block = APP.slice(at, at + 900);
    expect(block).toContain('askedForAList.current.has(goalOwner)');
    expect(block).toContain('goalWords.noStepsEither');
  });

  it('and there is a tool that can actually write one', () => {
    const TOOLS = read('../src/agent/pi/tools.ts');
    expect(TOOLS).toContain("name: 'make_checklist'");
    expect(TOOLS).toContain('makeChecklistTool(makeChecklist)');
  });
});
