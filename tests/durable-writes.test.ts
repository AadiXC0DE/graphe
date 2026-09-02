/** Nothing durable is written in place.
 *
 * Everything this app keeps and reads back later — the checklist, the checkout
 * index, the servers it is holding, a stylesheet the design view rewrote — is
 * believed the next time it is read. A file half-written when the power went is
 * not a smaller file, it is unreadable json, and unreadable json is reported as
 * "there is no checklist" rather than as damage.
 *
 * So the rule is one rule: write beside it, then move it into place. This is
 * the gate on that, because a rule nobody checks is a rule that lasted one
 * refactor.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Where durable state is written from. The renderer keeps nothing of its own
 *  on disk, so it is not here. */
const LOOKED_AT = ['electron', 'src/projects', 'src/history', 'src/work', 'src/lib'];

function filesUnder(folder: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const one of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, one.name);
      if (one.isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.tsx?$/.test(path)) found.push(path);
    }
  };
  if (statSync(folder, { throwIfNoEntry: false }) === undefined) return found;
  walk(folder);
  return found;
}

/** A write is fine when it is the shared helper, when it is a first write that
 *  refuses to overwrite (`flag: 'wx'`), or when it writes a neighbour that a
 *  `rename` then moves into place — which is what the helper does, and what a
 *  handful of stores did before there was one. */
function writesInPlace(source: string): readonly string[] {
  const wrong: string[] = [];
  const lines = source.split('\n');
  for (const [at, line] of lines.entries()) {
    if (!/\bwriteFileSync?\(|\bwriteFile\(/.test(line)) continue;
    if (/flag: 'wx'/.test(line)) continue;
    const around = lines.slice(Math.max(0, at - 4), at + 6).join('\n');
    // A neighbour written and then moved: the same two steps, spelled out.
    if (/temporary|beside|\.writing/.test(around) && /rename/.test(around)) continue;
    wrong.push(line.trim());
  }
  return wrong;
}

describe('durable state', () => {
  it('is never written straight over the file it replaces', () => {
    const wrong: string[] = [];
    for (const folder of LOOKED_AT) {
      for (const file of filesUnder(folder)) {
        const source = readFileSync(file, 'utf8');
        // The helper is the thing being tested; it is allowed to say the word.
        if (file.endsWith(join('lib', 'atomic.ts'))) continue;
        for (const line of writesInPlace(source)) wrong.push(`${file}: ${line}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('has one helper everything can reach for', () => {
    const helper = readFileSync('src/lib/atomic.ts', 'utf8');
    expect(helper).toContain('export async function writeAtomically');
    expect(helper).toContain('export function writeAtomicallySync');
    // Beside it, not in the system temp folder: `rename` is only atomic within
    // one filesystem.
    expect(helper).toContain('dirname(file)');
  });
});
