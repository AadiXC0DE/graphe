/** Reading a Figma file, without ever reaching Figma.
 *
 *  Two things are being checked. That every shape of address a designer can
 *  copy out of Figma lands on the same file key, and that nothing a half-written
 *  variables payload can do makes the reader throw. The client is only ever
 *  handed a fake fetch: nothing in this file touches the network. */

import { describe, expect, it } from 'vitest';
import {
  createReader,
  describeForModel,
  parseFigmaUrl,
  toTokens,
  type Frame,
  type TokenSet,
} from '../src/design/figma';

/* ========================================================================== */
/* Addresses                                                                   */
/* ========================================================================== */

describe('the address of a Figma file', () => {
  it('reads the older /file/ address', () => {
    expect(parseFigmaUrl('https://www.figma.com/file/8Kx2ABcd/Landing-v4')).toEqual({
      fileKey: '8Kx2ABcd',
      nodeId: null,
    });
  });

  it('reads the /design/ address Figma hands out now', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/8Kx2ABcd/Landing-v4')).toEqual({
      fileKey: '8Kx2ABcd',
      nodeId: null,
    });
  });

  it('reads a prototype address', () => {
    expect(parseFigmaUrl('https://www.figma.com/proto/8Kx2ABcd/Landing-v4?page-id=0%3A1')).toEqual({
      fileKey: '8Kx2ABcd',
      nodeId: null,
    });
  });

  it('reads boards, slides and community files', () => {
    for (const address of [
      'https://www.figma.com/board/KEY123/Workshop',
      'https://www.figma.com/slides/KEY123/Deck',
      'https://www.figma.com/community/file/KEY123/A-kit',
    ]) {
      expect(parseFigmaUrl(address)?.fileKey).toBe('KEY123');
    }
  });

  it('works without the www, and without a name on the end', () => {
    expect(parseFigmaUrl('https://figma.com/design/8Kx2ABcd')).toEqual({
      fileKey: '8Kx2ABcd',
      nodeId: null,
    });
  });

  it('survives a trailing slash', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/8Kx2ABcd/Landing-v4/')).toEqual({
      fileKey: '8Kx2ABcd',
      nodeId: null,
    });
  });

  it('takes an address pasted without its https://', () => {
    expect(parseFigmaUrl('figma.com/design/8Kx2ABcd/Landing')?.fileKey).toBe('8Kx2ABcd');
  });

  it('trims the whitespace that comes with a paste', () => {
    expect(parseFigmaUrl('  https://www.figma.com/design/8Kx2ABcd/Landing  ')?.fileKey).toBe(
      '8Kx2ABcd',
    );
  });
});

describe('the frame inside the address', () => {
  it('turns a hyphenated node id back into the one the API answers to', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/KEY/Name?node-id=1-23')).toEqual({
      fileKey: 'KEY',
      nodeId: '1:23',
    });
  });

  it('reads an escaped node id', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/KEY/Name?node-id=1%3A23')?.nodeId).toBe(
      '1:23',
    );
  });

  it('leaves an already-colonised node id alone', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/KEY/Name?node-id=1:23')?.nodeId).toBe('1:23');
  });

  it('finds the node id among other query parameters, wherever it sits', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/KEY/Name?t=abc123-4&node-id=104-2891&mode=design')
        ?.nodeId,
    ).toBe('104:2891');
    expect(
      parseFigmaUrl('https://www.figma.com/design/KEY/Name?node-id=0-1&t=xyz&scaling=min-zoom')
        ?.nodeId,
    ).toBe('0:1');
  });

  it('reads the id of a layer inside an instance', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/KEY/Name?node-id=I1-23%3B4-56')?.nodeId).toBe(
      'I1:23;4:56',
    );
  });

  it('says there is no frame rather than inventing one', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/KEY/Name?node-id=')?.nodeId).toBe(null);
    expect(parseFigmaUrl('https://www.figma.com/design/KEY/Name?node-id=hero')?.nodeId).toBe(null);
    expect(parseFigmaUrl('https://www.figma.com/design/KEY/Name')?.nodeId).toBe(null);
  });
});

