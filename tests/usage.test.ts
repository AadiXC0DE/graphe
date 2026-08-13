/** Where a component is used, read out of the files themselves.
 *
 * Three things have to be right or nobody can act on the answer. The count has
 * to match what a person would get by reading every file by hand — including
 * the uses that arrive through a file that only passes a name on, and
 * excluding the pointed brackets that are types rather than tags. A component
 * nobody writes out has to come back as nothing rather than as absent. And
 * anything the reading cannot see has to say so, because a quietly low number
 * is worse than no number at all when somebody is deciding what to change.
 *
 * The precise cases run on files made of strings; the last one runs on this
 * repository, which is a real project with a real design system in it.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { kindOf, named, readUsage, usageFrom, type SourceFile, type Usage } from '../src/design/usage';

const project = (files: Record<string, string>): Usage =>
  usageFrom(Object.entries(files).map(([one, text]): SourceFile => ({ path: one, text })));

const one = (usage: Usage, name: string) => {
  const found = named(usage, name)[0];
  if (found === undefined) throw new Error(`no component called ${name}`);
  return found;
};

const places = (usage: Usage, name: string) =>
  one(usage, name).used.map((where) => `${where.file}:${where.times}`);

const BUTTON = `export default function Button({ label }: { label: string }) {
  return <button className="btn">{label}</button>;
}
`;

describe('reading where a component is used', () => {
  it('finds the component and every file that writes it out', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\nexport function Header() {\n  return <div><Button label="a" /><Button label="b" /></div>;\n}\n`,
      'src/Footer.tsx': `import Button from './Button';\nexport function Footer() {\n  return <Button label="c" />;\n}\n`,
    });
    expect(places(usage, 'Button')).toEqual(['src/Header.tsx:2', 'src/Footer.tsx:1']);
    expect(one(usage, 'Button').times).toBe(3);
  });

  /** The line is what turns "three places" into somewhere to go. */
  it('says which line each use is on', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\n\nexport function Header() {\n  return (\n    <div>\n      <Button label="a" />\n    </div>\n  );\n}\n`,
    });
    expect(one(usage, 'Button').used[0]?.lines).toEqual([6]);
    expect(one(usage, 'Button').line).toBe(1);
  });

  /** The one a designer most wants to know about: safe to change, or dead. */
  it('keeps a component nobody writes out, and says so', () => {
    const usage = project({ 'src/Button.tsx': BUTTON });
    expect(one(usage, 'Button').times).toBe(0);
    expect(one(usage, 'Button').says).toBe('Nowhere else in the project.');
    expect(usage.mayBeMore).toBe(false);
  });

  /** A design system with one door into it must read the same as one without. */
  it('follows a name through a file that only passes it on', () => {
    const usage = project({
      'src/ui/Button.tsx': BUTTON,
      'src/ui/index.ts': `export { default as Button } from './Button';\n`,
      'src/Header.tsx': `import { Button } from './ui';\nexport function Header() {\n  return <Button label="a" />;\n}\n`,
    });
    expect(one(usage, 'Button').file).toBe('src/ui/Button.tsx');
    expect(places(usage, 'Button')).toEqual(['src/Header.tsx:1']);
  });

  it('follows a door that passes on everything at once', () => {
    const usage = project({
      'src/ui/Button.tsx': `export function Button() {\n  return <button />;\n}\n`,
      'src/ui/index.ts': `export * from './Button';\n`,
      'src/Header.tsx': `import { Button } from './ui';\nexport function Header() {\n  return <Button />;\n}\n`,
    });
    expect(places(usage, 'Button')).toEqual(['src/Header.tsx:1']);
  });

  /** Renaming on the way in is common, and it is still the same component. */
  it('counts a use written under another name', () => {
    const usage = project({
      'src/Button.tsx': `export function Button() {\n  return <button />;\n}\n`,
      'src/Header.tsx': `import { Button as Pressable } from './Button';\nexport function Header() {\n  return <Pressable />;\n}\n`,
    });
    expect(places(usage, 'Button')).toEqual(['src/Header.tsx:1']);
    expect(named(usage, 'Pressable')).toEqual([]);
  });

  it('counts a use reached through the whole of another file', () => {
    const usage = project({
      'src/ui/Button.tsx': BUTTON,
      'src/Header.tsx': `import * as UI from './ui/Button';\nexport function Header() {\n  return <UI.default />;\n}\n`,
      'src/Side.tsx': `import * as Kit from './ui/Button';\nexport function Side() {\n  return <Kit.Button />;\n}\n`,
    });
    expect(one(usage, 'Button').times).toBe(2);
  });

  /** Two components can share a name; which one broke depends on the file. */
  it('tells apart two components of the same name', () => {
    const usage = project({
      'src/ui/Card.tsx': `export function Card() {\n  return <div />;\n}\n`,
      'src/marketing/Card.tsx': `export function Card() {\n  return <section />;\n}\n`,
      'src/A.tsx': `import { Card } from './ui/Card';\nexport function A() {\n  return <Card />;\n}\n`,
      'src/B.tsx': `import { Card } from './marketing/Card';\nexport function B() {\n  return <Card />;\n}\n`,
    });
    const both = named(usage, 'Card');
    expect(both.map((card) => `${card.file} ${card.used.map((where) => where.file).join()}`)).toEqual([
      'src/marketing/Card.tsx src/B.tsx',
      'src/ui/Card.tsx src/A.tsx',
    ]);
  });

  /** The short name a project gives itself is the ordinary way to write an
   *  import in the frameworks a designer is handed. */
  it('follows the short names a project sets up for itself', () => {
    const usage = usageFrom(
      [
        { path: 'src/ui/Button.tsx', text: BUTTON },
        { path: 'src/Header.tsx', text: `import Button from '@/ui/Button';\nexport function Header() {\n  return <Button label="a" />;\n}\n` },
      ],
      { aliases: new Map([['@/*', ['src/*']]]) },
    );
    expect(places(usage, 'Button')).toEqual(['src/Header.tsx:1']);
  });

  it('follows a component that is only fetched once the screen needs it', () => {
    const usage = project({
      'src/Heavy.tsx': `export default function Heavy() {\n  return <div />;\n}\n`,
      'src/App.tsx': `import { lazy } from 'react';\nconst Heavy = lazy(() => import('./Heavy'));\nexport function App() {\n  return <Heavy />;\n}\n`,
    });
    expect(places(usage, 'Heavy')).toEqual(['src/App.tsx:1']);
  });
});

describe('telling a tag from something that only looks like one', () => {
  /** A typed project is full of pointed brackets, and none of them are uses. */
  it('does not count a type as a use', () => {
    const usage = project({
      'src/Item.tsx': `export function Item() {\n  return <li />;\n}\n`,
      'src/List.tsx': `import { Item } from './Item';\nimport { useState } from 'react';\nexport function List() {\n  const [items] = useState<Item[]>([]);\n  const seen = new Map<Item, string>();\n  const pick = (all: Array<Item>): Item => all[0];\n  return <div>{items.length}{seen.size}{String(pick)}</div>;\n}\n`,
    });
    expect(one(usage, 'Item').times).toBe(0);
  });

  /** The most ordinary line in React, and the one a naive rule loses. */
  it('counts a tag written straight after a word like return', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\nexport function Header() {\n  if (true) return <Button label="a" />;\n  return <Button label="b" />;\n}\n`,
    });
    expect(one(usage, 'Button').times).toBe(2);
  });

  it('does not count a tag that is only being talked about', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\n// Use <Button /> here one day.\n/* or <Button /> */\nconst says = 'write <Button /> for this';\nexport function Header() {\n  return <div>{says}</div>;\n}\n`,
    });
    expect(one(usage, 'Button').times).toBe(0);
  });

  /** An apostrophe in a sentence on screen is not the start of a string, and a
   *  reader that thinks it is loses every tag after it. */
  it('is not blinded by an apostrophe in the words on screen', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\nexport function Header() {\n  return (\n    <div>\n      <p>Here's what we don't do</p>\n      <Button label="a" />\n    </div>\n  );\n}\n`,
    });
    expect(one(usage, 'Button').times).toBe(1);
  });

  /** A pattern full of brackets is the other thing that looks like markup. */
  it('is not fooled by a pattern that has a tag written inside it', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\nconst tags = /<Button[\\s/>]/g;\nexport function Header() {\n  return <div>{String(tags)}</div>;\n}\n`,
    });
    expect(one(usage, 'Button').times).toBe(0);
  });
});

