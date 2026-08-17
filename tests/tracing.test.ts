/** Getting from a rendered element back to the line somebody wrote.
 *
 * Every part of it here is the same source the injected script is built from,
 * so a page and a test cannot come to different answers. No browser is started.
 */

import { describe, expect, it } from 'vitest';

import {
  framesFrom,
  mapIn,
  originIn,
  ownerStack,
  plainPath,
  POINTED_BUDGET,
  POINTER_SCRIPT,
  stampIn,
  type SourceMap,
} from '../src/preview/point';

/** The shape React 19 hands over: a header, the JSX frame, the frames somebody
 *  wrote, then its own machinery under the sentinel. */
function reactStack(middle: readonly string[]): string {
  return [
    'Error: react-stack-top-frame',
    '    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react.js:1200:30)',
    ...middle,
    '    at react_stack_bottom_frame (http://localhost:5173/node_modules/.vite/deps/react-dom.js:9000:1)',
    '    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom.js:9100:1)',
  ].join('\n');
}

describe('the stack React captures at every JSX call', () => {
  it('keeps only the frames above its own sentinel', () => {
    const cut = ownerStack(
      reactStack([
        '    at Pricing (http://localhost:5173/src/Pricing.tsx:24:9)',
        '    at App (http://localhost:5173/src/App.tsx:8:5)',
      ]),
    );
    expect(cut).toContain('Pricing.tsx:24:9');
    expect(cut).toContain('App.tsx:8:5');
    expect(cut).not.toContain('react_stack_bottom_frame');
    expect(cut).not.toContain('jsxDEV');
  });

  it('bails rather than guessing when the sentinel is missing', () => {
    const untrusted = [
      'Error: react-stack-top-frame',
      '    at jsxDEV (http://x/react.js:1:1)',
      '    at Pricing (http://x/src/Pricing.tsx:24:9)',
    ].join('\n');
    expect(ownerStack(untrusted)).toBe('');
  });

  it('is empty rather than throwing on nothing at all', () => {
    expect(ownerStack('')).toBe('');
    expect(ownerStack('Error')).toBe('');
    expect(framesFrom('')).toEqual([]);
  });

  it('reads a frame in both shapes a browser writes one', () => {
    const frames = framesFrom(
      [
        '    at Pricing (http://localhost:5173/src/Pricing.tsx:24:9)',
        '    at http://localhost:5173/src/main.tsx:3:1',
        'Card@http://localhost:5173/src/Card.tsx:12:4',
      ].join('\n'),
    );
    expect(frames).toHaveLength(3);
    expect(frames[0]).toEqual({
      name: 'Pricing',
      file: 'http://localhost:5173/src/Pricing.tsx',
      line: 24,
      column: 9,
    });
    expect(frames[1]?.name).toBeNull();
    expect(frames[1]?.file).toBe('http://localhost:5173/src/main.tsx');
    expect(frames[2]?.name).toBe('Card');
  });

  it('does not mistake the port for a line number', () => {
    const frames = framesFrom('    at Card (http://localhost:5173/src/Card.tsx:12:4)');
    expect(frames[0]?.line).toBe(12);
    expect(frames[0]?.column).toBe(4);
  });
});

describe('a path an editor can open', () => {
  it('drops the scheme and host a source map leaves in', () => {
    expect(plainPath('http://localhost:5173/src/App.tsx')).toBe('src/App.tsx');
    expect(plainPath('webpack:///./src/App.tsx')).toBe('src/App.tsx');
    expect(plainPath('file:///Users/someone/app/src/App.tsx')).toBe(
      'Users/someone/app/src/App.tsx',
    );
  });

  it('drops the query a dev server puts on every reload', () => {
    expect(plainPath('http://localhost:5173/src/App.tsx?t=1712345')).toBe('src/App.tsx');
    expect(plainPath('/@fs/Users/someone/app/src/App.tsx')).toBe('Users/someone/app/src/App.tsx');
  });

  it('flattens the steps back up a tree', () => {
    expect(plainPath('src/pages/../components/Card.tsx')).toBe('src/components/Card.tsx');
    expect(plainPath('./src/App.tsx')).toBe('src/App.tsx');
  });
});

/* A real map: one file, three mapped positions on the second generated line. */
const MAP: SourceMap = {
  // line 1: nothing. line 2: (0 → 4:2), (10 → 4:12), (20 → 5:0)
  mappings: ';AAIE,UAAU,UACV',
  sources: ['http://localhost:5173/src/Pricing.tsx?t=99'],
};

describe('putting a generated position back where it was written', () => {
  it('reads a real map and normalises the file it names', () => {
    const found = originIn(MAP, 2, 1);
    expect(found?.file).toBe('src/Pricing.tsx');
    expect(found?.line).toBe(5);
    expect(found?.column).toBe(3);
  });

  it('takes the last mapping at or before the column', () => {
    expect(originIn(MAP, 2, 15)?.column).toBe(13);
    expect(originIn(MAP, 2, 21)?.line).toBe(6);
  });

  it('has nothing to say about a line the map does not cover', () => {
    expect(originIn(MAP, 9, 1)).toBeNull();
    expect(originIn({ mappings: '', sources: [] }, 1, 1)).toBeNull();
  });

  it('follows an indexed map into the section that owns the position', () => {
    const indexed = {
      mappings: '',
      sources: [],
      sections: [
        { offset: { line: 0, column: 0 }, map: { mappings: 'AAAA', sources: ['src/One.tsx'] } },
        { offset: { line: 4, column: 0 }, map: MAP },
      ],
    } as unknown as SourceMap;
    expect(originIn(indexed, 1, 1)?.file).toBe('src/One.tsx');
    expect(originIn(indexed, 6, 1)?.file).toBe('src/Pricing.tsx');
  });

  it('joins a source root on before normalising', () => {
    const rooted: SourceMap = { ...MAP, sourceRoot: 'http://localhost:5173/', sources: ['src/A.tsx'] };
    expect(originIn(rooted, 2, 1)?.file).toBe('src/A.tsx');
  });
});

