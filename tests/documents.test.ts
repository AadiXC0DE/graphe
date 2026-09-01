/** Reading the documents people hand over.
 *
 * Every one of these is built as a real file on disk and read back through the
 * same function the tool calls — a zip reader tested against a hand-written
 * byte string is a test of the test.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createWriteStream, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { evaluate } from '../src/agent/guard/policy';
import {
  documentKind,
  documentSaid,
  inNumberOrder,
  readDocument,
  textFromXml,
  unzip,
} from '../src/agent/pi/documents';

const runFile = promisify(execFile);
const folder = mkdtempSync(join(tmpdir(), 'graphe-docs-'));

/* A zip written here rather than by a library, because the reader under test is
   the only zip code in the app and a fixture built by the same assumptions
   would agree with it whatever those assumptions were. This writes the format
   as the specification states it; `zipinfo` below confirms that independently. */
function zipOf(entries: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let at = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 14); // crc, unchecked by the reader
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(at, 42);
    directory.push(entry, nameBytes);
    at += 30 + nameBytes.length + packed.length;
  }
  const body = Buffer.concat(locals);
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, central, end]);
}

function write(name: string, entries: Readonly<Record<string, string>>): string {
  const path = join(folder, name);
  writeFileSync(path, zipOf(entries));
  return path;
}

const TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

describe('DOC-01 which files this answers for', () => {
  it('knows the four it can read', () => {
    expect(documentKind('/a/b.pdf')).toBe('pdf');
    expect(documentKind('/a/b.DOCX')).toBe('word');
    expect(documentKind('/a/b.pptx')).toBe('slides');
    expect(documentKind('/a/b.xlsx')).toBe('sheet');
  });

  /* The older formats are not zip archives, and half-reading one would answer
     with plausible rubbish rather than saying it cannot. */
  it('does not claim the older formats it cannot open', () => {
    for (const old of ['/a/b.doc', '/a/b.ppt', '/a/b.xls', '/a/b.pages', '/a/b.txt']) {
      expect(documentKind(old), old).toBeNull();
    }
  });

  it('says what it can read when handed something else', async () => {
    const plain = join(folder, 'notes.txt');
    writeFileSync(plain, 'hello');
    await expect(readDocument(plain)).rejects.toThrow(/\.pdf, \.docx, \.pptx, \.xlsx/);
  });
});

describe('DOC-02 the zip inside an office file', () => {
  /* The reader is the only zip code here, so it is checked against the system's
     own unzip rather than only against itself. */
  it('agrees with the operating system about what is in the archive', async () => {
    const path = write('agree.docx', { '[Content_Types].xml': TYPES, 'word/document.xml': '<w:t>x</w:t>' });
    const { stdout } = await runFile('/usr/bin/zipinfo', ['-1', path]);
    const theirs = stdout.trim().split('\n').sort();
    const ours = [...unzip(readFileSync(path)).keys()].sort();
    expect(ours).toEqual(theirs);
  });

  it('answers with nothing for a file that is not an archive at all', () => {
    expect(unzip(Buffer.from('not a zip, just some bytes')).size).toBe(0);
  });
});

describe('DOC-03 turning the xml into words', () => {
  it('drops the tags and puts the entities back', () => {
    expect(textFromXml('<a><b>Revenue rose 12% &amp; costs &lt;fell&gt;</b></a>')).toBe(
      'Revenue rose 12% & costs <fell>',
    );
  });

  it('breaks a line where the format says a line breaks', () => {
    const said = textFromXml('<w:p><w:t>one</w:t></w:p><w:p><w:t>two</w:t></w:p>', ['</w:p>']);
    expect(said).toBe('one\ntwo');
  });

  it('drops the blank lines a stripped tag leaves behind', () => {
    expect(textFromXml('<a></a><b>  </b><c>said</c>', ['</a>', '</b>'])).toBe('said');
  });

  /* slide10 sorts before slide2 alphabetically, which is the wrong deck. */
  it('puts slide 10 after slide 2, not after slide 1', () => {
    expect(
      inNumberOrder(['ppt/slides/slide10.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide1.xml']),
    ).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide10.xml']);
  });
});

