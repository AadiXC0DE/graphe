/** An attached PDF, from the box to the model.
 *
 *  Every piece of this already existed and none of it was joined: the picker
 *  offered PDFs, `checkFile` took them, a chip appeared — and then the window
 *  sent only `kind: 'image'`, the preload dropped everything else, and the box
 *  emptied on send. The PDF vanished with no word said about it anywhere.
 *
 *  So nothing here re-tests the reading — that is next door in pdf.test.ts.
 *  Everything here fails when the *join* comes apart again: the window not
 *  sending it, the wire filtering it out, or the shell not turning it into the
 *  words that go with the message.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkFile } from '../src/lib/attachments';

const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const PRELOAD = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
const COMPOSER = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');

describe('a PDF the person attached', () => {
  it('is taken by the box the picker offers it to', () => {
    expect(COMPOSER).toContain("const ACCEPT = 'image/*,application/pdf'");
    expect(checkFile({ name: 'Brand.pdf', type: 'application/pdf', size: 2000 })).toEqual({
      ok: true,
      kind: 'document',
    });
  });

  it('is put on the wire by the window, not only pictures', () => {
    expect(APP).toContain('attached.kind === "document" || (attached.kind === "image" && !blind)');
    expect(APP).toContain('kind: attached.kind === "document" ? "document" : "image"');
  });

  /* A model that cannot read pictures can still read a PDF's words, so the box
     is only held back for the picture that is actually being refused. */
  it('is not held back by a model that cannot read pictures', () => {
    expect(APP).toContain('const held = blind && inTheBox.some((one) => one.kind === "image")');
    expect(APP).toContain('if (inTheBox.length > 0 && !held) emptyTheBox()');
  });

  it('survives the wire, which used to keep pictures and nothing else', () => {
    expect(PRELOAD).toContain("(one.kind === 'image' || one.kind === 'document')");
  });

  it('reaches the model as the words the shell read out of it', () => {
    expect(MAIN).toContain('async function paperWords(');
    expect(MAIN).toContain("if (paper['kind'] !== 'document') continue");
    // The reader refuses a Buffer outright, so the decode must hand it a plain
    // array. Nothing but a real PDF catches this, so it is nailed down here.
    expect(MAIN).toContain('readPdfPages(new Uint8Array(Buffer.from(bytes, ');
    expect(MAIN).toContain('const papers = await paperWords(attachments)');
  });

  /* Two ways out of the handler — held back for a look first, or sent — and a
     PDF that only made it into one of them is a PDF lost half the time. */
  it('goes with the message down both paths out of the handler', () => {
    expect(MAIN).toContain("const asked = [text, papers, plan ?? ''].filter");
    const at = MAIN.indexOf('return await checkItFirst(');
    expect(at).toBeGreaterThan(-1);
    expect(MAIN.slice(at, at + 240)).toContain('asked,');
    expect(MAIN).toContain('chosen.length === 0\n          ? asked');
  });
});
