/** Putting it online, decided before anything is spawned.
 *
 * Everything here is a judgement rather than an action: what is about to become
 * public, whether it is safe to let go of, and what address came back. The part
 * that reaches the network lives in `publish.ts` and imports this — so what we
 * promise somebody before they press can be tested without a network, and the
 * refusals can be tested without a host.
 */

import { evaluate } from '../agent/guard/policy';
import { isCredentialPath } from '../agent/guard/paths';

/** One file of the finished site, as it would be handed over. */
export type Made = { path: string; text: string };

/** Every sentence this feature can put in front of somebody. */
export const onlineWords = {
  label: 'Put it online',
  hint: 'Gets your project ready and gives you an address anyone can open.',
  /** Said before anything leaves, every time. */
  aboutTo: 'This puts your project on the internet at an address anyone you send it to can open.',
  /** The second half of that, so nobody is surprised by the shape of it. */
  andSo:
    'Only the finished pages go, and the files you work in stay on this computer. You can take it down again afterwards.',
  confirm: 'Yes, put it online',
  working: 'Getting your project ready and putting it online…',
  /** When it worked. The address itself is shown beside this. */
  live: 'It is online. Anyone with this address can open it.',
  nothingToPut:
    'There is nothing here to put online yet. I could not find any finished pages in this project.',
  cannot:
    'This computer has nothing set up to put a project online, so nothing has left it. Once that is installed, this button will work.',
  notSignedIn:
    'This computer is not signed in to the place I put projects online, so nothing has left it. Sign in there once and this will work from then on.',
  couldNotPut: 'I could not put it online, so nothing has left this computer.',
  noAddress:
    'It went, but nothing came back that I could turn into an address. Nothing else has changed.',
} as const;

/** The plain sentence somebody gets instead of their key going public. */
const REFUSAL =
  'One of your private keys is written into the finished pages. Anyone opening the address could read it, so I have put nothing online. Take the key out and ask again.';

/** And the one for a file that is a credential by its very name. */
const NAMED = (path: string): string =>
  `The finished pages include ${path}, which is where private keys live. Anyone opening the address could read it, so I have put nothing online.`;

/**
 * What a person is agreeing to, in the order they need to hear it.
 *
 * Three short sentences rather than one long one: what happens, what goes, and
 * what does not. A confirmation nobody reads is a confirmation that did not
 * happen, and the way to be read is to be short.
 */
export function whatBecomesPublic(project: string, pages: number): readonly string[] {
  const named = project.trim();
  const what =
    named === ''
      ? onlineWords.aboutTo
      : `This puts ${named} on the internet at an address anyone you send it to can open.`;
  const many =
    pages <= 0
      ? null
      : pages === 1
        ? 'One page goes.'
        : `${pages} pages go.`;
  return many === null ? [what, onlineWords.andSo] : [what, `${many} ${onlineWords.andSo}`];
}

/**
 * Is the finished site safe to let go of?
 *
 * Two questions, and the second is the one a designer would never think to ask:
 * a build that copied the file holding their keys into the output is a build
 * that is about to publish them. The Guard decides what a key looks like, here
 * as everywhere else.
 */
export function safeToPutOnline(
  made: readonly Made[],
): { ok: true } | { ok: false; because: string } {
  for (const file of made) {
    if (isCredentialPath(file.path)) return { ok: false, because: NAMED(file.path) };
  }
  for (const file of made) {
    if (file.text === '') continue;
    const verdict = evaluate(
      { id: 'online', name: 'share', input: { text: file.text } },
      { projectRoot: '' },
    );
    if (verdict.kind === 'deny') return { ok: false, because: REFUSAL };
  }
  return { ok: true };
}

/** Only ever https, and never something on this machine pretending to be
 *  somewhere. An address we cannot vouch for is worse than no address. */
const ADDRESS = /https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[\w./-]*)?/gi;

const NOT_A_SITE = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/**
 * The address the host printed, out of everything else it printed.
 *
 * Hosts write a paragraph — where it is building, how long it took, a hint
 * about a dashboard — and exactly one line of it is the thing somebody wants.
 * The last address wins, because every host prints the working one last.
 */
export function addressIn(output: string): string | null {
  const found = output.match(ADDRESS);
  if (found === null) return null;
  for (let at = found.length - 1; at >= 0; at -= 1) {
    const one = (found[at] ?? '').replace(/[).,'"]+$/, '');
    let host: string;
    try {
      host = new URL(one).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (NOT_A_SITE.has(host) || host.endsWith('.local')) continue;
    return one;
  }
  return null;
}
