/** What a system notification is allowed to carry.
 *
 * 9.5 asks that a notification names the right owner, never carries the whole of
 * what was asked, and that pressing one returns to the right chat. Two of those
 * three are decided in a pure module and are held here: `saysNotice`
 * (src/work/unattended.ts:233) builds the only title and body the shell ever
 * hands to `new Notification` (electron/main.ts:6875). The owner is the
 * project's own name and stays in the title; every body is trimmed, flattened
 * onto one line and capped.
 *
 * This is a bound, not a redaction: the first line of what was asked still
 * reaches the screen, which the row accepts by asking only that the whole of it
 * does not. And a run somebody is watching never becomes a banner at all —
 * `howToTell` answers `nothing` for a finished run with the window in front
 * (src/work/notify.ts:53), which is held in `tests/notify.test.ts` along with
 * the sound and the dock badge.
 *
 * Not here: `tellThem` (:6873) and its click handler (:6876), which call
 * `showTheWindow()` and `pushAway(desk.path)` — the window comes back and that
 * project's board is re-pushed, but the project in front is not switched, so a
 * person looking at another project lands on the one they were already reading
 * rather than on the chat the notification was about. Recorded rather than
 * fixed: the shell is outside this ticket. Also not here: the once-only
 * in-window fallback for a Mac that will not show notifications (:6918), which
 * needs `Notification.isSupported()` to answer false in a real process.
 */

import { describe, expect, it } from 'vitest';

import { saysNotice } from '../../src/work/unattended';

const STATES = ['waiting', 'running', 'needs-you', 'done', 'failed'] as const;

/** A long prompt, as somebody might actually type one: several lines, and a
 *  secret at the end of it. */
const ASKED = `${'Rewrite the sign-in page so it works on a phone. '.repeat(20)}\n\nAlso, my key is SK-THE-END-OF-THE-PROMPT.`;

/* ========================================================================== */

describe('the owner on a notification', () => {
  it('is the project, on every state there is', () => {
    for (const state of STATES) {
      const notice = saysNotice('paper-street', { doing: 'Check the site still builds', state });
      expect(notice.title, state).toBe('paper-street');
    }
  });

  it('is in the title, because the body can be nothing but what the run said', () => {
    const notice = saysNotice(
      'paper-street',
      { doing: 'Tidy the cards', state: 'done' },
      'Spacing on three cards, from 16 to 24.',
    );
    expect(notice.body).toBe('Spacing on three cards, from 16 to 24.');
    expect(notice.title).toBe('paper-street');
  });

  it('is cut to something a banner can show, rather than the whole folder path', () => {
    const notice = saysNotice(`${'a-very-long-project-name/'.repeat(6)}site`, {
      doing: 'Do a thing',
      state: 'done',
    });
    expect(notice.title.length).toBeLessThanOrEqual(40);
  });
});

describe('what was asked, on the way to the screen', () => {
  it('carries the beginning of what was asked, and never the end of it', () => {
    const notice = saysNotice('paper-street', { doing: 'Do a thing', state: 'done' }, ASKED);
    // A cut, not a redaction: the first words are what the body is, and the
    // rest of a long prompt — a key at the end of it, say — is not there.
    const flattened = ASKED.replace(/\s+/g, ' ').trim();
    expect(flattened.startsWith(notice.body.slice(0, -1))).toBe(true);
    expect(notice.body).not.toContain('SK-THE-END-OF-THE-PROMPT');
  });

  it('is one line, however many it was typed on', () => {
    const notice = saysNotice('paper-street', { doing: ASKED, state: 'done' }, ASKED);
    expect(notice.body).not.toMatch(/[\n\r\t]/);
    expect(notice.body).not.toContain('  ');
    expect(notice.title).not.toMatch(/[\n\r\t]/);
  });

  it('fits a banner, in every state there is', () => {
    // What the run said is cut at 90; the asking line at 80, plus the sentence
    // that says what happened to it.
    expect(saysNotice('paper-street', { doing: ASKED, state: 'done' }, ASKED).body.length).toBeLessThanOrEqual(90);
    for (const state of STATES) {
      const notice = saysNotice('paper-street', { doing: ASKED, state }, ASKED);
      expect(notice.body.length, state).toBeLessThanOrEqual(130);
    }
  });

  it('says what happened instead of showing a blank line when there are no words for it', () => {
    const notice = saysNotice('paper-street', { doing: 'Check the site still builds', state: 'done' }, '  \n ');
    expect(notice.body).toContain('Check the site still builds');
    expect(notice.body).not.toContain('…');
  });
});
