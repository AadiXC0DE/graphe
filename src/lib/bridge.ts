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

const PREVIEW_REPLY =
  'This is Graphe running in a browser tab, so there are no files here for me to open and nothing I can build for you yet. Everything you can see is real — the conversation, and the questions I ask before I change anything. Open the desktop app and I will get to work.';

/** Roughly a phrase at a time, so the streaming path is genuinely exercised
 *  rather than one delta pretending to be many. */
function inPieces(text: string): string[] {
  return text.split(/(?<=[,.] )/);
}

function previewBridge(): Bridge {
  const listeners = new Set<(event: AgentEvent) => void>();
  const send = (event: AgentEvent): void => {
    for (const listener of listeners) listener(event);
  };

  return {
    desktop: false,

    openProject(path: string): Promise<Result<OpenedProject>> {
      const name = path.split('/').filter(Boolean).pop() ?? path;
      return Promise.resolve(done({ path, name }));
    },

    async prompt(): Promise<Result<null>> {
      for (const piece of inPieces(PREVIEW_REPLY)) {
        await new Promise((wake) => setTimeout(wake, 24));
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
