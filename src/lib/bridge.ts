/** The window's end of the bridge.
 *
 * Every call the interface makes to the desktop shell goes through here, and
 * nothing in `src/components` or `src/App.tsx` ever touches `window.graphe`
 * directly. Two reasons, and the second is the one that matters day to day:
 *
 *  1. `window.graphe` is absent whenever the app is opened in an ordinary
 *     browser tab — `npm run dev`, the screenshot harness, a designer poking at
 *     the CSS. The interface must not know or care. A missing bridge is not an
 *     error state to render; it is a Tuesday.
 *
 *  2. Nothing in this file mentions Pi, sessions, IPC or channels. The renderer
 *     is not allowed to know Pi exists (notes/strategy/ARCHITECTURE.md), and the
 *     easiest way to keep a rule like that is to make the alternative
 *     unavailable rather than discouraged.
 *
 * The browser fallback below answers honestly rather than pretending. It says
 * what it is, and it says it in a real streamed reply so the conversation view
 * is a real conversation view when it is screenshotted, instead of a mock that
 * drifts away from the thing it is standing in for.
 */

import type { AgentEvent } from '../agent/types';
import { Ledger } from '../cost/ledger';
import { money } from '../cost/money';
import type { Decision, GrapheApi, OpenedProject, Result } from './ipc';

declare global {
  interface Window {
    graphe?: GrapheApi;
  }
}

export type Bridge = GrapheApi & {
  /** True when the desktop shell is underneath. False in a browser tab, where
   *  nothing can actually be built and the interface should not offer to. */
  readonly desktop: boolean;
};

function done<T>(value: T): Result<T> {
  return { ok: true, value };
}

/* -------------------------------------------------------------------------- */
/* A browser tab, with nothing underneath it                                   */
/* -------------------------------------------------------------------------- */

const PREVIEW_REPLY = `This is Graphe running in a browser tab, so there are no files here for me to open and nothing I can build for you yet.

**What is real on this page**

- the conversation, streamed the way the desktop app streams it
- the questions I ask before I change anything, and the answers you give
- the meter in the corner, with the same arithmetic behind it

What is not real is anything that would reach a folder. In the app, this is where the work itself would arrive — written in your own tokens, with a version saved before it, so putting it back is one click:

\`\`\`css
.hero__title {
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
  margin-block: var(--space-5) var(--space-3);
}
\`\`\`

Open the desktop app and I will get to work. If you came to look at the interface rather than to use it, add \`?gallery\` to the address — every piece of it is on one page there, in both themes.`;

/**
 * A couple of words at a time, so the streaming path is genuinely exercised
 * rather than one delta pretending to be many.
 *
 * Small pieces matter more than they look. They are how the formatting gets
 * tested against the state it is nearly always in: a list with one and a half
 * bullets, a code fence that has been opened and not yet closed, a sentence
 * that ends in the middle of a word. Whatever renders a reply has to hold all
 * of those without flinching, and a preview that arrived in one lump would
 * never have shown us.
 */
function inPieces(text: string): string[] {
  const words = text.split(/(?<=\s)/);
  const pieces: string[] = [];
  for (let index = 0; index < words.length; index += 2) {
    pieces.push(words.slice(index, index + 2).join(''));
  }
  return pieces;
}

/**
 * A sitting's worth of spend, for a tab with no shell under it.
 *
 * The numbers are invented — there is no account here and nothing has been
 * billed — but everything about how they travel is real: the same `spend`
 * events the adapter emits, priced in the same currency Pi prices in, recorded
 * in the same `Ledger` the desktop shell uses, and summarised by the same
 * `summary()` call. So the meter in a screenshot is the real meter with real
 * arithmetic behind it, rather than a mock that drifts away from the thing it
 * stands in for.
 *
 * The split is the point of it: a fifth of this went on an attempt that did not
 * work, which is the one number in the product nobody else can print.
 */
const PREVIEW_SPEND: readonly { minor: number; label: string; reason: 'work' | 'retry-after-failure' }[] =
  [
    { minor: 21, label: 'Looking through your files', reason: 'work' },
    { minor: 18, label: 'Changing contact.html', reason: 'work' },
    { minor: 12, label: 'Changing contact.html', reason: 'retry-after-failure' },
    { minor: 11, label: 'Writing styles.css', reason: 'work' },
  ];

const PREVIEW_CURRENCY = 'USD';

function previewBridge(): Bridge {
  const listeners = new Set<(event: AgentEvent) => void>();
  const send = (event: AgentEvent): void => {
    for (const listener of listeners) listener(event);
  };

  /** Once, shortly after the interface starts listening. It is the one thing a
   *  browser tab cannot show by waiting for it to happen: money is spent by an
   *  agent doing work, and there is no agent here. Everything else in this
   *  preview waits to be asked for. */
  let spendAnnounced = false;
  const announceSpend = (): void => {
    if (spendAnnounced) return;
    spendAnnounced = true;

    const ledger = new Ledger(PREVIEW_CURRENCY);
    // Entry by entry, as it arrives from the shell, then the split once
    // everything has settled — the same two things, in the same order.
    for (const entry of PREVIEW_SPEND) {
      const amount = money(entry.minor, PREVIEW_CURRENCY);
      ledger.record({ amount, reason: entry.reason, label: entry.label });
      send({ type: 'spend', amount, label: entry.label, reason: entry.reason });
    }
    send({ type: 'settled' });
    send({ type: 'spend-summary', summary: ledger.summary() });
  };

  return {
    desktop: false,

    openProject(path: string): Promise<Result<OpenedProject>> {
      const name = path.split('/').filter(Boolean).pop() ?? path;
      return Promise.resolve(done({ path, name }));
    },

    async prompt(): Promise<Result<null>> {
      for (const piece of inPieces(PREVIEW_REPLY)) {
        await new Promise((wake) => setTimeout(wake, 40));
        send({ type: 'message-delta', text: piece });
      }
      send({ type: 'message-end' });
      return done(null);
    },

    stop(): Promise<Result<null>> {
      return Promise.resolve(done(null));
    },

    answer(_callId: string, _decision: Decision): Promise<Result<boolean>> {
      return Promise.resolve(done(true));
    },

    chooseFolder(): Promise<Result<string | null>> {
      return Promise.resolve(done(null));
    },

    onEvent(listener: (event: AgentEvent) => void): () => void {
      listeners.add(listener);
      // A beat, so the interface is mounted and the meter arrives the way it
      // does in the desktop app — as something that appears, not as part of the
      // first paint.
      setTimeout(announceSpend, 60);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The one the app uses                                                        */
/* -------------------------------------------------------------------------- */

function connect(): Bridge {
  const api = typeof window === 'undefined' ? undefined : window.graphe;
  if (api === undefined) return previewBridge();

  return {
    desktop: true,
    openProject: (path) => api.openProject(path),
    prompt: (text) => api.prompt(text),
    stop: () => api.stop(),
    answer: (callId, decision) => api.answer(callId, decision),
    chooseFolder: () => api.chooseFolder(),
    onEvent: (listener) => api.onEvent(listener),
  };
}

/** Read once. Whether there is a shell underneath cannot change while the page
 *  is open, and re-checking on every render would only invite the interface to
 *  behave differently at two moments for no reason. */
export const bridge: Bridge = connect();

// The desktop window hides its title bar, so the layout needs to know to leave
// room for the traffic lights. A stylesheet is the right place for that, and an
// attribute is how a stylesheet finds out.
if (typeof document !== 'undefined' && bridge.desktop) {
  document.documentElement.dataset['shell'] = 'desktop';
}
