/** The page beside the conversation, carrying a click back to the shell.
 *
 * The pointer script reports a click three ways, and only one of them can work
 * here: the page in this view is usually somebody's own dev server, so the
 * request it would post goes to that server and never reaches us. The message
 * it puts on its own window does, and this carries it across.
 *
 * That is the whole of what this file does. Nothing is exposed to the page —
 * there is no `contextBridge` call below — so the page can say this one thing
 * and cannot ask for anything.
 *
 * What arrives here is a structured clone of an object built on somebody
 * else's page, so it is read field by field and rebuilt rather than passed on.
 */

import { ipcRenderer } from 'electron';
import { CHANNEL } from '../src/lib/ipc';
import type { Pointed, PointedSource, Trace } from '../src/preview/point';

/** A name for one element could not plausibly be longer. Matches the server's
 *  own ceiling, because it is the same script talking. */
const NAME_MAX = 2 * 1024;

/** The click as a whole. Past this it is not a description of an element. */
const WHOLE_MAX = 96 * 1024;

/** What somebody wrote about the element. The same ceiling the server keeps,
 *  because it is the same note arriving by a different road. */
const SAID_MAX = 600;

function words(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, said] of Object.entries(value as Record<string, unknown>)) {
    if (typeof said === 'string') out[key] = said;
  }
  return out;
}

function asRect(value: unknown): Pointed['rect'] | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;
  for (const side of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(from[side])) return null;
  }
  return {
    x: from['x'] as number,
    y: from['y'] as number,
    width: from['width'] as number,
    height: from['height'] as number,
  };
}

function asPlace(value: unknown): NonNullable<Pointed['place']> | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;
  if (!Number.isFinite(from['nth']) || !Number.isFinite(from['of'])) return null;
  const place: NonNullable<Pointed['place']> = {
    nth: from['nth'] as number,
    of: from['of'] as number,
  };
  if (typeof from['within'] === 'string') place.within = from['within'];
  return place;
}

function asSource(value: unknown): PointedSource | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const from = value as Record<string, unknown>;
  if (typeof from['html'] !== 'string') return null;
  const source: PointedSource = { html: from['html'], styles: words(from['styles']) };
  const vars = words(from['vars']);
  if (Object.keys(vars).length > 0) source.vars = vars;
  return source;
}

function asOrigin(value: unknown): Trace[] {
  if (!Array.isArray(value)) return [];
  const out: Trace[] = [];
  for (const one of value) {
    if (typeof one !== 'object' || one === null) continue;
    const from = one as Record<string, unknown>;
    const how = from['how'];
    const file = from['file'];
    const line = from['line'];
    const column = from['column'];
    const component = from['component'];

    if (how === 'stamp' && typeof file === 'string' && typeof line === 'number') {
      const rung: Extract<Trace, { how: 'stamp' }> = { how, file, line };
      if (typeof column === 'number') rung.column = column;
      if (typeof component === 'string') rung.component = component;
      out.push(rung);
      continue;
    }
    if (how === 'stack' && typeof file === 'string' && typeof line === 'number') {
      const rung: Extract<Trace, { how: 'stack' }> = { how, file, line };
      if (typeof column === 'number') rung.column = column;
      if (typeof from['mapped'] === 'boolean') rung.mapped = from['mapped'];
      out.push(rung);
      continue;
    }
    if (how === 'owner' && typeof component === 'string') out.push({ how, component });
    if (how === 'selector' && typeof from['selector'] === 'string') {
      out.push({ how, selector: from['selector'] });
    }
    if (how === 'markup' && typeof from['html'] === 'string') out.push({ how, html: from['html'] });
    if (how === 'text' && typeof from['text'] === 'string') out.push({ how, text: from['text'] });
  }
  return out;
}

function asView(value: unknown): Pointed['view'] | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;
  if (!Number.isFinite(from['width']) || !Number.isFinite(from['height'])) return null;
  return { width: from['width'] as number, height: from['height'] as number };
}

function asPointed(value: unknown): Pointed | null {
  if (typeof value !== 'object' || value === null) return null;
  const from = value as Record<string, unknown>;

  const selector = from['selector'];
  const label = from['label'];
  const kind = from['kind'];
  if (typeof selector !== 'string' || selector === '' || selector.length > NAME_MAX) return null;
  if (typeof label !== 'string' || label.length > NAME_MAX) return null;
  if (kind !== undefined && (typeof kind !== 'string' || kind.length > NAME_MAX)) return null;

  const rect = asRect(from['rect']);
  if (rect === null) return null;

  const pointed: Pointed = { selector, label, rect };
  if (typeof kind === 'string') pointed.kind = kind;

  const place = asPlace(from['place']);
  if (place !== null) pointed.place = place;
  const source = asSource(from['source']);
  if (source !== null) pointed.source = source;
  const origin = asOrigin(from['origin']);
  if (origin.length > 0) pointed.origin = origin;
  const view = asView(from['view']);
  if (view !== null) pointed.view = view;

  // The note itself. Rebuilding field by field is what keeps a page from
  // sending us anything it likes — and is why leaving this line out dropped
  // every note somebody wrote and left the click looking like it did nothing.
  const said = from['said'];
  if (typeof said === 'string' && said.trim() !== '' && said.length <= SAID_MAX) {
    pointed.said = said.trim();
  }

  return pointed;
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as { graphe?: unknown; pointed?: unknown } | null;
  if (data === null || typeof data !== 'object' || data.graphe !== 'pointed') return;

  const pointed = asPointed(data.pointed);
  if (pointed === null) return;
  // Measured after rebuilding, so a page cannot get past it with fields nothing
  // above kept.
  const body = JSON.stringify(pointed);
  if (body === undefined || body.length > WHOLE_MAX) return;
  ipcRenderer.send(CHANNEL.pagePointed, pointed);
});
