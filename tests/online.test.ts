/** Putting it online: what a person is told first, and what stops it.
 *
 * This is the only feature in the app that makes something public, so the two
 * things worth testing hard are the sentence somebody reads before they agree,
 * and the refusals. A build that copied a key into its output is the ordinary
 * way this goes wrong, and nobody would think to check.
 *
 * Pure — no host, no network, no folder.
 */

import { describe, expect, it } from 'vitest';

import {
  addressIn,
  onlineWords,
  safeToPutOnline,
  whatBecomesPublic,
  type Made,
} from '../src/share/online';

function made(over: Partial<Made> = {}): Made {
  return { path: 'index.html', text: '<h1>Kettle</h1>', ...over };
}

/* ========================================================================== */
/* ON-01 what somebody agrees to                                               */
/* ========================================================================== */

describe('ON-01 said plainly, before anything goes', () => {
  it('says what happens, and names the project', () => {
    const [first] = whatBecomesPublic('Kettle', 0);
    expect(first).toContain('Kettle');
    expect(first).toContain('anyone you send it to can open');
  });

  it('says what does not go, which is the part people worry about', () => {
    expect(whatBecomesPublic('Kettle', 4).join(' ')).toContain(
      'the files you work in stay on this computer',
    );
  });

  it('says how much of it goes, once that is known', () => {
    expect(whatBecomesPublic('Kettle', 1).join(' ')).toContain('One page goes.');
    expect(whatBecomesPublic('Kettle', 7).join(' ')).toContain('7 pages go.');
    expect(whatBecomesPublic('Kettle', 0).join(' ')).not.toMatch(/^\d+ pages go\.| pages go\./);
  });

  it('says it can be taken down again, because that is the fear', () => {
    expect(whatBecomesPublic('Kettle', 2).join(' ')).toContain('take it down again');
  });

  it('still says something sensible with no name to use', () => {
    const [first] = whatBecomesPublic('   ', 0);
    expect(first).toBe(onlineWords.aboutTo);
  });

  it('is two short sentences, not a paragraph nobody reads', () => {
    const said = whatBecomesPublic('Kettle', 3);
    expect(said).toHaveLength(2);
    for (const one of said) expect(one.length).toBeLessThan(200);
  });
});

/* ========================================================================== */
/* ON-02 nothing goes public with a key in it                                  */
/* ========================================================================== */

describe('ON-02 the refusals', () => {
  it('lets an ordinary finished site through', () => {
    expect(
      safeToPutOnline([made(), made({ path: 'about.html', text: '<p>hello</p>' })]),
    ).toEqual({ ok: true });
    expect(safeToPutOnline([])).toEqual({ ok: true });
  });

  it('refuses when the built pages carry a key', () => {
    const answer = safeToPutOnline([
      made({ path: 'assets/app.js', text: 'const k = "sk-lVn3Q8xTr2Ab9KdMz0PfWq7Y";' }),
    ]);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.because).toContain('put nothing online');
  });

  it('refuses a file that is a credential by its very name, before reading a byte', () => {
    const answer = safeToPutOnline([made({ path: '.env', text: '' })]);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.because).toContain('.env');
  });

  it('names the file, so the person knows what to take out', () => {
    const answer = safeToPutOnline([made(), made({ path: '.env.production', text: '' })]);
    if (answer.ok) throw new Error('expected a refusal');
    expect(answer.because).toContain('.env.production');
  });

  it('refuses in plain words, with no shop talk and no blame', () => {
    const answer = safeToPutOnline([
      made({ text: 'AKIAIOSFODNN7EXAMPLE is in here somewhere' }),
    ]);
    if (answer.ok) throw new Error('expected a refusal');
    expect(answer.because).not.toMatch(/\b(api|token|git|commit|regex|json|deploy|null)\b/i);
    expect(answer.because).toMatch(/[.!]$/);
  });

  it('says nothing has left the machine, because nothing has', () => {
    const answer = safeToPutOnline([made({ text: '-----BEGIN RSA PRIVATE KEY-----' })]);
    if (answer.ok) throw new Error('expected a refusal');
    expect(answer.because).toMatch(/put nothing online/);
  });

  it('does not read what it cannot read — bytes are not words', () => {
    expect(safeToPutOnline([made({ path: 'hero.png', text: '' })])).toEqual({ ok: true });
  });
});

/* ========================================================================== */
/* ON-03 the address that comes back                                           */
/* ========================================================================== */

describe('ON-03 finding the address in what the host said', () => {
  it('takes the working one, which every host prints last', () => {
    const said = [
      'Inspect: https://vercel.test/kettle/inspect/abc [1s]',
      'Preview: https://kettle-abc.vercel.test',
      'Production: https://kettle.vercel.test',
    ].join('\n');
    expect(addressIn(said)).toBe('https://kettle.vercel.test');
  });

  it('is only ever a locked address', () => {
    expect(addressIn('Live at http://kettle.test')).toBeNull();
  });

  it('never hands back something on this machine pretending to be somewhere', () => {
    expect(addressIn('Serving on https://localhost:5173')).toBeNull();
    expect(addressIn('https://127.0.0.1:8080/index.html')).toBeNull();
    expect(addressIn('https://kettle.local/')).toBeNull();
  });

  it('steps back past a local address to a real one', () => {
    expect(addressIn('https://kettle.test\nmirrored at https://localhost:3000')).toBe(
      'https://kettle.test',
    );
  });

  it('drops the punctuation a sentence wrapped around it', () => {
    expect(addressIn('It is at https://kettle.test/.')).toBe('https://kettle.test/');
    expect(addressIn('(see https://kettle.test)')).toBe('https://kettle.test');
  });

  it('says nothing rather than guessing when there is nothing to find', () => {
    expect(addressIn('')).toBeNull();
    expect(addressIn('Something went wrong. Try again later.')).toBeNull();
  });
});

/* ========================================================================== */
/* ON-04 the vocabulary                                                        */
/* ========================================================================== */

describe('ON-04 the words in front of somebody', () => {
  const retired =
    /\b(git|commit|branch|merge|push|pull|repo(sitory)?|deploy(s|ed|ing|ment)?|build|CLI|CDN|token|API|session|host(ing)?|bundle|static)\b/i;

  it('says nothing about the machinery', () => {
    for (const sentence of Object.values(onlineWords)) {
      expect(sentence).not.toMatch(retired);
    }
  });

  it('would notice a violation if one were written', () => {
    for (const bad of [
      'Deploying your build to the CDN',
      'Pushing to the hosting provider',
      'Your API token has expired',
    ]) {
      expect(bad).toMatch(retired);
    }
  });

  it('ends every sentence, so none of them read as a fragment', () => {
    for (const [name, sentence] of Object.entries(onlineWords)) {
      if (name === 'label' || name === 'confirm') continue;
      expect(sentence).toMatch(/[.!…]$/);
    }
  });

  it('every failure is a sentence saying what did not happen', () => {
    for (const sentence of [
      onlineWords.cannot,
      onlineWords.notSignedIn,
      onlineWords.couldNotPut,
      onlineWords.nothingToPut,
      onlineWords.noAddress,
    ]) {
      expect(sentence.length).toBeGreaterThan(30);
    }
    expect(onlineWords.cannot).toContain('nothing has left it');
    expect(onlineWords.notSignedIn).toContain('nothing has left it');
    expect(onlineWords.couldNotPut).toContain('nothing has left this computer');
  });
});
