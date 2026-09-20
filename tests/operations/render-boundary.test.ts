// @vitest-environment jsdom
/** What a reply can and cannot become on the screen.
 *
 * 9.5 asks that the existing sanitization boundary holds for raw HTML, script
 * tags and dangerous URLs. `tests/markdown.test.ts` proves the lexing and the
 * two URL allowlists; what it cannot see is the last step — the element the
 * renderer actually produces. That is what this file checks, in a real DOM:
 * a `<script>` in a reply is six characters and a word, an `onerror` is text,
 * and a link the app will not follow has no address to follow.
 *
 * jsdom, react-dom and no network. The boundary is structural: the component
 * builds every element by hand, so there is no HTML string anywhere to run.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Markdown from '../../src/components/Markdown';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function drawn(text: string): HTMLDivElement {
  if (host === null) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  act(() => {
    root?.render(createElement(Markdown, { text }));
  });
  return host;
}

const HOSTILE = [
  '<script>window.__owned = true;</script>',
  '<img src=x onerror="window.__owned = true">',
  '<svg onload="window.__owned = true"></svg>',
  '<iframe src="https://example.test/"></iframe>',
  '<object data="https://example.test/"></object>',
  '<a href="javascript:window.__owned=true">click</a>',
];

/* ========================================================================== */

describe('raw HTML in a reply', () => {
  it('is shown as the characters it is made of', () => {
    for (const payload of HOSTILE) {
      const at = drawn(`before\n\n${payload}\n\nafter`);
      // The words survive — somebody who typed a script meant to show one.
      expect(at.textContent, payload).toContain('before');
      expect(at.textContent, payload).toContain('after');
    }
  });

  it('never becomes an element that runs', () => {
    for (const payload of HOSTILE) {
      const at = drawn(payload);
      for (const tag of ['script', 'img', 'svg', 'iframe', 'object', 'embed']) {
        expect(at.querySelector(tag), `${tag} from ${payload}`).toBeNull();
      }
    }
  });

  it('carries no on* handler anywhere, whatever the payload', () => {
    const at = drawn(HOSTILE.join('\n\n'));
    for (const element of at.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name.startsWith('on'), attribute.name).toBe(false);
      }
    }
  });
});

describe('a link a reply asks the app to follow', () => {
  it('is not clickable when its address is not one', () => {
    for (const href of [
      'javascript:window.__owned=true',
      'JavaScript:alert(1)',
      'java&#115;cript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.test/x',
    ]) {
      const at = drawn(`[click me](${href})`);
      expect(at.querySelector('a'), href).toBeNull();
      // The sentence stays; only the address goes.
      expect(at.textContent, href).toContain('click me');
    }
  });

  it('is clickable when it is one, and never opens inside this window', () => {
    const at = drawn('[the docs](https://example.test/docs)');
    const link = at.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.test/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
  });

  it('does not turn an image address into a request the app makes', () => {
    for (const src of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///etc/passwd']) {
      const at = drawn(`![a picture](${src})`);
      expect(at.querySelector('img'), src).toBeNull();
      expect(at.textContent, src).toContain('a picture');
    }
  });
});