describe('the map a module carries', () => {
  it('reads one inlined as base64, the way a dev server writes it', () => {
    const json = JSON.stringify({ mappings: 'AAAA', sources: ['src/A.tsx'] });
    const encoded = Buffer.from(json, 'utf8').toString('base64');
    const found = mapIn(
      `const a = 1;\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`,
    );
    expect(found.map?.sources).toEqual(['src/A.tsx']);
    expect(found.url).toBeNull();
  });

  it('hands back the address of one written beside the file', () => {
    const found = mapIn('const a = 1;\n//# sourceMappingURL=main.js.map\n');
    expect(found.map).toBeNull();
    expect(found.url).toBe('main.js.map');
  });

  it('finds nothing in a module that carries nothing', () => {
    expect(mapIn('const a = 1;')).toEqual({ map: null, url: null });
    expect(mapIn('//# sourceMappingURL=data:application/json;base64,not-base64!!').map).toBeNull();
  });
});

describe('what a build tool stamped on the element', () => {
  it('reads our own stamp, file line and column in one attribute', () => {
    expect(stampIn({ 'data-graphe-source': 'src/Pricing.tsx:24:9', 'data-graphe-name': 'Pricing' })).toEqual(
      { how: 'stamp', file: 'src/Pricing.tsx', line: 24, column: 9, component: 'Pricing' },
    );
  });

  it('reads the shape one common plugin writes, spread over three attributes', () => {
    expect(
      stampIn({
        'data-inspector-relative-path': 'src/Card.tsx',
        'data-inspector-line': '12',
        'data-inspector-column': '4',
        'data-inspector-name': 'div',
      }),
    ).toEqual({ how: 'stamp', file: 'src/Card.tsx', line: 12, column: 4, component: 'div' });
  });

  it('reads the shape the other one writes', () => {
    expect(stampIn({ 'data-lov-id': 'src/App.tsx:8:5', 'data-lov-name': 'Button' })).toEqual({
      how: 'stamp',
      file: 'src/App.tsx',
      line: 8,
      column: 5,
      component: 'Button',
    });
  });

  it('falls to naming the component when the stamp has no line in it', () => {
    expect(stampIn({ 'data-component-name': 'Button' })).toEqual({
      how: 'owner',
      component: 'Button',
    });
  });

  it('says nothing about an element nothing stamped', () => {
    expect(stampIn({})).toBeNull();
    expect(stampIn({ class: 'card', id: 'x' })).toBeNull();
  });
});

describe('the script that runs on their page', () => {
  it('parses, and carries the tracing with it', () => {
    expect(() => new Function(POINTER_SCRIPT)).not.toThrow();
    expect(POINTER_SCRIPT).toContain('__reactFiber');
    expect(POINTER_SCRIPT).toContain('_debugStack');
    expect(POINTER_SCRIPT).toContain('react_stack_bottom_frame');
  });

  it('is still inert until something switches it on', () => {
    expect(POINTER_SCRIPT).toContain('window.__graphePointer');
    expect(POINTER_SCRIPT.indexOf('var live = false;')).toBeGreaterThan(-1);
  });

  it('sheds what it must to fit the body the server will take', () => {
    expect(POINTED_BUDGET).toBeLessThan(8 * 1024);
    expect(POINTER_SCRIPT).toContain('function fitted(');
    // The whole reading still goes out the way that has no limit.
    expect(POINTER_SCRIPT).toContain('window.postMessage(note');
  });

  /* The page gets this as source rather than as an import, so anything it
     reached for outside itself would only fail once somebody clicked. */
  it('carries everything its tracing needs, with nothing from outside', () => {
    const body = /var T = \((function tracing[\s\S]*?)\)\(\);\n/.exec(POINTER_SCRIPT);
    expect(body).not.toBeNull();

    const made = eval(`(${body?.[1] ?? ''})()`) as Record<string, (...args: never[]) => unknown>;
    expect(made['plainPath']?.('http://localhost:5173/src/a.tsx?t=1' as never)).toBe('src/a.tsx');
    expect(made['stampIn']?.({ 'data-lov-id': 'src/A.tsx:3:2' } as never)).toEqual({
      how: 'stamp',
      file: 'src/A.tsx',
      line: 3,
      column: 2,
    });
    expect(
      made['ownerStack']?.(reactStack(['    at Buy (http://localhost:5173/src/Buy.tsx:9:3)']) as never),
    ).toContain('at Buy (http://localhost:5173/src/Buy.tsx:9:3)');
  });

  it('lets go of the cursor before it goes looking for the source map', () => {
    // Order, not adjacency: what matters is that the crosshair and the click
    // handlers are released before a lookup that can take a moment, not that
    // nothing else happens in between. Saying "added to your message" does.
    const clicked = POINTER_SCRIPT.indexOf('function clicked(');
    const stopped = POINTER_SCRIPT.indexOf('stop();', clicked);
    const looking = POINTER_SCRIPT.indexOf('originOf(el, pointed)', clicked);
    expect(clicked).toBeGreaterThan(-1);
    expect(stopped).toBeGreaterThan(-1);
    expect(looking).toBeGreaterThan(stopped);
  });
});
