/** The only thing the window and the shell can say to each other.
 *
 * This file runs with `contextIsolation: true` and `sandbox: true`, so it has no
 * Node beyond `electron` itself, and everything it hands over goes through
 * `contextBridge` — a structured clone, not a live reference into this world.
 * Page script cannot reach back through it.
 *
 * What is exposed is the whole surface: a dozen verbs and two subscriptions,
 * listed by name. There is no `invoke(channel, ...)`, no `send`, no
 * `ipcRenderer`. See the note on `GrapheApi` in src/lib/ipc.ts for why that
 * matters more here than the convenience costs.
 *
 * Arguments are checked here as well as in the main process. This side of the
 * wall is the cheaper place to reject a mistake, and the main process should
 * never be the only thing standing between a typo and a session.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CHANNEL,
  type AgentNotice,
  type ConnectOutcome,
  type ConnectStep,
  type ConnectionState,
  type Decision,
  type FoundAccount,
  type GrapheApi,
  type Hatches,
  type ModelChoice,
  type OpenedProject,
  type Overview,
  type Preferences,
  type PromptAttachment,
  type ProviderMethod,
  type PutBack,
  type RecentProject,
  type Result,
  type SavedVersion,
  type ShowOutcome,
  type ShowProgress,
  type VisualFrames,
  type VisualNotice,
} from '../src/lib/ipc';

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

  prompt(text: string, attachments?: readonly PromptAttachment[]): Promise<Result<null>> {
    if (typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve(refuse<null>('There was nothing to send.'));
    }
    const clean =
      attachments === undefined
        ? undefined
        : attachments.filter(
            (one) =>
              one !== null &&
              typeof one === 'object' &&
              one.kind === 'image' &&
              typeof one.name === 'string' &&
              typeof one.mimeType === 'string' &&
              typeof one.bytes === 'string' &&
              one.bytes !== '',
          );
    return ipcRenderer.invoke(CHANNEL.prompt, text, clean) as Promise<Result<null>>;
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

  recentProjects(): Promise<Result<readonly RecentProject[]>> {
    return ipcRenderer.invoke(CHANNEL.recentProjects) as Promise<Result<readonly RecentProject[]>>;
  },

  overview(): Promise<Result<Overview>> {
    return ipcRenderer.invoke(CHANNEL.overview) as Promise<Result<Overview>>;
  },

  forgetProject(path: string): Promise<Result<readonly RecentProject[]>> {
    if (typeof path !== 'string' || path.trim() === '') {
      return Promise.resolve(refuse<readonly RecentProject[]>('I did not get a project to forget.'));
    }
    return ipcRenderer.invoke(CHANNEL.forgetProject, path) as Promise<
      Result<readonly RecentProject[]>
    >;
  },

  versions(): Promise<Result<readonly SavedVersion[]>> {
    return ipcRenderer.invoke(CHANNEL.versions) as Promise<Result<readonly SavedVersion[]>>;
  },

  putBack(versionId: string): Promise<Result<PutBack>> {
    if (typeof versionId !== 'string' || versionId.trim() === '') {
      return Promise.resolve(refuse<PutBack>('I could not tell which version you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.putBack, versionId) as Promise<Result<PutBack>>;
  },

  nameVersion(versionId: string, name: string): Promise<Result<readonly SavedVersion[]>> {
    if (typeof versionId !== 'string' || versionId.trim() === '' || typeof name !== 'string') {
      return Promise.resolve(
        refuse<readonly SavedVersion[]>('I could not tell which version you meant.'),
      );
    }
    return ipcRenderer.invoke(CHANNEL.nameVersion, versionId, name) as Promise<
      Result<readonly SavedVersion[]>
    >;
  },

  preferences(): Promise<Result<Preferences>> {
    return ipcRenderer.invoke(CHANNEL.preferences) as Promise<Result<Preferences>>;
  },

  setShowMe(on: boolean): Promise<Result<Preferences>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.setShowMe, on) as Promise<Result<Preferences>>;
  },

  hatches(): Promise<Result<Hatches>> {
    return ipcRenderer.invoke(CHANNEL.hatches) as Promise<Result<Hatches>>;
  },

  openInEditor(): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.openInEditor) as Promise<Result<null>>;
  },

  revealFolder(): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.revealFolder) as Promise<Result<null>>;
  },

  show(): Promise<Result<ShowOutcome>> {
    return ipcRenderer.invoke(CHANNEL.show) as Promise<Result<ShowOutcome>>;
  },

  onShowProgress(listener: (progress: ShowProgress) => void): () => void {
    const forward = (_source: IpcRendererEvent, progress: ShowProgress): void => {
      listener(progress);
    };
    ipcRenderer.on(CHANNEL.showProgress, forward);
    return () => {
      ipcRenderer.off(CHANNEL.showProgress, forward);
    };
  },

  onEvent(listener: (notice: AgentNotice) => void): () => void {
    const forward = (_source: IpcRendererEvent, notice: AgentNotice): void => {
      listener(notice);
    };
    ipcRenderer.on(CHANNEL.event, forward);
    return () => {
      ipcRenderer.off(CHANNEL.event, forward);
    };
  },

  visualFrames(changeId: string): Promise<Result<VisualFrames>> {
    if (typeof changeId !== 'string' || changeId.trim() === '') {
      return Promise.resolve(refuse<VisualFrames>('I could not tell which change you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.visualFrames, changeId) as Promise<Result<VisualFrames>>;
  },

  onVisualChange(listener: (notice: VisualNotice) => void): () => void {
    const forward = (_source: IpcRendererEvent, notice: VisualNotice): void => {
      listener(notice);
    };
    ipcRenderer.on(CHANNEL.visualChange, forward);
    return () => {
      ipcRenderer.off(CHANNEL.visualChange, forward);
    };
  },

  connection(): Promise<Result<ConnectionState>> {
    return ipcRenderer.invoke(CHANNEL.connection) as Promise<Result<ConnectionState>>;
  },

  connect(providerId: string, method: ProviderMethod): Promise<Result<ConnectOutcome>> {
    if (
      typeof providerId !== 'string' ||
      providerId.trim() === '' ||
      (method !== 'oauth' && method !== 'api-key')
    ) {
      return Promise.resolve(
        refuse<ConnectOutcome>('I could not tell who you wanted to connect.'),
      );
    }
    return ipcRenderer.invoke(CHANNEL.connect, providerId, method) as Promise<
      Result<ConnectOutcome>
    >;
  },

  connectAnswer(promptId: string, value: string | null): Promise<Result<null>> {
    if (typeof promptId !== 'string' || promptId.trim() === '') {
      return Promise.resolve(refuse<null>('I could not tell which question you answered.'));
    }
    return ipcRenderer.invoke(CHANNEL.connectAnswer, promptId, value) as Promise<Result<null>>;
  },

  cancelConnect(): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.cancelConnect) as Promise<Result<null>>;
  },

  disconnect(providerId: string): Promise<Result<null>> {
    if (typeof providerId !== 'string' || providerId.trim() === '') {
      return Promise.resolve(refuse<null>('I could not tell which account you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.disconnect, providerId) as Promise<Result<null>>;
  },

  selectModel(choice: ModelChoice): Promise<Result<Preferences>> {
    if (
      typeof choice !== 'object' ||
      choice === null ||
      typeof choice.providerId !== 'string' ||
      typeof choice.modelId !== 'string'
    ) {
      return Promise.resolve(refuse<Preferences>('I could not tell which model you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.selectModel, choice.providerId, choice.modelId) as Promise<
      Result<Preferences>
    >;
  },

  onConnectStep(listener: (step: ConnectStep) => void): () => void {
    const forward = (_source: IpcRendererEvent, step: ConnectStep): void => {
      listener(step);
    };
    ipcRenderer.on(CHANNEL.connectStep, forward);
    return () => {
      ipcRenderer.off(CHANNEL.connectStep, forward);
    };
  },

  discoveredAccounts(): Promise<Result<readonly FoundAccount[]>> {
    return ipcRenderer.invoke(CHANNEL.discoveredAccounts) as Promise<
      Result<readonly FoundAccount[]>
    >;
  },

  importAccount(account: FoundAccount): Promise<Result<null>> {
    if (
      typeof account !== 'object' ||
      account === null ||
      typeof account.providerId !== 'string' ||
      account.providerId.trim() === '' ||
      (account.kind !== 'api-key' && account.kind !== 'sign-in') ||
      (account.source !== 'opencode' && account.source !== 'codex')
    ) {
      return Promise.resolve(refuse<null>('I could not tell which account you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.importAccount, account) as Promise<Result<null>>;
  },

  openLink(url: string): Promise<Result<null>> {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
      return Promise.resolve(refuse<null>('I could not open that link.'));
    }
    return ipcRenderer.invoke(CHANNEL.openLink, url) as Promise<Result<null>>;
  },
};

contextBridge.exposeInMainWorld('graphe', api);