describe('what is not a Figma file', () => {
  it('turns away another site, however Figma-shaped its path', () => {
    expect(parseFigmaUrl('https://notfigma.com/design/KEY/Name')).toBe(null);
    expect(parseFigmaUrl('https://figma.com.example.org/design/KEY/Name')).toBe(null);
    expect(parseFigmaUrl('https://example.com/figma.com/design/KEY')).toBe(null);
  });

  it('turns away a Figma page that is not a file', () => {
    expect(parseFigmaUrl('https://www.figma.com/')).toBe(null);
    expect(parseFigmaUrl('https://www.figma.com/files/recent')).toBe(null);
    expect(parseFigmaUrl('https://www.figma.com/design/')).toBe(null);
  });

  it('turns away something that is not an address at all', () => {
    expect(parseFigmaUrl('')).toBe(null);
    expect(parseFigmaUrl('   ')).toBe(null);
    expect(parseFigmaUrl('the landing page, second frame')).toBe(null);
  });
});

/* ========================================================================== */
/* Variables                                                                   */
/* ========================================================================== */

const MODE = '1:0';

/** The shape Figma really answers with: a wrapper, a map keyed by id, values
 *  kept per mode, and a collection holding the default mode. */
const published = {
  status: 200,
  error: false,
  meta: {
    variableCollections: {
      'VariableCollectionId:1:1': {
        id: 'VariableCollectionId:1:1',
        name: 'Primitives',
        defaultModeId: MODE,
        modes: [{ modeId: MODE, name: 'Light' }],
      },
    },
    variables: {
      'VariableID:2:1': {
        id: 'VariableID:2:1',
        name: 'color/brand/Primary 500',
        key: 'aaa',
        variableCollectionId: 'VariableCollectionId:1:1',
        resolvedType: 'COLOR',
        valuesByMode: { [MODE]: { r: 0.1215686274509804, g: 0.4352941176470588, b: 0.9215686274509803, a: 1 } },
      },
      'VariableID:2:2': {
        id: 'VariableID:2:2',
        name: 'color/overlay/scrim',
        variableCollectionId: 'VariableCollectionId:1:1',
        resolvedType: 'COLOR',
        valuesByMode: { [MODE]: { r: 0, g: 0, b: 0, a: 0.5 } },
      },
      'VariableID:2:3': {
        id: 'VariableID:2:3',
        name: 'space/xLarge',
        variableCollectionId: 'VariableCollectionId:1:1',
        resolvedType: 'FLOAT',
        valuesByMode: { [MODE]: 32 },
      },
      'VariableID:2:4': {
        id: 'VariableID:2:4',
        name: 'font/size/body',
        variableCollectionId: 'VariableCollectionId:1:1',
        resolvedType: 'FLOAT',
        valuesByMode: { [MODE]: 16.5 },
      },
      'VariableID:2:5': {
        id: 'VariableID:2:5',
        name: 'font/family/heading',
        variableCollectionId: 'VariableCollectionId:1:1',
        resolvedType: 'STRING',
        valuesByMode: { [MODE]: 'Söhne' },
      },
      'VariableID:2:6': {
        id: 'VariableID:2:6',
        name: 'toggle/rounded',
        variableCollectionId: 'VariableCollectionId:1:1',
        resolvedType: 'BOOLEAN',
        valuesByMode: { [MODE]: true },
      },
      'VariableID:2:7': {
        id: 'VariableID:2:7',
        name: 'color/button/background',
        variableCollectionId: 'VariableCollectionId:1:1',
        resolvedType: 'COLOR',
        valuesByMode: { [MODE]: { type: 'VARIABLE_ALIAS', id: 'VariableID:2:1' } },
      },
    },
  },
};

