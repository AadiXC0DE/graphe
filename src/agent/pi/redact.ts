/** Taking the keys out of what gets written down.
 *
 * A transcript is kept for ever and holds every tool result in full: the
 * contents of files the model read, the output of commands it ran, pages it
 * fetched. One `cat .env`, one `printenv`, one deploy script echoing its own
 * token, and the key is on the disk in the clear long after anybody remembers
 * it being there.
 *
 * The Guard already knows the shapes — `findSecret` is what it reads a tool
 * call with — so the same detector reads the result on the way out. The name of
 * what was found stays: "[sign-in key hidden]" is a line somebody can act on,
 * and a row of asterisks is not.
 *
 * Pure, and it never throws. What the model sees during the turn is untouched;
 * this is only about what survives it.
 */

import { findSecret } from '../guard/policy';

/** A key spelled out beside its name: `OPENAI_API_KEY=sk-…`, `"token": "…"`.
 *  The name stays — knowing which credential was involved is the point — and
 *  only the value goes. */
const ASSIGNED =
  /([A-Za-z0-9_]*(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|private[_-]?key)[A-Za-z0-9_]*)(\s*[:=]\s*)(["'`]?)([^"'`\s,;]{6,})\3/gi;

/** A private key runs over many lines, so it cannot be caught word by word. */
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

function hidden(name: string): string {
  return `[${name} hidden]`;
}

/** Everything the Guard would recognise, replaced by the name of what it was.
 *
 *  The one masker for anything written to disk — the log on one side of the app
 *  and the transcript on the other. Two of these would drift, and the one that
 *  drifted would be the one nobody was reading. */
export function mask(text: string): string {
  return masked(text).text;
}

/** The same, and how many were found. */
function masked(text: string): { text: string; found: number } {
  let found = 0;
  let out = text.replace(PRIVATE_KEY, () => {
    found += 1;
    return hidden('private key');
  });
  out = out.replace(ASSIGNED, (all: string, name: string, between: string, quote: string, value: string) => {
    // A count is not a credential: `tokensUsed=182400` is ordinary output.
    if (/^[\d.]+$/.test(value)) return all;
    found += 1;
    return `${name}${between}${quote}${hidden('key')}${quote}`;
  });
  out = out.replace(/\S+/g, (word) => {
    // Already replaced by this pass; the brackets are not a second secret.
    if (word.includes('hidden]')) return word;
    const name = findSecret(word);
    if (name === null) return word;
    found += 1;
    return hidden(name);
  });
  return { text: out, found };
}

/**
 * One tool result, ready to be written down.
 *
 * `found` is what a caller shows: the transcript can say once that something
 * was taken out of it, which is the difference between a record that is honest
 * about being incomplete and one that quietly is.
 */
export function maskToolResult(text: string): { text: string; found: number } {
  if (text === '') return { text, found: 0 };
  try {
    return masked(text);
  } catch {
    // A detector that threw must not cost the turn its result. The text goes
    // through unread, which is what it did before any of this existed.
    return { text, found: 0 };
  }
}