describe('saying what it cannot see', () => {
  /** Handed to something rather than written out: a real use, and one no
   *  reading of the files can count. */
  it('says there may be more when a component is handed around', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Table.tsx': `import Button from './Button';\nexport function Table() {\n  const columns = [{ cell: Button }];\n  return <div>{columns.length}</div>;\n}\n`,
    });
    const button = one(usage, 'Button');
    expect(button.times).toBe(0);
    expect(button.unsure[0]?.file).toBe('src/Table.tsx');
    expect(button.says).toContain('handed around');
    expect(usage.mayBeMore).toBe(true);
  });

  it('says there may be more when a tag is worked out while the project runs', () => {
    const usage = project({
      'src/Steps.tsx': `import { Small } from './Small';\nimport { Large } from './Large';\nexport function Steps({ big }: { big: boolean }) {\n  const Row = big ? Large : Small;\n  return <Row />;\n}\n`,
      'src/Small.tsx': `export function Small() {\n  return <li />;\n}\n`,
      'src/Large.tsx': `export function Large() {\n  return <li />;\n}\n`,
    });
    expect(usage.mayBeMore).toBe(true);
    expect(usage.unsure.some((doubt) => doubt.file === 'src/Steps.tsx')).toBe(true);
  });

  it('says there may be more when a file works out what to load as it goes', () => {
    const usage = project({
      'src/App.tsx': `export async function App({ name }: { name: string }) {\n  const made = await import(\`./screens/\${name}\`);\n  return <div>{String(made)}</div>;\n}\n`,
    });
    expect(usage.mayBeMore).toBe(true);
  });

  /** Nothing hidden means nothing hedged: a reading that always says "there
   *  may be more" is a reading nobody trusts. */
  it('hedges nothing when everything was in plain sight', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\nexport function Header() {\n  return <Button label="a" />;\n}\n`,
    });
    expect(usage.mayBeMore).toBe(false);
    expect(one(usage, 'Button').unsure).toEqual([]);
  });
});

describe('putting a use on a screen', () => {
  /** "Where is this used" is only half an answer; the other half is which
   *  screen somebody would have to look at to see it. */
  it('names the screens that reach the file a component is used in', () => {
    const usage = project({
      'src/components/Button.tsx': BUTTON,
      'src/components/Header.tsx': `import Button from './Button';\nexport function Header() {\n  return <Button label="a" />;\n}\n`,
      'src/app/page.tsx': `import { Header } from '../components/Header';\nexport default function Home() {\n  return <Header />;\n}\n`,
      'src/app/pricing/page.tsx': `import { Header } from '../../components/Header';\nexport default function Pricing() {\n  return <Header />;\n}\n`,
    });
    expect(one(usage, 'Button').screens.map((screen) => screen.route)).toEqual(['/', '/pricing']);
    expect(one(usage, 'Button').says).toBe('Once in one file, on 2 screens.');
  });

  it('leaves the screens empty rather than guessing at a project with no pages', () => {
    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Header.tsx': `import Button from './Button';\nexport function Header() {\n  return <Button label="a" />;\n}\n`,
    });
    expect(one(usage, 'Button').screens).toEqual([]);
  });

  /** A use in a test is a real use and still not news about a screen. */
  it('marks what kind of file each use is in', () => {
    expect(kindOf('src/components/Button.test.tsx')).toBe('test');
    expect(kindOf('src/components/Button.stories.tsx')).toBe('story');
    expect(kindOf('src/components/Button.tsx')).toBe('source');

    const usage = project({
      'src/Button.tsx': BUTTON,
      'src/Button.stories.tsx': `import Button from './Button';\nexport const Primary = () => <Button label="a" />;\n`,
    });
    expect(one(usage, 'Button').used[0]?.kind).toBe('story');
    // What a story file exports is a picture of a component, not another one.
    expect(named(usage, 'Primary')).toEqual([]);
  });
});

describe('a project that keeps one component to a file', () => {
  /** Svelte, Astro and Vue name the component after the file, and a designer
   *  is as likely to be handed one of those as a React project. */
  it('reads a component whose only name is its file', () => {
    const usage = usageFrom(
      [
        { path: 'src/lib/Button.svelte', text: `<script lang="ts">\n  export let label: string;\n</script>\n<button>{label}</button>\n` },
        {
          path: 'src/routes/+page.svelte',
          text: `<script>\n  import Button from '$lib/Button.svelte';\n</script>\n<!-- <Button /> once we style it -->\n<Button label="hi" />\n<Button label="ho" />\n`,
        },
      ],
      { aliases: new Map([['$lib/*', ['src/lib/*']]]) },
    );
    const button = one(usage, 'Button');
    expect(button.times).toBe(2);
    expect(button.screens.map((screen) => screen.route)).toEqual(['/']);
  });
});

describe('reading a folder off a disk', () => {
  const make = async (files: Record<string, string>): Promise<string> => {
    const folder = await mkdtemp(path.join(tmpdir(), 'graphe-usage-'));
    for (const [relative, text] of Object.entries(files)) {
      const full = path.join(folder, relative);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text, 'utf8');
    }
    return folder;
  };

  /** A project's own installed packages are a hundred times its own size, and
   *  reading them is the difference between an answer and a hang. */
  it('never opens what a person did not write', async () => {
    const folder = await make({
      'src/Button.tsx': BUTTON,
      'src/App.tsx': `import Button from './Button';\nexport function App() {\n  return <Button label="a" />;\n}\n`,
      'node_modules/kit/Button.tsx': BUTTON,
      'dist/Button.tsx': BUTTON,
      'dist-electron/main.mjs': BUTTON,
      'build/Button.tsx': BUTTON,
    });
    try {
      const usage = await readUsage(folder);
      expect(usage.read).toBe(2);
      expect(usage.components.map((component) => component.file)).toEqual(['src/Button.tsx', 'src/App.tsx']);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  /** A half-written file is the normal state of a project being worked on. */
  it('reads past a file that makes no sense rather than giving up', async () => {
    const folder = await make({
      'src/Broken.tsx': `export function Broken( { return <div className="`,
      'src/Button.tsx': BUTTON,
      'src/App.tsx': `import Button from './Button';\nexport function App() {\n  return <Button label="a" />;\n}\n`,
    });
    try {
      const usage = await readUsage(folder);
      expect(one(usage, 'Button').times).toBe(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('sets aside a file it will not read, with a reason, and reads the rest', async () => {
    const folder = await make({
      'src/Huge.tsx': `${BUTTON}\n// ${'x'.repeat(4000)}\n`,
      'src/Button.tsx': BUTTON,
      'src/App.tsx': `import Button from './Button';\nexport function App() {\n  return <Button label="a" />;\n}\n`,
    });
    try {
      const usage = await readUsage(folder, { biggest: 2000 });
      expect(usage.skipped.map((doubt) => doubt.file)).toEqual(['src/Huge.tsx']);
      expect(usage.skipped[0]?.says).toContain('too big');
      expect(usage.mayBeMore).toBe(true);
      expect(one(usage, 'Button').times).toBe(1);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('picks up the short names out of the project’s own config', async () => {
    const folder = await make({
      'tsconfig.json': `{\n  // a comment, as these files usually have\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } },\n}\n`,
      'src/ui/Button.tsx': BUTTON,
      'src/App.tsx': `import Button from '@/ui/Button';\nexport function App() {\n  return <Button label="a" />;\n}\n`,
    });
    try {
      const usage = await readUsage(folder);
      expect(places(usage, 'Button')).toEqual(['src/App.tsx:1']);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe('pointed at this project', () => {
  /** The one case that is not a fixture. A usage graph that cannot find where
   *  this app's own components are used is not finished, and the count is
   *  checked against what a plain search of the same files would say. */
  it('finds where this app uses its own components', async () => {
    const usage = await readUsage(path.join(__dirname, '..'));

    expect(usage.read).toBeGreaterThan(100);
    expect(usage.components.length).toBeGreaterThan(30);

    const line = one(usage, 'ActivityLine');
    expect(line.file).toBe('src/components/ActivityLine.tsx');
    expect(line.shared).toBe(true);
    expect(line.used.length).toBeGreaterThan(1);
    expect(line.times).toBe(
      line.used.reduce((sum, where) => {
        const text = readFileSync(path.join(__dirname, '..', where.file), 'utf8');
        return sum + (text.match(/<ActivityLine[\s/>]/g) ?? []).length;
      }, 0),
    );
    expect(line.used.map((where) => where.file)).toContain('src/components/Steps.tsx');

    // Nothing from inside the packages this app installs, and nothing built.
    expect(usage.components.some((component) => component.file.startsWith('node_modules'))).toBe(false);
    expect(usage.components.some((component) => component.file.startsWith('dist'))).toBe(false);
  });
});
