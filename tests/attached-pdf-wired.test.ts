// @vitest-environment jsdom
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
 *
 *  Source text, not behaviour: the window, preload and shell join for a PDF; no behavioural test can reach it — Electron wiring.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';

import Composer from '../src/components/Composer';
import { checkFile } from '../src/lib/attachments';

const APP = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const PRELOAD = readFileSync(join(process.cwd(), 'electron/preload.ts'), 'utf8');
const MAIN = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/** The composer as the window mounts it, so the picker is read off the box
 *  rather than off the line that spells it. */
function pickerAccepts(): string | null {
  const host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(Composer, { onSend: () => undefined }));
  });
  const accept = host.querySelector('input[type="file"]')?.getAttribute('accept') ?? null;
  act(() => {
    root.unmount();
  });
  host.remove();
  return accept;
}

describe('a PDF the person attached', () => {
  /* Both halves of the same join: what the picker offers and what the box then
     takes. A type added to one and not the other is a file that is offered and
     refused, or taken and never offerable. */
  it('is taken by the box the picker offers it to', () => {
    const accept = pickerAccepts() ?? '';
    expect(accept).toContain('application/pdf');
    expect(accept).toContain('image/*');
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
    // Taken once the shell has the message, and only from the conversation that
    // sent it: a send that comes back refused leaves the box as it was.
    expect(APP).toContain('if (!held) emptyTheBox(mine, inTheBox);');
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

  /* The PDF's words have to be in what the model is handed, whether or not a
     skill — or the project's shared context — was folded in beside them. */
  it('goes with the message, whichever way the words are built', () => {
    expect(MAIN).toContain("const asked = [text, papers].filter");
    // Indentation is no part of the join, so it is not asserted: the two
    // branches that fold the shared context or a selected skill in have to be
    // built from the words the papers are already in.
    expect(MAIN).toMatch(/const withContext =\s*shared === null \? asked/);
    expect(MAIN).toMatch(/chosen\.length === 0\s*\? withContext/);
    expect(MAIN).toContain('await agent.prompt(withSkills, imageCards(attachments), { lookFirst, queue });');
  });
});
