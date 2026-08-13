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
  type PointedAt,
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
  type HowFar,
  type Money,
  type Recording,
  type ShowProgress,
  type SpendLimit,
  type SpendSummary,
  type ThinkingLevel,
  type WindowState,
  type VisualFrames,
  type VisualNotice,
  type Where,
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

/**
 * The address a call is about, cleaned before it reaches the wire.
 *
 * Sent as the last argument of everything that happens to one project. Nothing
 * named is left off entirely rather than sent empty, so a call that does not
 * care which project it is about looks exactly as it always did.
 */
function named(where?: Where): Where | undefined {
  if (where === null || typeof where !== 'object') return undefined;
  const asked: Where = {};
  if (typeof where.project === 'string' && where.project.trim() !== '') {
    asked.project = where.project;
  }
  if (typeof where.conversation === 'string' && where.conversation.trim() !== '') {
    asked.conversation = where.conversation;
  }
  return asked.project === undefined && asked.conversation === undefined ? undefined : asked;
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
    where?: Where,
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
    return ipcRenderer.invoke(CHANNEL.prompt, text, clean, ways, named(where)) as Promise<Result<null>>;
  },

  stop(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.stop, named(where)) as Promise<Result<null>>;
  },

  answer(callId: string, decision: Decision, where?: Where): Promise<Result<boolean>> {
    if (typeof callId !== 'string' || callId === '' || !isDecision(decision)) {
      return Promise.resolve(refuse<boolean>('I could not tell which question that answered.'));
    }
    return ipcRenderer.invoke(CHANNEL.answer, callId, decision, named(where)) as Promise<Result<boolean>>;
  },

  chooseFolder(): Promise<Result<string | null>> {
    return ipcRenderer.invoke(CHANNEL.chooseFolder) as Promise<Result<string | null>>;
  },

  recentProjects(): Promise<Result<readonly RecentProject[]>> {
    return ipcRenderer.invoke(CHANNEL.recentProjects) as Promise<Result<readonly RecentProject[]>>;
  },

  overview(where?: Where): Promise<Result<Overview>> {
    return ipcRenderer.invoke(CHANNEL.overview, named(where)) as Promise<Result<Overview>>;
  },

  forgetProject(path: string): Promise<Result<readonly RecentProject[]>> {
    if (typeof path !== 'string' || path.trim() === '') {
      return Promise.resolve(refuse<readonly RecentProject[]>('I did not get a project to forget.'));
    }
    return ipcRenderer.invoke(CHANNEL.forgetProject, path) as Promise<
      Result<readonly RecentProject[]>
    >;
  },

  versions(where?: Where): Promise<Result<readonly SavedVersion[]>> {
    return ipcRenderer.invoke(CHANNEL.versions, named(where)) as Promise<Result<readonly SavedVersion[]>>;
  },

  putBack(versionId: string, where?: Where): Promise<Result<PutBack>> {
    if (typeof versionId !== 'string' || versionId.trim() === '') {
      return Promise.resolve(refuse<PutBack>('I could not tell which version you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.putBack, versionId, named(where)) as Promise<Result<PutBack>>;
  },

  nameVersion(
    versionId: string,
    name: string,
    where?: Where,
  ): Promise<Result<readonly SavedVersion[]>> {
    if (typeof versionId !== 'string' || versionId.trim() === '' || typeof name !== 'string') {
      return Promise.resolve(
        refuse<readonly SavedVersion[]>('I could not tell which version you meant.'),
      );
    }
    return ipcRenderer.invoke(CHANNEL.nameVersion, versionId, name, named(where)) as Promise<
      Result<readonly SavedVersion[]>
    >;
  },

  versionPictures(where?: Where): Promise<Result<Readonly<Record<string, string>>>> {
    return ipcRenderer.invoke(CHANNEL.versionPictures, named(where)) as Promise<
      Result<Readonly<Record<string, string>>>
    >;
  },

  preferences(): Promise<Result<Preferences>> {
    return ipcRenderer.invoke(CHANNEL.preferences) as Promise<Result<Preferences>>;
  },

  keepVersion(versionId: string, keep: boolean, where?: Where): Promise<Result<Preferences>> {
    if (typeof versionId !== 'string' || versionId.trim() === '' || typeof keep !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell which version you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepVersion, versionId, keep, named(where)) as Promise<Result<Preferences>>;
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

  projectFiles(where?: Where): Promise<Result<readonly FileEntry[]>> {
    return ipcRenderer.invoke(CHANNEL.projectFiles, named(where)) as Promise<Result<readonly FileEntry[]>>;
  },

  fileText(path: string, where?: Where): Promise<Result<string>> {
    if (typeof path !== 'string' || path.trim() === '') {
      return Promise.resolve(refuse<string>('I could not tell which file you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.fileText, path, named(where)) as Promise<Result<string>>;
  },

  hatches(): Promise<Result<Hatches>> {
    return ipcRenderer.invoke(CHANNEL.hatches) as Promise<Result<Hatches>>;
  },

  openInEditor(file?: string, where?: Where): Promise<Result<null>> {
    const one = typeof file === 'string' && file.trim() !== '' ? file : undefined;
    return ipcRenderer.invoke(CHANNEL.openInEditor, one, named(where)) as Promise<Result<null>>;
  },

  saveVersion(name?: string, where?: Where): Promise<Result<readonly SavedVersion[]>> {
    const chosen = typeof name === 'string' ? name : undefined;
    return ipcRenderer.invoke(CHANNEL.saveVersion, chosen, named(where)) as Promise<
      Result<readonly SavedVersion[]>
    >;
  },

  room(where?: Where): Promise<Result<Room | null>> {
    return ipcRenderer.invoke(CHANNEL.room, named(where)) as Promise<Result<Room | null>>;
  },

  tidyNow(where?: Where): Promise<Result<Room | null>> {
    return ipcRenderer.invoke(CHANNEL.tidyNow, named(where)) as Promise<Result<Room | null>>;
  },

  carried(where?: Where): Promise<Result<readonly CarriedExtension[]>> {
    return ipcRenderer.invoke(CHANNEL.carried, named(where)) as Promise<Result<readonly CarriedExtension[]>>;
  },

  trustCarried(
    id: string,
    trust: boolean,
    where?: Where,
  ): Promise<Result<readonly CarriedExtension[]>> {
    if (typeof id !== 'string' || id.trim() === '' || typeof trust !== 'boolean') {
      return Promise.resolve(refuse<readonly CarriedExtension[]>('That is not one of them.'));
    }
    return ipcRenderer.invoke(CHANNEL.trustCarried, id, trust, named(where)) as Promise<
      Result<readonly CarriedExtension[]>
    >;
  },

  stopAsking(on: boolean, where?: Where): Promise<Result<boolean>> {
    if (typeof on !== 'boolean') return Promise.resolve(refuse<boolean>('That is not a yes or a no.'));
    return ipcRenderer.invoke(CHANNEL.stopAsking, on, named(where)) as Promise<Result<boolean>>;
  },

  goAsFarAs(howFar: HowFar, where?: Where): Promise<Result<HowFar>> {
    const RUNGS: readonly string[] = ['looking', 'asking', 'changing', 'doing'];
    if (!RUNGS.includes(howFar)) return Promise.resolve(refuse<HowFar>('I could not apply that.'));
    return ipcRenderer.invoke(CHANNEL.goAsFarAs, howFar, named(where)) as Promise<Result<HowFar>>;
  },

  revealFolder(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.revealFolder, named(where)) as Promise<Result<null>>;
  },

  show(at?: string, point?: boolean, where?: Where): Promise<Result<ShowOutcome>> {
    return ipcRenderer.invoke(CHANNEL.show, at, point === true, named(where)) as Promise<Result<ShowOutcome>>;
  },

  onPointed(listener: (at: PointedAt) => void): () => void {
    const forward = (_source: IpcRendererEvent, at: PointedAt): void => {
      listener(at);
    };
    ipcRenderer.on(CHANNEL.pointed, forward);
    return () => {
      ipcRenderer.off(CHANNEL.pointed, forward);
    };
  },

  pages(where?: Where): Promise<Result<readonly Page[]>> {
    return ipcRenderer.invoke(CHANNEL.pages, named(where)) as Promise<Result<readonly Page[]>>;
  },

  shareReview(where?: Where): Promise<Result<string | null>> {
    return ipcRenderer.invoke(CHANNEL.shareReview, named(where)) as Promise<Result<string | null>>;
  },

  checkWidths(where?: Where): Promise<Result<{ looks: readonly Look[]; says: string }>> {
    return ipcRenderer.invoke(CHANNEL.checkWidths, named(where)) as Promise<
      Result<{ looks: readonly Look[]; says: string }>
    >;
  },

  conversations(where?: Where): Promise<Result<readonly Conversation[]>> {
    return ipcRenderer.invoke(CHANNEL.conversations, named(where)) as Promise<Result<readonly Conversation[]>>;
  },

  openConversation(path: string | null, where?: Where): Promise<Result<OpenedProject>> {
    const one = typeof path === 'string' && path.trim() !== '' ? path : null;
    return ipcRenderer.invoke(CHANNEL.openConversation, one, named(where)) as Promise<Result<OpenedProject>>;
  },

  closeConversation(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.closeConversation, named(where)) as Promise<Result<null>>;
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

  explainPackage(id: string, where?: Where): Promise<Result<string>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<string>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.explainPackage, id, named(where)) as Promise<Result<string>>;
  },

  nudgeToken(
    name: string,
    value: string,
    where?: Where,
  ): Promise<Result<readonly SavedVersion[]>> {
    if (typeof name !== 'string' || name === '' || typeof value !== 'string') {
      return Promise.resolve(refuse<readonly SavedVersion[]>('I could not tell what to change.'));
    }
    return ipcRenderer.invoke(CHANNEL.nudgeToken, name, value, named(where)) as Promise<
      Result<readonly SavedVersion[]>
    >;
  },
  nudgeMotion(
    places: readonly unknown[],
    change: unknown,
    where?: Where,
  ): Promise<Result<readonly SavedVersion[]>> {
    if (!Array.isArray(places) || typeof change !== 'object' || change === null) {
      return Promise.resolve(refuse('I could not change that.'));
    }
    return ipcRenderer.invoke(CHANNEL.nudgeMotion, places, change, named(where)) as Promise<
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

  selectModel(choice: ModelChoice, where?: Where): Promise<Result<Preferences>> {
    if (
      typeof choice !== 'object' ||
      choice === null ||
      typeof choice.providerId !== 'string' ||
      typeof choice.modelId !== 'string'
    ) {
      return Promise.resolve(refuse<Preferences>('I could not tell which model you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.selectModel, choice.providerId, choice.modelId, named(where)) as Promise<
      Result<Preferences>
    >;
  },

  setThinking(
    choice: ModelChoice,
    level: ThinkingLevel,
    where?: Where,
  ): Promise<Result<Preferences>> {
    const LEVELS: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    if (
      typeof choice !== 'object' ||
      choice === null ||
      typeof choice.providerId !== 'string' ||
      typeof choice.modelId !== 'string' ||
      !LEVELS.includes(level)
    ) {
      return Promise.resolve(refuse<Preferences>('I could not apply that.'));
    }
    return ipcRenderer.invoke(CHANNEL.setThinking, choice.providerId, choice.modelId, level, named(where)) as Promise<
      Result<Preferences>
    >;
  },

  spendSplit(where?: Where): Promise<Result<SpendSummary | null>> {
    return ipcRenderer.invoke(CHANNEL.spendSplit, named(where)) as Promise<Result<SpendSummary | null>>;
  },

  pageAt(
    address: string | null,
    bounds: { x: number; y: number; width: number; height: number } | null,
  ): Promise<Result<null>> {
    const fine =
      bounds === null ||
      (typeof bounds === 'object' &&
        ['x', 'y', 'width', 'height'].every(
          (side) => typeof (bounds as Record<string, unknown>)[side] === 'number',
        ));
    if ((address !== null && typeof address !== 'string') || !fine) {
      return Promise.resolve(refuse<null>('I could not tell where to put the page.'));
    }
    return ipcRenderer.invoke(CHANNEL.pageAt, address, bounds) as Promise<Result<null>>;
  },

  pageHidden(hidden: boolean): Promise<Result<null>> {
    if (typeof hidden !== 'boolean') {
      return Promise.resolve(refuse<null>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.pageHidden, hidden) as Promise<Result<null>>;
  },

  watchStart(says?: string): Promise<Result<null>> {
    const words = typeof says === 'string' ? says : undefined;
    return ipcRenderer.invoke(CHANNEL.watchStart, words) as Promise<Result<null>>;
  },

  watchStop(): Promise<Result<Recording | null>> {
    return ipcRenderer.invoke(CHANNEL.watchStop) as Promise<Result<Recording | null>>;
  },

  spendLimit(): Promise<Result<SpendLimit | null>> {
    return ipcRenderer.invoke(CHANNEL.spendLimit) as Promise<Result<SpendLimit | null>>;
  },

  setSpendLimit(ceiling: Money | null): Promise<Result<SpendLimit | null>> {
    const fine =
      ceiling === null ||
      (typeof ceiling === 'object' &&
        typeof ceiling.minor === 'number' &&
        Number.isFinite(ceiling.minor) &&
        ceiling.minor > 0 &&
        typeof ceiling.currency === 'string' &&
        ceiling.currency !== '');
    if (!fine) return Promise.resolve(refuse<SpendLimit | null>('That is not an amount I can hold you to.'));
    return ipcRenderer.invoke(CHANNEL.setSpendLimit, ceiling) as Promise<Result<SpendLimit | null>>;
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

  landing(where?: Where): Promise<Result<Landing>> {
    return ipcRenderer.invoke(CHANNEL.landing, named(where)) as Promise<Result<Landing>>;
  },

  setHoldBack(on: boolean): Promise<Result<Preferences>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.setHoldBack, on) as Promise<Result<Preferences>>;
  },

  decideOnWork(letIn: boolean, where?: Where): Promise<Result<Decided>> {
    if (typeof letIn !== 'boolean') {
      return Promise.resolve(refuse<Decided>('I could not tell what you decided.'));
    }
    return ipcRenderer.invoke(CHANNEL.decideOnWork, letIn, named(where)) as Promise<Result<Decided>>;
  },

  /* The two that can send something off this computer. Both refuse anything but
     an explicit `true`, so a call that arrives without one cannot be a press. */
  handToDeveloper(confirmed: boolean, where?: Where): Promise<Result<HandedOver>> {
    if (confirmed !== true) {
      return Promise.resolve(refuse<HandedOver>('Nothing has left this computer.'));
    }
    return ipcRenderer.invoke(CHANNEL.handToDeveloper, true, named(where)) as Promise<Result<HandedOver>>;
  },

  putOnline(confirmed: boolean, where?: Where): Promise<Result<WentOnline>> {
    if (confirmed !== true) {
      return Promise.resolve(refuse<WentOnline>('Nothing has left this computer.'));
    }
    return ipcRenderer.invoke(CHANNEL.putOnline, true, named(where)) as Promise<Result<WentOnline>>;
  },

  /* ---------------------------------------------- while you are not looking */

  away(where?: Where): Promise<Result<Away>> {
    return ipcRenderer.invoke(CHANNEL.away, named(where)) as Promise<Result<Away>>;
  },

  keepGoing(text: string, where?: Where): Promise<Result<Away>> {
    if (typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve(refuse<Away>('There was nothing to get on with.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepGoing, text, named(where)) as Promise<Result<Away>>;
  },

  startAfter(text: string, after: string, where?: Where): Promise<Result<Away>> {
    if (typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve(refuse<Away>('There was nothing to get on with.'));
    }
    if (typeof after !== 'string' || after.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell what it was meant to wait for.'));
    }
    return ipcRenderer.invoke(CHANNEL.startAfter, text, after, named(where)) as Promise<Result<Away>>;
  },

  putAfter(id: string, after: string | null, where?: Where): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    if (after !== null && (typeof after !== 'string' || after.trim() === '')) {
      return Promise.resolve(refuse<Away>('I could not tell what it was meant to wait for.'));
    }
    return ipcRenderer.invoke(CHANNEL.putAfter, id, after, named(where)) as Promise<Result<Away>>;
  },

  stopAway(id: string, where?: Where): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.stopAway, id, named(where)) as Promise<Result<Away>>;
  },

  keepAway(id: string, where?: Where): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepAway, id, named(where)) as Promise<Result<Away>>;
  },

  /* The one call that resolves a question a run stopped on. Checked here as
     well as on the other side: a decision that is not one of the two answers
     never reaches the wire, and there is no third answer to send. */
  answerAway(
    id: string,
    callId: string,
    decision: Decision,
    where?: Where,
  ): Promise<Result<Away>> {
    if (
      typeof id !== 'string' ||
      id.trim() === '' ||
      typeof callId !== 'string' ||
      callId.trim() === '' ||
      !isDecision(decision)
    ) {
      return Promise.resolve(refuse<Away>('I could not tell which question that answered.'));
    }
    return ipcRenderer.invoke(CHANNEL.answerAway, id, callId, decision, named(where)) as Promise<Result<Away>>;
  },

  addRepeat(
    doing: string,
    every: EveryKind,
    at: { hour: number; minute: number },
    on?: number,
    where?: Where,
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
    return ipcRenderer.invoke(CHANNEL.addRepeat, doing, every, at, which, named(where)) as Promise<Result<Away>>;
  },

  switchRepeat(id: string, on: boolean, where?: Where): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '' || typeof on !== 'boolean') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.switchRepeat, id, on, named(where)) as Promise<Result<Away>>;
  },

  forgetRepeat(id: string, where?: Where): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Away>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.forgetRepeat, id, named(where)) as Promise<Result<Away>>;
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

  inStep(where?: Where): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.inStep, named(where)) as Promise<Result<InStep>>;
  },

  followDesign(address: string, where?: Where): Promise<Result<InStep>> {
    if (typeof address !== 'string' || address.trim() === '') {
      return Promise.resolve(refuse<InStep>('There was no address to follow.'));
    }
    return ipcRenderer.invoke(CHANNEL.followDesign, address, named(where)) as Promise<Result<InStep>>;
  },

  lookAgain(where?: Where): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.lookAgain, named(where)) as Promise<Result<InStep>>;
  },

  caughtUp(where?: Where): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.caughtUp, named(where)) as Promise<Result<InStep>>;
  },

  stopFollowing(where?: Where): Promise<Result<InStep>> {
    return ipcRenderer.invoke(CHANNEL.stopFollowing, named(where)) as Promise<Result<InStep>>;
  },
};

contextBridge.exposeInMainWorld('graphe', api);
