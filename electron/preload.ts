/** The only thing the window and the shell can say to each other.
 *
 * This file runs with `contextIsolation: true` and `sandbox: true`, so it has no
 * Node beyond `electron` itself, and everything it hands over goes through
 * `contextBridge` — a structured clone, not a live reference into this world.
 * Page script cannot reach back through it.
 *
 * What is exposed is the whole surface: six verbs and a subscription, listed by
 * name. There is no `invoke(channel, ...)`, no `send`, no `ipcRenderer`. See the
 * note on `GrapheApi` in src/lib/ipc.ts for why that matters more here than the
 * convenience costs.
 *
 * Arguments are checked here as well as in the main process. This side of the
 * wall is the cheaper place to reject a mistake, and the main process should
 * never be the only thing standing between a typo and a session.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AgentEvent } from '../src/agent/types';
import { CHANNEL, type Decision, type GrapheApi, type OpenedProject, type Result } from '../src/lib/ipc';

/** Refused before it reaches the wire. The shape matches everything else the
 *  bridge returns, so a caller has one thing to handle rather than two. */
function refuse<T>(what: string): Result<T> {
  return {
    ok: false,
    trouble: {
      what,
      because: 'The window asked for something that does not make sense, so I left it alone.',
      actionLabel: 'Got it',
    },
  };
}

function isDecision(value: unknown): value is Decision {
  return value === 'yes' || value === 'no';
}

const api: GrapheApi = {
  openProject(path: string): Promise<Result<OpenedProject>> {
    if (typeof path !== 'string' || path.trim() === '') {
      return Promise.resolve(refuse<OpenedProject>('I did not get a folder to open.'));
    }
    return ipcRenderer.invoke(CHANNEL.openProject, path) as Promise<Result<OpenedProject>>;
  },

  prompt(text: string): Promise<Result<null>> {
    if (typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve(refuse<null>('There was nothing to send.'));
    }
    return ipcRenderer.invoke(CHANNEL.prompt, text) as Promise<Result<null>>;
  },

  stop(): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.stop) as Promise<Result<null>>;
  },

  answer(callId: string, decision: Decision): Promise<Result<boolean>> {
    if (typeof callId !== 'string' || callId === '' || !isDecision(decision)) {
      return Promise.resolve(refuse<boolean>('I could not tell which question that answered.'));
    }
    return ipcRenderer.invoke(CHANNEL.answer, callId, decision) as Promise<Result<boolean>>;
  },

  chooseFolder(): Promise<Result<string | null>> {
    return ipcRenderer.invoke(CHANNEL.chooseFolder) as Promise<Result<string | null>>;
  },

  onEvent(listener: (event: AgentEvent) => void): () => void {
    const forward = (_source: IpcRendererEvent, event: AgentEvent): void => {
      listener(event);
    };
    ipcRenderer.on(CHANNEL.event, forward);
    return () => {
      ipcRenderer.off(CHANNEL.event, forward);
    };
  },
};

contextBridge.exposeInMainWorld('graphe', api);
