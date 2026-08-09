/** How big does this look before we start?
 *
 * `estimate.ts` can price a job and decide whether it is worth interrupting for
 * (COST-DESIGN §2). It cannot know what the job *is* — it takes a `Task` and
 * this is where one comes from: the sentence somebody typed, read for the two
 * things the estimate needs, a **kind** and a **size**.
 *
 * ## This is a guess, and it is built to be replaced
 *
 * There is no planner in Graphe yet. Until there is, the only thing available
 * before the work starts is the request itself, so this is keywords and length,
 * and it will occasionally be wrong. Two decisions keep that from mattering
 * much:
 *
 *  1. **It only ever decides whether to ask.** A misread request costs somebody
 *     one confirmation they did not need, or spares them one they might have
 *     wanted. It never changes what is built, and it never blocks anything.
 *  2. **`kind` is what the measurement is filed under.** Even a crude kind makes
 *     the estimate better over time, because "contact forms in this project have
 *     cost about this much" is a far better prior than "features cost about this
 *     much". The keyword list is the index of that filing cabinet, not a claim
 *     to understand English.
 *
 * When there is a real planner, the honest move is to ask *it* for the size and
 * delete most of this file. The `Task` shape does not change, so nothing above
 * it has to.
 *
 * ## Biased small, deliberately
 *
 * Anything unrecognised is a tweak. A tweak never crosses the threshold, so an
 * unrecognised request just happens — which is the right direction to be wrong
 * in: COST-DESIGN §2 is explicit that a confirmation on every small change
 * becomes noise, and noise is how "Accept All" was invented. The failure we are
 * avoiding is a chatty app, not an occasional unquoted job.
 */

import type { Task, TaskSize } from './estimate';

/**
 * Recognisable jobs, in the order they are checked.
 *
 * Order matters: "add a contact form to the landing page" is a contact form,
 * not a landing page, because the form is the work. So the more specific
 * patterns come first.
 *
 * Every `kind` here is a plain-language key rather than anything a user sees.
 * It exists to group measurements — see the note above.
 */
const KINDS: readonly { kind: string; size: TaskSize; pattern: RegExp }[] = [
  { kind: 'whole-site', size: 'project', pattern: /\b(whole|entire|complete)\s+(site|website)\b/i },
  {
    kind: 'whole-site',
    size: 'project',
    pattern: /\b(build|make|create|design)\s+(me\s+)?(a|an|my|the)?\s*(new\s+)?(site|website|portfolio)\b/i,
  },
  { kind: 'from-scratch', size: 'project', pattern: /\bfrom scratch\b/i },
  { kind: 'figma-import', size: 'feature', pattern: /\bfigma\b/i },
  { kind: 'contact-form', size: 'feature', pattern: /\bcontact\s+(form|page)\b/i },
  { kind: 'form', size: 'feature', pattern: /\b(sign[- ]?up|booking|enquiry|newsletter)\s+form\b/i },
  { kind: 'navigation', size: 'feature', pattern: /\b(nav|navigation|menu|header)\b.*\b(build|add|make|create|redo|rebuild)\b|\b(build|add|make|create|redo|rebuild)\b.*\b(nav|navigation|menu)\b/i },
  { kind: 'blog', size: 'feature', pattern: /\bblog\b/i },
  { kind: 'gallery', size: 'feature', pattern: /\b(gallery|case stud(y|ies)|portfolio grid)\b/i },
  { kind: 'shop', size: 'project', pattern: /\b(shop|store|checkout|cart|payments?)\b/i },
  { kind: 'responsive', size: 'feature', pattern: /\b(responsive|mobile)\b.*\b(make|redo|fix|rebuild)\b|\b(make|redo|fix|rebuild)\b.*\b(responsive|for mobile)\b/i },
  { kind: 'landing-page', size: 'page', pattern: /\blanding page\b/i },
  {
    kind: 'page',
    size: 'page',
    pattern: /\b(add|build|make|create|write|design)\b[^.]{0,40}\bpage\b/i,
  },
  { kind: 'accessibility', size: 'feature', pattern: /\b(accessib\w+|screen reader|contrast)\b/i },
];

/** Words that make a request bigger than its shape suggests. "Rebuild the
 *  header" is not the same job as "nudge the header". */
const HEAVY = /\b(rebuild|rewrite|redesign|restructure|refactor|migrate|convert|overhaul|from scratch|all (of )?the|every)\b/i;

/**
 * Words that make it smaller. A colour, a word, a number of pixels.
 *
 * Deliberately about *intent* rather than subject matter. An earlier version of
 * this list had "spacing", "padding" and "margin" in it, on the theory that
 * those are small things — and it then read a whole brief about the top of a
 * page as a tweak because the word "spacing" appeared in the middle of it. What
 * makes a request small is somebody saying it is small.
 */
const LIGHT = /\b(tweak|nudge|slightly|a bit|a little|just|only|change the (colou?r|text|word|size|font)|rename|typo)\b/i;

/** Past this many words, somebody is describing a job rather than asking for a
 *  change. A brief is long; "make the header sticky" is not. */
const LONG_REQUEST_WORDS = 45;

const BIGGER: Readonly<Record<TaskSize, TaskSize>> = {
  tweak: 'page',
  page: 'feature',
  feature: 'project',
  project: 'project',
};

const SMALLER: Readonly<Record<TaskSize, TaskSize>> = {
  tweak: 'tweak',
  page: 'tweak',
  feature: 'page',
  project: 'feature',
};

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * What this request looks like, before anybody has done any of it.
 *
 * Unrecognised is `{ kind: 'tweak', size: 'tweak' }` — see "biased small" above.
 */
export function sizeUp(request: string): Task {
  const text = request.trim();
  if (text === '') return { kind: 'tweak', size: 'tweak' };

  const matched = KINDS.find((one) => one.pattern.test(text));
  let size: TaskSize = matched?.size ?? 'tweak';

  // A long request is a brief. One step up, once — never twice, because a long
  // sentence about a small change is still a small change.
  if (words(text) >= LONG_REQUEST_WORDS) size = BIGGER[size];
  // Explicit words beat inference in both directions, and "just" beats "long".
  if (HEAVY.test(text)) size = BIGGER[size];
  if (LIGHT.test(text)) size = SMALLER[size];

  // The kind survives a size adjustment: what the job *is* does not change
  // because somebody used the word "rebuild". Only unrecognised work borrows
  // its size as its kind, so measurements of it still group together.
  return { kind: matched?.kind ?? size, size };
}
