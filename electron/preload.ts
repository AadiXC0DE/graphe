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
  type Away,
  type AwayNotice,
  type EveryKind,
  type ConnectOutcome,
  type ConnectStep,
  type ConnectionState,
  type Decided,
  type Decision,
  type HandedOver,
  type Landing,
  type WentOnline,
  type FileEntry,
  type FoundAccount,
  type GrapheApi,
  type Hatches,
  type ModelChoice,
  type OpenedProject,
  type Overview,
  type InStep,
  type Page,
  type Preferences,
  type PromptAttachment,
  type PromptOptions,
  type ProviderMethod,
  type PutBack,
  type RecentProject,
  type Conversation,
  type Look,
  type Pack,
  type Result,
  type CarriedExtension,
  type Room,
  type SavedVersion,
  type ShowOutcome,
  type ShowProgress,
  type WindowState,
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

  prompt(
    text: string,
    attachments?: readonly PromptAttachment[],
    options?: PromptOptions,
  ): Promise<Result<null>> {
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
    const ways: PromptOptions = { lookFirst: options?.lookFirst === true };
    return ipcRenderer.invoke(CHANNEL.prompt, text, clean, ways) as Promise<Result<null>>;
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

  versionPictures(): Promise<Result<Readonly<Record<string, string>>>> {
    return ipcRenderer.invoke(CHANNEL.versionPictures) as Promise<
      Result<Readonly<Record<string, string>>>
    >;
  },

  preferences(): Promise<Result<Preferences>> {
    return ipcRenderer.invoke(CHANNEL.preferences) as Promise<Result<Preferences>>;
  },

  keepVersion(versionId: string, keep: boolean): Promise<Result<Preferences>> {
    if (typeof versionId !== 'string' || versionId.trim() === '' || typeof keep !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell which version you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepVersion, versionId, keep) as Promise<Result<Preferences>>;
  },

  setShowMe(on: boolean): Promise<Result<Preferences>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.setShowMe, on) as Promise<Result<Preferences>>;
  },

  setShowFiles(on: boolean): Promise<Result<Preferences>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.setShowFiles, on) as Promise<Result<Preferences>>;
  },

  projectFiles(): Promise<Result<readonly FileEntry[]>> {
    return ipcRenderer.invoke(CHANNEL.projectFiles) as Promise<Result<readonly FileEntry[]>>;
  },

  fileText(path: string): Promise<Result<string>> {
    if (typeof path !== 'string' || path.trim() === '') {
      return Promise.resolve(refuse<string>('I could not tell which file you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.fileText, path) as Promise<Result<string>>;
  },

  hatches(): Promise<Result<Hatches>> {
    return ipcRenderer.invoke(CHANNEL.hatches) as Promise<Result<Hatches>>;
  },

  openInEditor(file?: string): Promise<Result<null>> {
    const one = typeof file === 'string' && file.trim() !== '' ? file : undefined;
    return ipcRenderer.invoke(CHANNEL.openInEditor, one) as Promise<Result<null>>;
  },

  saveVersion(name?: string): Promise<Result<readonly SavedVersion[]>> {
    const chosen = typeof name === 'string' ? name : undefined;
    return ipcRenderer.invoke(CHANNEL.saveVersion, chosen) as Promise<
      Result<readonly SavedVersion[]>
    >;
  },

  room(): Promise<Result<Room | null>> {
    return ipcRenderer.invoke(CHANNEL.room) as Promise<Result<Room | null>>;
  },

  tidyNow(): Promise<Result<Room | null>> {
    return ipcRenderer.invoke(CHANNEL.tidyNow) as Promise<Result<Room | null>>;
  },

  carried(): Promise<Result<readonly CarriedExtension[]>> {
    return ipcRenderer.invoke(CHANNEL.carried) as Promise<Result<readonly CarriedExtension[]>>;
  },

  trustCarried(id: string, trust: boolean): Promise<Result<readonly CarriedExtension[]>> {
    if (typeof id !== 'string' || id.trim() === '' || typeof trust !== 'boolean') {
      return Promise.resolve(refuse<readonly CarriedExtension[]>('That is not one of them.'));
    }
    return ipcRenderer.invoke(CHANNEL.trustCarried, id, trust) as Promise<
      Result<readonly CarriedExtension[]>
    >;
  },

  stopAsking(on: boolean): Promise<Result<boolean>> {
    if (typeof on !== 'boolean') return Promise.resolve(refuse<boolean>('That is not a yes or a no.'));
    return ipcRenderer.invoke(CHANNEL.stopAsking, on) as Promise<Result<boolean>>;
  },

  revealFolder(): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.revealFolder) as Promise<Result<null>>;
  },

  show(at?: string, point?: boolean): Promise<Result<ShowOutcome>> {
    return ipcRenderer.invoke(CHANNEL.show, at, point === true) as Promise<Result<ShowOutcome>>;
  },

  onPointed(listener: (said: string) => void): () => void {
    const forward = (_source: IpcRendererEvent, said: string): void => {
      listener(said);
    };
    ipcRenderer.on(CHANNEL.pointed, forward);
    return () => {
      ipcRenderer.off(CHANNEL.pointed, forward);
    };
  },

  pages(): Promise<Result<readonly Page[]>> {
    return ipcRenderer.invoke(CHANNEL.pages) as Promise<Result<readonly Page[]>>;
  },

  shareReview(): Promise<Result<string | null>> {
    return ipcRenderer.invoke(CHANNEL.shareReview) as Promise<Result<string | null>>;
  },

  checkWidths(): Promise<Result<{ looks: readonly Look[]; says: string }>> {
    return ipcRenderer.invoke(CHANNEL.checkWidths) as Promise<
      Result<{ looks: readonly Look[]; says: string }>
    >;
  },

  conversations(): Promise<Result<readonly Conversation[]>> {
    return ipcRenderer.invoke(CHANNEL.conversations) as Promise<Result<readonly Conversation[]>>;
  },

  openConversation(path: string | null): Promise<Result<OpenedProject>> {
    const one = typeof path === 'string' && path.trim() !== '' ? path : null;
    return ipcRenderer.invoke(CHANNEL.openConversation, one) as Promise<Result<OpenedProject>>;
  },

  packages(term?: string): Promise<Result<readonly Pack[]>> {
    const asked = typeof term === 'string' ? term : undefined;
    return ipcRenderer.invoke(CHANNEL.packages, asked) as Promise<Result<readonly Pack[]>>;
  },

  addPackage(id: string): Promise<Result<readonly Pack[]>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<readonly Pack[]>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.addPackage, id) as Promise<Result<readonly Pack[]>>;
  },

  removePackage(id: string): Promise<Result<readonly Pack[]>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<readonly Pack[]>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.removePackage, id) as Promise<Result<readonly Pack[]>>;
  },

  explainPackage(id: string): Promise<Result<string>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<string>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.explainPackage, id) as Promise<Result<string>>;
  },

  nudgeToken(name: string, value: string): Promise<Result<readonly SavedVersion[]>> {
    if (typeof name !== 'string' || name === '' || typeof value !== 'string') {
      return Promise.resolve(refuse<readonly SavedVersion[]>('I could not tell what to change.'));
    }
    return ipcRenderer.invoke(CHANNEL.nudgeToken, name, value) as Promise<
      Result<readonly SavedVersion[]>
    >;
  },
  nudgeMotion(places: readonly unknown[], change: unknown): Promise<Result<readonly SavedVersion[]>> {
    if (!Array.isArray(places) || typeof change !== 'object' || change === null) {
      return Promise.resolve(refuse('I could not change that.'));
    }
    return ipcRenderer.invoke(CHANNEL.nudgeMotion, places, change) as Promise<
      Result<readonly SavedVersion[]>
    >;
  },


  onWindowState(listener: (state: WindowState) => void): () => void {
    const forward = (_source: IpcRendererEvent, state: WindowState): void => {
      listener(state);
    };
    ipcRenderer.on(CHANNEL.windowState, forward);
    return () => {
      ipcRenderer.off(CHANNEL.windowState, forward);
    };
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

  landing(): Promise<Result<Landing>> {
    return ipcRenderer.invoke(CHANNEL.landing) as Promise<Result<Landing>>;
  },

  setHoldBack(on: boolean): Promise<Result<Preferences>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.setHoldBack, on) as Promise<Result<Preferences>>;
  },

  decideOnWork(letIn: boolean): Promise<Result<Decided>> {
    if (typeof letIn !== 'boolean') {
      return Promise.resolve(refuse<Decided>('I could not tell what you decided.'));
    }
    return ipcRenderer.invoke(CHANNEL.decideOnWork, letIn) as Promise<Result<Decided>>;
  },

  /* The two that can send something off this computer. Both refuse anything but
     an explicit `true`, so a call that arrives without one cannot be a press. */
  handToDeveloper(confirmed: boolean): Promise<Result<HandedOver>> {
    if (confirmed !== true) {
      return Promise.resolve(refuse<HandedOver>('Nothing has left this computer.'));
    }
    return ipcRenderer.invoke(CHANNEL.handToDeveloper, true) as Promise<Result<HandedOver>>;
  },

  putOnline(confirmed: boolean): Promise<Result<WentOnline>> {
    if (confirmed !== true) {
      return Promise.resolve(refuse<WentOnline>('Nothing has left this computer.'));
    }
    return ipcRenderer.invoke(CHANNEL.putOnline, true) as Promise<Result<WentOnline>>;
  },

  /* ---------------------------------------------- while you are not looking */

  away(): Promise<Result<Away>> {
    return ipcRenderer.invoke(CHANNEL.away) as Promise<Result<Away>>;
  },

  keepGoing(text: string): Promise<Result<Away>> {
    if (typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve(refuse<Away>('There was nothing to get on with.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepGoing, text) as Promise<Result<Away>>;
  },

  stopAway(id: string): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.stopAway, id) as Promise<Result<Away>>;
  },

  keepAway(id: string): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepAway, id) as Promise<Result<Away>>;
  },

  /* The one call that resolves a question a run stopped on. Checked here as
     well as on the other side: a decision that is not one of the two answers
     never reaches the wire, and there is no third answer to send. */
  answerAway(id: string, callId: string, decision: Decision): Promise<Result<Away>> {
    if (
      typeof id !== 'string' ||
      id.trim() === '' ||
      typeof callId !== 'string' ||
      callId.trim() === '' ||
      !isDecision(decision)
    ) {
      return Promise.resolve(refuse<Away>('I could not tell which question that answered.'));
    }
    return ipcRenderer.invoke(CHANNEL.answerAway, id, callId, decision) as Promise<Result<Away>>;
  },

  addRepeat(
    doing: string,
    every: EveryKind,
    at: { hour: number; minute: number },
    on?: number,
  ): Promise<Result<Away>> {
    const known = every === 'day' || every === 'weekday' || every === 'week' || every === 'month';
    if (
      typeof doing !== 'string' ||
      doing.trim() === '' ||
      !known ||
      typeof at !== 'object' ||
      at === null ||
      typeof at.hour !== 'number' ||
      typeof at.minute !== 'number'
    ) {
      return Promise.resolve(refuse<Away>('I could not tell what to do, or when.'));
    }
    const which = typeof on === 'number' ? on : undefined;
    return ipcRenderer.invoke(CHANNEL.addRepeat, doing, every, at, which) as Promise<Result<Away>>;
  },

  switchRepeat(id: string, on: boolean): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '' || typeof on !== 'boolean') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.switchRepeat, id, on) as Promise<Result<Away>>;
  },

  forgetRepeat(id: string): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.forgetRepeat, id) as Promise<Result<Away>>;
  },

  onAway(listener: (notice: AwayNotice) => void): () => void {
    const forward = (_source: IpcRendererEvent, notice: AwayNotice): void => {
      listener(notice);
    };
    ipcRenderer.on(CHANNEL.awayChanged, forward);
    return () => {
      ipcRenderer.off(CHANNEL.awayChanged, forward);
    };
  },

  inStep(): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.inStep) as Promise<Result<InStep>>;
  },

  followDesign(address: string): Promise<Result<InStep>> {
    if (typeof address !== 'string' || address.trim() === '') {
      return Promise.resolve(refuse<InStep>('There was no address to follow.'));
    }
    return ipcRenderer.invoke(CHANNEL.followDesign, address) as Promise<Result<InStep>>;
  },

  lookAgain(): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.lookAgain) as Promise<Result<InStep>>;
  },

  caughtUp(): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.caughtUp) as Promise<Result<InStep>>;
  },

  stopFollowing(): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.stopFollowing) as Promise<Result<InStep>>;
  },
};

contextBridge.exposeInMainWorld('graphe', api);