describe('DOC-04 each format, read from a real file', () => {
  it('reads a word file paragraph by paragraph', async () => {
    const path = write('review.docx', {
      '[Content_Types].xml': TYPES,
      'word/document.xml':
        '<w:document xmlns:w="x"><w:body>' +
        '<w:p><w:r><w:t>Quarterly review</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Revenue rose 12% &amp; costs fell.</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    });
    const doc = await readDocument(path);
    expect(doc.kind).toBe('word');
    expect(doc.pages.join('\n')).toBe('Quarterly review\nRevenue rose 12% & costs fell.');
  });

  it('reads a deck one slide at a time, in the order somebody sees them', async () => {
    const slide = (text: string): string =>
      `<p:sld xmlns:p="x" xmlns:a="y"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
    const path = write('deck.pptx', {
      '[Content_Types].xml': TYPES,
      'ppt/slides/slide1.xml': slide('Title'),
      'ppt/slides/slide10.xml': slide('The last one'),
      'ppt/slides/slide2.xml': slide('The problem'),
    });
    const doc = await readDocument(path);
    expect(doc.kind).toBe('slides');
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages[0]).toContain('Title');
    expect(doc.pages[1]).toContain('The problem');
    expect(doc.pages[2]).toContain('The last one');
  });

  it('reads a spreadsheet through the table its cells point at', async () => {
    const path = write('book.xlsx', {
      '[Content_Types].xml': TYPES,
      'xl/sharedStrings.xml':
        '<sst xmlns="x"><si><t>Region</t></si><si><t>Revenue</t></si><si><t>North</t></si></sst>',
    });
    const doc = await readDocument(path);
    expect(doc.kind).toBe('sheet');
    expect(doc.pages.join('\n')).toContain('Region');
    expect(doc.pages.join('\n')).toContain('North');
  });

  it('says plainly when a document holds pictures rather than words', async () => {
    const path = write('pictures.docx', { '[Content_Types].xml': TYPES, 'word/document.xml': '<w:body/>' });
    const doc = await readDocument(path);
    expect(documentSaid('pictures.docx', doc)).toContain('no text in it');
  });

  it('says so rather than answering with rubbish for a damaged file', async () => {
    const path = join(folder, 'damaged.docx');
    writeFileSync(path, 'this was never a zip');
    await expect(readDocument(path)).rejects.toThrow(/not readable as a document/);
  });
});

describe('DOC-05 a real pdf, made by this machine', () => {
  it('reads as the words that went into it', async () => {
    const source = join(folder, 'note.txt');
    writeFileSync(source, 'Quarterly review\nRevenue rose and costs fell.\n');
    const path = join(folder, 'note.pdf');
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(path);
      const made = spawn('/usr/sbin/cupsfilter', [source]);
      made.stdout.pipe(out);
      made.on('error', reject);
      made.on('close', () => out.end(() => resolve()));
    });
    const doc = await readDocument(path);
    expect(doc.kind).toBe('pdf');
    expect(documentSaid('note.pdf', doc)).toContain('Quarterly review');
  }, 30_000);
});

/* A tool that opens any file it is given is a tool that opens the wrong one.
   It goes through the same rules as every other read rather than around them. */
describe('DOC-06 what the Guard makes of it', () => {
  const ctx = { projectRoot: '/work/site', howFar: 'changing' } as never;
  const asked = (path: string) => evaluate({ id: 'x', name: 'read_document', input: { path } }, ctx);

  it('opens a document in the project', () => {
    expect(asked('/work/site/docs/spec.pdf').kind).toBe('allow');
  });

  it('refuses one outside the project', () => {
    const verdict = asked('/Users/someone/Desktop/private.pdf');
    expect(verdict.kind).toBe('deny');
    expect(verdict.kind === 'deny' && verdict.reason).toContain('outside your project folder');
  });

  it('refuses a file holding keys, whatever it is called', () => {
    const verdict = asked('/work/site/.env');
    expect(verdict.kind).toBe('deny');
    expect(verdict.kind === 'deny' && verdict.reason).toContain('keys and passwords');
  });
});