describe('published variables become values', () => {
  const tokens = toTokens(published);

  it('reads colours as hex', () => {
    expect(tokens.colors['color-brand-primary-500']).toBe('#1f6feb');
  });

  it('keeps alpha only when it changes something', () => {
    expect(tokens.colors['color-overlay-scrim']).toBe('#00000080');
    expect(tokens.colors['color-brand-primary-500']).not.toMatch(/^#.{8}$/);
  });

  it('follows an alias to the colour it points at', () => {
    expect(tokens.colors['color-button-background']).toBe('#1f6feb');
  });

  it('names things the way Figma named them, kebab-cased', () => {
    expect(tokens.spacing['space-x-large']).toBe('32px');
  });

  it('puts a measurement about type with the type, not the spacing', () => {
    expect(tokens.text['font-size-body']).toBe('16.5px');
    expect(tokens.spacing['font-size-body']).toBeUndefined();
  });

  it('carries a plain string through', () => {
    expect(tokens.text['font-family-heading']).toBe('Söhne');
  });

  it('leaves out what a stylesheet cannot use', () => {
    expect(tokens.spacing['toggle-rounded']).toBeUndefined();
    expect(tokens.text['toggle-rounded']).toBeUndefined();
    expect(tokens.colors['toggle-rounded']).toBeUndefined();
  });
});

describe('colours, exactly', () => {
  const hexOf = (value: unknown): string | undefined =>
    toTokens({ meta: { variables: { a: { name: 'c', resolvedType: 'COLOR', value } } } }).colors['c'];

  it('turns the corners of the range into the hex people expect', () => {
    expect(hexOf({ r: 0, g: 0, b: 0, a: 1 })).toBe('#000000');
    expect(hexOf({ r: 1, g: 1, b: 1, a: 1 })).toBe('#ffffff');
    expect(hexOf({ r: 1, g: 0, b: 0, a: 1 })).toBe('#ff0000');
  });

  it('treats a missing alpha as fully opaque', () => {
    expect(hexOf({ r: 1, g: 1, b: 1 })).toBe('#ffffff');
  });

  it('writes alpha out when it is less than one', () => {
    expect(hexOf({ r: 1, g: 1, b: 1, a: 0 })).toBe('#ffffff00');
    expect(hexOf({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
    expect(hexOf({ r: 0, g: 0, b: 0, a: 0.25 })).toBe('#00000040');
  });

  it('holds channels inside the range rather than trusting them', () => {
    expect(hexOf({ r: 2, g: -1, b: 0.5, a: 4 })).toBe('#ff0080');
  });

  it('skips a colour it cannot read at all', () => {
    expect(hexOf({ r: 'red', g: 0, b: 0 })).toBeUndefined();
    expect(hexOf(null)).toBeUndefined();
  });
});

describe('a variables payload with holes in it', () => {
  const empty: TokenSet = { colors: {}, spacing: {}, text: {} };

  it('answers with nothing rather than throwing', () => {
    expect(toTokens(undefined)).toEqual(empty);
    expect(toTokens(null)).toEqual(empty);
    expect(toTokens('not json')).toEqual(empty);
    expect(toTokens(42)).toEqual(empty);
    expect(toTokens([])).toEqual(empty);
    expect(toTokens({})).toEqual(empty);
    expect(toTokens({ meta: {} })).toEqual(empty);
    expect(toTokens({ meta: { variables: null } })).toEqual(empty);
    expect(toTokens({ meta: { variables: 'nope' } })).toEqual(empty);
  });

  it('keeps the readable variables and drops the rest', () => {
    const tokens = toTokens({
      meta: {
        variables: {
          a: null,
          b: { name: 'good/one', resolvedType: 'FLOAT', valuesByMode: { m: 8 } },
          c: { resolvedType: 'COLOR', valuesByMode: { m: { r: 1, g: 0, b: 0 } } },
          d: { name: '', resolvedType: 'FLOAT', valuesByMode: { m: 4 } },
          e: { name: '///', resolvedType: 'FLOAT', valuesByMode: { m: 4 } },
          f: { name: 'no/value', resolvedType: 'FLOAT' },
          g: { name: 'empty/modes', resolvedType: 'FLOAT', valuesByMode: {} },
          h: { name: 'not/finite', resolvedType: 'FLOAT', valuesByMode: { m: Number.NaN } },
        },
      },
    });
    expect(tokens.spacing).toEqual({ 'good-one': '8px' });
    expect(tokens.colors).toEqual({});
    expect(tokens.text).toEqual({});
  });

  it('reads a payload with no wrapper around it', () => {
    expect(
      toTokens({ variables: { a: { name: 'gap', resolvedType: 'FLOAT', valuesByMode: { m: 12 } } } })
        .spacing,
    ).toEqual({ gap: '12px' });
  });

  it('reads variables handed over as a list', () => {
    expect(
      toTokens({ meta: { variables: [{ name: 'gap', resolvedDataType: 'FLOAT', value: 12 }] } })
        .spacing,
    ).toEqual({ gap: '12px' });
  });

  it('works out the kind from the value when nothing declares it', () => {
    const tokens = toTokens({
      meta: {
        variables: {
          a: { name: 'brand', valuesByMode: { m: { r: 1, g: 0, b: 0, a: 1 } } },
          b: { name: 'gap', valuesByMode: { m: 4 } },
          c: { name: 'font/family', valuesByMode: { m: 'Inter' } },
        },
      },
    });
    expect(tokens.colors['brand']).toBe('#ff0000');
    expect(tokens.spacing['gap']).toBe('4px');
    expect(tokens.text['font-family']).toBe('Inter');
  });

  it('prefers the collection default mode over whichever mode comes first', () => {
    const tokens = toTokens({
      meta: {
        variableCollections: { col: { id: 'col', defaultModeId: 'dark' } },
        variables: {
          a: {
            name: 'bg',
            variableCollectionId: 'col',
            resolvedType: 'COLOR',
            valuesByMode: {
              light: { r: 1, g: 1, b: 1, a: 1 },
              dark: { r: 0, g: 0, b: 0, a: 1 },
            },
          },
        },
      },
    });
    expect(tokens.colors['bg']).toBe('#000000');
  });

  it('gives up on an alias that goes round in circles', () => {
    const tokens = toTokens({
      meta: {
        variables: {
          a: { id: 'a', name: 'one', resolvedType: 'COLOR', valuesByMode: { m: { type: 'VARIABLE_ALIAS', id: 'b' } } },
          b: { id: 'b', name: 'two', resolvedType: 'COLOR', valuesByMode: { m: { type: 'VARIABLE_ALIAS', id: 'a' } } },
        },
      },
    });
    expect(tokens.colors).toEqual({});
  });

  it('ignores an alias pointing at a variable that is not there', () => {
    expect(
      toTokens({
        meta: {
          variables: {
            a: { id: 'a', name: 'one', resolvedType: 'COLOR', valuesByMode: { m: { type: 'VARIABLE_ALIAS', id: 'gone' } } },
          },
        },
      }).colors,
    ).toEqual({});
  });
});

/* ========================================================================== */
/* What the model is told                                                      */
/* ========================================================================== */

describe('the summary handed to the model', () => {
  const frames: Frame[] = [
    { id: '1:23', name: 'Landing hero', image: 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/a.png' },
  ];

  it('names each frame, its id and where its picture is', () => {
    const text = describeForModel(frames, toTokens(published));
    expect(text).toContain('Landing hero');
    expect(text).toContain('1:23');
    expect(text).toContain('https://figma-alpha-api.s3.us-west-2.amazonaws.com/a.png');
  });

  it('lists the values under headings, with a count', () => {
    const text = describeForModel(frames, toTokens(published));
    expect(text).toContain('color-brand-primary-500: #1f6feb');
    expect(text).toContain('space-x-large: 32px');
    expect(text).toContain('font-family-heading: Söhne');
    expect(text).toMatch(/Colours \(3\)/);
  });

  it('says so plainly when there was nothing to read', () => {
    const text = describeForModel([], { colors: {}, spacing: {}, text: {} });
    expect(text).toContain('No frames');
    expect(text).toContain('no variables');
  });

  it('stops listing long before a design system fills the context', () => {
    const colors: Record<string, string> = {};
    for (let index = 0; index < 60; index++) colors[`grey-${String(index)}`] = '#111111';
    const text = describeForModel([], { colors, spacing: {}, text: {} });
    expect(text).toContain('Colours (60)');
    expect(text).toContain('and 20 more');
    expect(text).not.toContain('grey-59');
  });
});

/* ========================================================================== */
/* The client, with a fake fetch                                               */
/* ========================================================================== */

type Call = { url: string; headers: Record<string, string> };

/** A stand-in for the network: answers from a table of addresses, and records
 *  what it was asked for. */
function fakeFetch(
  answers: Record<string, { status?: number; body?: unknown; throws?: boolean }>,
): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });

    const key = Object.keys(answers).find((path) => url.includes(path));
    const answer = key === undefined ? { status: 404 } : answers[key];
    if (answer?.throws === true) return Promise.reject(new TypeError('fetch failed'));

    const status = answer?.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () =>
        answer !== undefined && 'body' in answer
          ? Promise.resolve(answer.body)
          : Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    } as unknown as Response);
  }) as typeof globalThis.fetch;

  return { fetch, calls };
}

