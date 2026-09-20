/** Attachments that are written down, by what is in them.
 *
 *  The window's copy of a dropped file is an object URL: gone on reload, gone
 *  when the tab changes, useless to a retry tomorrow. So the shell keeps the
 *  bytes under a name that is the hash of the content itself, and this is what
 *  that store has to get right — one file per distinct content, the facts and
 *  the small copy beside it rather than inside it, a ceiling that belongs to the
 *  conversation, and one file that will not come in not taking the others with
 *  it.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { MAX_AT_ONCE, MAX_BYTES } from '../src/lib/attachments';
import {
  MAX_KEPT_BYTES,
  MAX_PER_CONVERSATION,
  attachmentsFolder,
  contentId,
  copyOf,
  keep,
  type Incoming,
} from '../electron/services/attachment-store';

const made: string[] = [];

async function profile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-attachments-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

function picture(name: string, said: string, thumb?: Uint8Array): Incoming {
  return {
    name,
    kind: 'image',
    mimeType: 'image/png',
    bytes: new TextEncoder().encode(said),
    ...(thumb === undefined ? {} : { thumb }),
  };
}

describe('the attachment store', () => {
  /* The two ceilings are one rule stated twice: the box refuses a file above
     25 MB, and a copy the app keeps is worth exactly as much as one it can
     send. If either number moves on its own, this is what notices. */
  it('keeps the box’s own ceilings', () => {
    expect(MAX_KEPT_BYTES).toBe(MAX_BYTES);
    expect(MAX_PER_CONVERSATION).toBe(MAX_AT_ONCE);
  });

  it('names a file by what is in it, not by what it is called', async () => {
    const here = await profile();
    const first = await keep(here, [picture('hero.png', 'the same picture')]);
    const again = await keep(here, [picture('hero-final.png', 'the same picture')]);

    expect(first.kept[0]?.id).toBe(contentId(new TextEncoder().encode('the same picture')));
    // The same bytes under another name are the same stored attachment, and
    // the name it was first kept under is the one that answers.
    expect(again.kept[0]?.id).toBe(first.kept[0]?.id);
    expect(again.kept[0]?.twice).toBe(true);
    expect(again.kept[0]?.name).toBe('hero.png');
    expect(again.because).toBeNull();

    const stored = await readdir(attachmentsFolder(here));
    expect(stored.filter((one) => one.endsWith('.bin'))).toHaveLength(1);
  });

  it('keeps the facts and the small copy beside the bytes, not inside them', async () => {
    const here = await profile();
    const thumb = new TextEncoder().encode('a very small copy');
    const kept = await keep(here, [picture('hero.png', 'the whole thing', thumb)]);
    const id = kept.kept[0]?.id ?? '';

    const folder = attachmentsFolder(here);
    expect(await readFile(join(folder, `${id}.bin`), 'utf8')).toBe('the whole thing');
    expect(await readFile(join(folder, `${id}.thumb.jpg`), 'utf8')).toBe('a very small copy');

    // Everything a chip is drawn from is in the metadata: the original is not
    // read for a row, which is the whole reason the two are apart.
    const meta = JSON.parse(await readFile(join(folder, `${id}.json`), 'utf8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ name: 'hero.png', kind: 'image', mimeType: 'image/png', byteSize: 15 });
    expect(meta['bytes']).toBeUndefined();
    expect(kept.kept[0]?.thumb).toBe(
      `data:image/jpeg;base64,${Buffer.from(thumb).toString('base64')}`,
    );
    expect(kept.kept[0]?.thumb).not.toContain('the whole thing');
  });

  it('leaves a document with a name and no small copy', async () => {
    const here = await profile();
    const kept = await keep(here, [
      { name: 'Brand.pdf', kind: 'document', mimeType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4') },
    ]);
    expect(kept.kept[0]?.kind).toBe('document');
    expect(kept.kept[0]?.thumb).toBeNull();
  });

  it('keeps the ones that fit and names the one that does not', async () => {
    const here = await profile();
    const tooBig: Incoming = {
      name: 'Poster.png',
      kind: 'image',
      mimeType: 'image/png',
      bytes: new Uint8Array(MAX_KEPT_BYTES + 1),
    };
    const accepted = await keep(here, [tooBig, picture('hero.png', 'it fits')]);

    expect(accepted.kept.map((one) => one.name)).toEqual(['hero.png']);
    expect(accepted.refused).toHaveLength(1);
    expect(accepted.refused[0]?.name).toBe('Poster.png');
    // Which file failed, and that the rest arrived. Both halves, or a person
    // reads a missing picture as a bug in the app.
    expect(accepted.because).toContain('Poster.png');
    expect(accepted.because).toContain('the other one did');
    expect(accepted.because).toMatch(/25 MB/);
    // And nothing was written for the one that did not fit.
    expect(await readdir(attachmentsFolder(here))).toHaveLength(2);
  });

  it('says so, and keeps nothing, when a file arrives empty', async () => {
    const here = await profile();
    const accepted = await keep(here, [
      { name: 'blank.png', kind: 'image', mimeType: 'image/png', bytes: new Uint8Array(0) },
    ]);
    expect(accepted.kept).toEqual([]);
    expect(accepted.because).toContain('blank.png');
    expect(accepted.because).toContain('nothing in it');
  });

  /* The ceiling belongs to the conversation, not to one drop: twelve is what
     one drag brings in, and a second drag cannot make room by arriving
     separately. */
  it('holds the conversation’s ceiling across drops', async () => {
    const here = await profile();
    const first = await keep(
      here,
      Array.from({ length: MAX_PER_CONVERSATION }, (_, at) => picture(`shot-${at}.png`, `picture ${at}`)),
    );
    expect(first.kept).toHaveLength(MAX_PER_CONVERSATION);
    expect(first.refused).toEqual([]);

    const holding = first.kept.map((one) => one.id);
    const second = await keep(here, [picture('one-more.png', 'one more')], holding);

    expect(second.kept).toEqual([]);
    expect(second.refused[0]?.name).toBe('one-more.png');
    expect(second.because).toContain(`holding ${MAX_PER_CONVERSATION} attachments`);
  });

  /* A retry after a failed send hands over what is already held. That is not
     thirteen attachments, it is the same twelve, and none of them is refused. */
  it('does not count a retry of something already held', async () => {
    const here = await profile();
    const files = Array.from({ length: MAX_PER_CONVERSATION }, (_, at) => picture(`shot-${at}.png`, `picture ${at}`));
    const first = await keep(here, files);
    const holding = first.kept.map((one) => one.id);

    const retried = await keep(here, files, holding);
    expect(retried.refused).toEqual([]);
    expect(retried.kept).toHaveLength(MAX_PER_CONVERSATION);
    expect(retried.kept.every((one) => one.twice)).toBe(true);
    expect(await readdir(attachmentsFolder(here))).toHaveLength(MAX_PER_CONVERSATION * 2);
  });

  it('hands the original bytes back by id, and nothing for anything else', async () => {
    const here = await profile();
    const kept = await keep(here, [picture('hero.png', 'the whole thing')]);
    const id = kept.kept[0]?.id ?? '';

    const back = await copyOf(here, id);
    expect(back?.name).toBe('hero.png');
    expect(Buffer.from(back?.bytes ?? '', 'base64').toString('utf8')).toBe('the whole thing');

    // Only a content id names a file here, so a path or a truncated hash
    // resolves to nothing rather than to somebody else's bytes.
    expect(await copyOf(here, '../../etc/passwd')).toBeNull();
    expect(await copyOf(here, id.slice(0, 12))).toBeNull();
    expect(await copyOf(here, 'f'.repeat(64))).toBeNull();
  });

  it('rejects and repairs metadata that points at the wrong content or path', async () => {
    const here = await profile();
    const bytes = new TextEncoder().encode('repair me');
    const kept = await keep(here, [picture('repair.png', 'repair me', new Uint8Array([1, 2, 3]))]);
    const id = kept.kept[0]?.id ?? '';
    const metadata = join(attachmentsFolder(here), `${id}.json`);

    // A corrupted row must not be trusted by reads, even though the bytes file
    // itself is present. Re-importing the same content repairs the row from the
    // caller-owned id/kind/mime/path rather than preserving hostile fields.
    await writeFile(
      metadata,
      JSON.stringify({
        id: 'f'.repeat(64),
        name: 'wrong',
        kind: 'other',
        mimeType: 'text/plain',
        byteSize: bytes.length + 1,
        keptAt: 'not-a-date',
        thumbName: '../../outside.jpg',
      }),
      'utf8',
    );
    expect(await copyOf(here, id)).toBeNull();

    const repaired = await keep(here, [picture('repair.png', 'repair me', new Uint8Array([1, 2, 3]))]);
    expect(repaired.kept[0]?.id).toBe(id);
    expect((JSON.parse(await readFile(metadata, 'utf8')) as Record<string, unknown>)).toMatchObject({
      id,
      kind: 'image',
      mimeType: 'image/png',
      byteSize: bytes.length,
      thumbName: `${id}.thumb.jpg`,
    });
    expect(await copyOf(here, id)).not.toBeNull();
  });

  it('rejects metadata whose kept timestamp is not a date', async () => {
    const here = await profile();
    const kept = await keep(here, [picture('dated.png', 'dated')]);
    const id = kept.kept[0]?.id ?? '';
    const metadata = join(attachmentsFolder(here), `${id}.json`);
    const valid = JSON.parse(await readFile(metadata, 'utf8')) as Record<string, unknown>;
    await writeFile(metadata, JSON.stringify({ ...valid, keptAt: 'not-a-date' }), 'utf8');

    expect(await copyOf(here, id)).toBeNull();
    await keep(here, [picture('dated.png', 'dated')]);
    expect(await copyOf(here, id)).not.toBeNull();
  });
});
