/** A list of files in, the screens a designer would name out. Pure — no folder
 *  is read anywhere in here. */

import { describe, expect, it } from 'vitest';
import { pagesIn } from '../src/preview/pages';

const routes = (files: readonly string[]) => pagesIn(files).map((one) => one.route);

describe('finding the screens in a project', () => {
  it('reads Next’s app router, folders and all', () => {
    expect(
      routes([
        'src/app/page.tsx',
        'src/app/about/page.tsx',
        'src/app/work/[slug]/page.tsx',
        'src/app/layout.tsx',
      ]),
    ).toEqual(['/', '/about', '/work/[slug]']);
  });

  it('drops the grouping folders that never appear in an address', () => {
    expect(routes(['app/(marketing)/pricing/page.tsx'])).toEqual(['/pricing']);
  });

  it('reads Next’s pages router, and skips its framework files', () => {
    expect(
      routes(['pages/index.tsx', 'pages/about.tsx', 'pages/_app.tsx', 'pages/404.tsx']),
    ).toEqual(['/', '/about']);
  });

  it('reads SvelteKit', () => {
    expect(routes(['src/routes/+page.svelte', 'src/routes/studio/+page.svelte'])).toEqual([
      '/',
      '/studio',
    ]);
  });

  it('reads Astro', () => {
    expect(routes(['src/pages/index.astro', 'src/pages/journal.astro'])).toEqual([
      '/',
      '/journal',
    ]);
  });

  it('reads a folder of plain HTML, serving index at the folder itself', () => {
    expect(routes(['index.html', 'about.html', 'work/index.html'])).toEqual([
      '/',
      '/about.html',
      '/work',
    ]);
  });

  it('ignores everything that is not a screen', () => {
    expect(
      routes([
        'node_modules/next/app/page.tsx',
        'dist/index.html',
        '.next/server/pages/index.js',
        'src/components/Hero.tsx',
        'README.md',
        'src/styles/tokens.css',
      ]),
    ).toEqual([]);
  });

  it('keeps one page per address', () => {
    expect(routes(['src/pages/index.astro', 'index.html'])).toEqual(['/']);
  });

  it('puts home first and the rest in order', () => {
    expect(routes(['app/zebra/page.tsx', 'app/about/page.tsx', 'app/page.tsx'])).toEqual([
      '/',
      '/about',
      '/zebra',
    ]);
  });

  it('names a screen the way somebody would say it', () => {
    const named = pagesIn([
      'app/page.tsx',
      'app/case-studies/page.tsx',
      'app/work/[slug]/page.tsx',
    ]);
    expect(named.map((one) => one.name)).toEqual(['Home', 'Case studies', 'Work']);
  });
});