const IMAGE = 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/one.png';

describe('reading frames', () => {
  it('asks Figma with the connected account and brings back the pictures', async () => {
    const { fetch, calls } = fakeFetch({
      '/images/': { body: { err: null, images: { '1:23': IMAGE } } },
      '/nodes': { body: { nodes: { '1:23': { document: { id: '1:23', name: 'Landing hero' } } } } },
    });
    const frames = await createReader({ token: 'figd_secret', fetch }).frames('KEY', ['1:23']);

    expect(frames).toEqual([{ id: '1:23', name: 'Landing hero', image: IMAGE }]);
    expect(calls[0]?.headers['X-Figma-Token']).toBe('figd_secret');
    expect(calls[0]?.url).toContain('/v1/images/KEY');
    expect(calls[0]?.url).toContain('ids=1%3A23');
  });

  it('falls back to the frame id when the names cannot be had', async () => {
    const { fetch } = fakeFetch({
      '/images/': { body: { err: null, images: { '1:23': IMAGE } } },
      '/nodes': { status: 403 },
    });
    const frames = await createReader({ token: 't', fetch }).frames('KEY', ['1:23']);
    expect(frames).toEqual([{ id: '1:23', name: '1:23', image: IMAGE }]);
  });

  it('leaves out a frame Figma would not draw', async () => {
    const { fetch } = fakeFetch({
      '/images/': { body: { err: null, images: { '1:23': IMAGE, '4:56': null } } },
      '/nodes': { body: { nodes: {} } },
    });
    const frames = await createReader({ token: 't', fetch }).frames('KEY', ['1:23', '4:56']);
    expect(frames.map((frame) => frame.id)).toEqual(['1:23']);
  });

  it('asks for nothing when there are no frames to ask about', async () => {
    const { fetch, calls } = fakeFetch({});
    const reader = createReader({ token: 't', fetch });
    expect(await reader.frames('KEY', [])).toEqual([]);
    expect(await reader.frames('', ['1:23'])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('says so plainly when Figma could not draw them', async () => {
    const { fetch } = fakeFetch({ '/images/': { body: { err: 'Something went wrong', images: null } } });
    await expect(createReader({ token: 't', fetch }).frames('KEY', ['1:23'])).rejects.toThrow(
      'Figma could not turn those frames into pictures.',
    );
  });
});

describe('reading the variables', () => {
  it('asks the published variables of the file and flattens them', async () => {
    const { fetch, calls } = fakeFetch({ '/variables/published': { body: published } });
    const tokens = await createReader({ token: 't', fetch }).tokens('KEY');

    expect(tokens.colors['color-brand-primary-500']).toBe('#1f6feb');
    expect(calls[0]?.url).toBe('https://api.figma.com/v1/files/KEY/variables/published');
  });

  it('asks nothing when there is no file to ask about', async () => {
    const { fetch, calls } = fakeFetch({});
    expect(await createReader({ token: 't', fetch }).tokens('  ')).toEqual({
      colors: {},
      spacing: {},
      text: {},
    });
    expect(calls).toHaveLength(0);
  });
});

describe('when it goes wrong, a sentence rather than a number', () => {
  const shouldSay = async (
    answer: { status?: number; body?: unknown; throws?: boolean },
    sentence: string,
  ): Promise<void> => {
    const { fetch } = fakeFetch({ '/variables/published': answer });
    const reader = createReader({ token: 't', fetch });
    await expect(reader.tokens('KEY')).rejects.toThrow(sentence);
  };

  it('says the file is not shared when Figma refuses it', async () => {
    await shouldSay({ status: 403 }, 'That file is not shared with the account you connected.');
  });

  it('says the file could not be found', async () => {
    await shouldSay({ status: 404 }, 'I could not find that file in Figma.');
  });

  it('says the account needs connecting again', async () => {
    await shouldSay({ status: 401 }, 'not signed in any more');
  });

  it('says Figma is busy rather than naming a server fault', async () => {
    await shouldSay({ status: 500 }, 'Figma is having trouble at the moment.');
    await shouldSay({ status: 429 }, 'asking me to slow down');
  });

  it('says it could not reach Figma when the connection fails', async () => {
    await shouldSay({ throws: true }, 'I could not reach Figma.');
  });

  it('says it could not make sense of the answer when the body is not readable', async () => {
    await shouldSay({ status: 200 }, 'Figma answered with something I could not make sense of.');
  });

  it('never puts a status code or a raw fault in front of anybody', async () => {
    for (const answer of [
      { status: 403 },
      { status: 404 },
      { status: 401 },
      { status: 418 },
      { status: 500 },
      { throws: true },
    ]) {
      const { fetch } = fakeFetch({ '/variables/published': answer });
      const failure = await createReader({ token: 't', fetch })
        .tokens('KEY')
        .then(() => null)
        .catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));

      expect(failure).not.toBe(null);
      expect(failure ?? '').not.toMatch(/\d{3}|fetch failed|TypeError|status/i);
      expect(failure ?? '').toMatch(/\.$/);
    }
  });

  it('says there is no account connected before it tries anything', async () => {
    const { fetch, calls } = fakeFetch({});
    await expect(createReader({ token: '   ', fetch }).tokens('KEY')).rejects.toThrow(
      'No Figma account is connected yet',
    );
    expect(calls).toHaveLength(0);
  });
});
