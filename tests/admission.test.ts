/** The one door a turn this app starts has to come through.
 *
 * The decision is pure, so what is proved here is the order of it: the person
 * before every rule of automation, an add-on's own turn watched rather than
 * refused, and a reason from a run that has ended turned down quietly — and,
 * where a fact is not visible from the seam asking, admitted rather than
 * guessed against. The last block asks a real session rather than the pure
 * function, because a decision nobody asks is not a door.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSession } from '../src/agent/pi/adapter';
import { admit, admissionWords, type TurnState } from '../src/work/admission';
import { MOST_ROUNDS, continuationWords } from '../src/work/continuation';

const ordinary: TurnState = {
  run: { epoch: 3, stopped: false },
  going: true,
  waitingOnPerson: false,
  budget: { rounds: 1, most: MOST_ROUNDS },
};

describe('the person, before every rule of automation', () => {
  it('admits what somebody typed while a question is open and after a stop', () => {
    expect(
      admit({ origin: 'user', epoch: 3 }, { ...ordinary, run: { epoch: 3, stopped: true }, waitingOnPerson: true }),
    ).toEqual({ verdict: 'admitted' });
  });

  it('admits a steered line while a run is in flight', () => {
    expect(admit({ origin: 'steer' }, ordinary)).toEqual({ verdict: 'admitted' });
  });

  it('turns down a steered line with nothing running, and says where it went wrong', () => {
    expect(admit({ origin: 'steer' }, { ...ordinary, going: false })).toEqual({
      verdict: 'refused',
      because: 'not-going',
      said: admissionWords.notGoing,
    });
  });
});

describe('what the app decided for itself', () => {
  it('admits the ordinary follow-up', () => {
    expect(admit({ origin: 'follow-up', epoch: 3 }, ordinary)).toEqual({ verdict: 'admitted' });
  });

  it('turns down a reason from a run that has ended, without a word', () => {
    expect(admit({ origin: 'follow-up', epoch: 2 }, ordinary)).toEqual({
      verdict: 'refused',
      because: 'stale-epoch',
      said: '',
    });
  });

  it('turns down a child result whose run was stopped', () => {
    expect(
      admit({ origin: 'child-result', epoch: 3 }, { ...ordinary, run: { epoch: 3, stopped: true } }),
    ).toEqual({ verdict: 'refused', because: 'stopped', said: '' });
  });

  it('never nudges somebody who is being asked a question', () => {
    expect(admit({ origin: 'explicit-goal', epoch: 3 }, { ...ordinary, waitingOnPerson: true })).toEqual(
      { verdict: 'refused', because: 'waiting-on-person', said: '' },
    );
  });

  it('stops a goal round at the ceiling, in the words every other stop uses', () => {
    expect(
      admit(
        { origin: 'explicit-goal', epoch: 3 },
        { ...ordinary, budget: { rounds: MOST_ROUNDS, most: MOST_ROUNDS } },
      ),
    ).toEqual({
      verdict: 'refused',
      because: 'budget-spent',
      said: continuationWords.spent(MOST_ROUNDS),
    });
  });
});

describe('what only the shell can see', () => {
  it('turns down every turn with nothing set up to answer', () => {
    expect(admit({ origin: 'follow-up', epoch: 3 }, { ...ordinary, model: 'unavailable' })).toEqual({
      verdict: 'refused',
      because: 'no-model',
      said: admissionWords.noModel,
    });
  });

  it('turns down a turn while another conversation is writing in the folder', () => {
    expect(admit({ origin: 'follow-up', epoch: 3 }, { ...ordinary, lease: 'somebody-else' })).toEqual({
      verdict: 'refused',
      because: 'folder-busy',
      said: admissionWords.folderBusy,
    });
  });

  /* A fact nobody can see may not stop somebody's work: the owner of the round
     budget knows nothing of the folder lease, and the session knows nothing of
     either. */
  it('admits where a seam has nothing to say', () => {
    expect(admit({ origin: 'follow-up' }, {})).toEqual({ verdict: 'admitted' });
    expect(admit({ origin: 'steer' }, {})).toEqual({ verdict: 'admitted' });
  });
});

describe('a turn an add-on starts', () => {
  /* Pi begins it inside the add-on, so this is not permission being asked for:
     it is watched, and what can be done is to end it. */
  it('is watched while there is budget left', () => {
    expect(admit({ origin: 'extension', epoch: 3 }, ordinary)).toEqual({ verdict: 'watched' });
  });

  it('is turned down at the ceiling, in the words every other stop uses', () => {
    expect(
      admit(
        { origin: 'extension', epoch: 3 },
        { ...ordinary, budget: { rounds: MOST_ROUNDS, most: MOST_ROUNDS } },
      ),
    ).toEqual({
      verdict: 'refused',
      because: 'budget-spent',
      said: continuationWords.spent(MOST_ROUNDS),
    });
  });

  it('is turned down quietly once the run it belongs to has been stopped', () => {
    expect(
      admit({ origin: 'extension', epoch: 3 }, { ...ordinary, run: { epoch: 3, stopped: true } }),
    ).toEqual({ verdict: 'refused', because: 'stopped', said: '' });
  });
});

describe('the door at the seam a turn begins at', () => {
  /* Every test above hands the decision the facts itself. This one asks the
     real session instead: a door nobody asks is not a door, and the facts a
     seam does not have are the whole reason it is allowed to leave them off. */
  it('turns a steered line down before it reaches a queue that would drop it', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'graphe-project-'));
    const agentDir = mkdtempSync(join(tmpdir(), 'graphe-agent-'));
    try {
      const session = await createSession({ projectRoot, agentDir, onEvent: () => {} });
      // Nothing is in flight, which is the one fact this seam can see.
      expect(session.listening).toBe(false);
      await expect(session.steer('go left instead')).rejects.toThrow(admissionWords.notGoing);
      // Pi drains its queue only from inside a run, so a line pushed here would
      // have sat there rather than being refused: nothing was pushed.
      expect(await session.takeBackQueue()).toEqual({ ok: true, steering: [], followUp: [] });
      session.dispose();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
    }
  }, 30_000);
});
