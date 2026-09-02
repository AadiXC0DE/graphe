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
  type Connected,
  type ConnectedHealth,
  type ConnectedState,
  type EveryKind,
  type ConnectOutcome,
  type ConnectStep,
  type ConnectionState,
  type Decided,
  type Decision,
  type HandedOver,
  type Landing,
  type WentOnline,
  type Fetched,
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
  type RunningPiece,
  type ProviderMethod,
  type PutBack,
  type RepoLook,
  type RecentProject,
  type Conversation,
  type Look,
  type Pack,
  type Result,
  type CarriedExtension,
  type Room,
  type SideOfWork,
  type Skill,
  type AlwaysDoes,
  type Workflow,
  type BuildPlan,
  type BuildAdvance,
  type ContinuationNotice,
  type SavedVersion,
  type DesignChange,
  type ShowOutcome,
  type VariationSpec,
  type VariationsOutcome,
  type HowFar,
  type Money,
  type Recording,
  type ShowProgress,
  type SpendLimit,
  type SpendSummary,
  type ThinkingLevel,
  type TokenUsageView,
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
  // Which project inside a folder that holds several. Sent as written; the
  // shell matches it against the children it actually found, so a name that
  // names nothing means the folder itself and never a folder elsewhere.
  if (typeof where.repo === 'string' && where.repo.trim() !== '') {
    asked.repo = where.repo;
  }
  return asked.project === undefined && asked.conversation === undefined && asked.repo === undefined
    ? undefined
    : asked;
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
              (one.kind === 'image' || one.kind === 'document') &&
              typeof one.name === 'string' &&
              typeof one.mimeType === 'string' &&
              typeof one.bytes === 'string' &&
              one.bytes !== '',
          );
    const ways: PromptOptions = {
      lookFirst: options?.lookFirst === true,
      ...(options?.queue === 'followUp' ? { queue: 'followUp' as const } : {}),
    };
    return ipcRenderer.invoke(CHANNEL.prompt, text, clean, ways, named(where)) as Promise<Result<null>>;
  },

  stop(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.stop, named(where)) as Promise<Result<null>>;
  },

  waitForMe(on: boolean, where?: Where): Promise<Result<null>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<null>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.waitForMe, on, named(where)) as Promise<Result<null>>;
  },

  steer(text: string, where?: Where): Promise<Result<null>> {
    if (typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve({
        ok: true,
        value: null,
      });
    }
    return ipcRenderer.invoke(CHANNEL.steer, text, named(where)) as Promise<Result<null>>;
  },

  answer(callId: string, decision: Decision, where?: Where): Promise<Result<boolean>> {
    if (typeof callId !== 'string' || callId === '' || !isDecision(decision)) {
      return Promise.resolve(refuse<boolean>('I could not tell which question that answered.'));
    }
    return ipcRenderer.invoke(CHANNEL.answer, callId, decision, named(where)) as Promise<Result<boolean>>;
  },

  answerAsked(
    id: string,
    answers: Readonly<Record<string, readonly string[]>> | null,
    where?: Where,
  ): Promise<Result<boolean>> {
    if (typeof id !== 'string' || id === '') {
      return Promise.resolve(refuse<boolean>('I could not tell which question that answered.'));
    }
    return ipcRenderer.invoke(CHANNEL.answerAsked, id, answers, named(where)) as Promise<
      Result<boolean>
    >;
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

  repoLook(where?: Where): Promise<Result<RepoLook>> {
    return ipcRenderer.invoke(CHANNEL.repoLook, named(where)) as Promise<Result<RepoLook>>;
  },

  repoComment(number: number, body: string, where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.repoComment, number, body, named(where)) as Promise<Result<null>>;
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
  getHelper(id: string): Promise<Result<string>> {
    return ipcRenderer.invoke(CHANNEL.getHelper, id) as Promise<Result<string>>;
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

  skills(where?: Where): Promise<Result<readonly Skill[]>> {
    return ipcRenderer.invoke(CHANNEL.skills, named(where)) as Promise<Result<readonly Skill[]>>;
  },

  skillText(id: string, where?: Where): Promise<Result<string>> {
    if (typeof id !== 'string' || id === '') return Promise.resolve(refuse<string>('I could not tell which skill to open.'));
    return ipcRenderer.invoke(CHANNEL.skillText, id, named(where)) as Promise<Result<string>>;
  },

  watchBrowser(on: boolean, where?: Where): Promise<Result<boolean>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<boolean>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.watchBrowser, on, named(where)) as Promise<Result<boolean>>;
  },

  onBrowserFrame(listener: (frame: { project: string; bytes: string }) => void): () => void {
    const hear = (_event: unknown, frame: { project: string; bytes: string }): void => listener(frame);
    ipcRenderer.on(CHANNEL.browserFrame, hear);
    return () => ipcRenderer.removeListener(CHANNEL.browserFrame, hear);
  },

  alwaysDoes(where?: Where): Promise<Result<AlwaysDoes>> {
    return ipcRenderer.invoke(CHANNEL.alwaysDoes, named(where)) as Promise<Result<AlwaysDoes>>;
  },

  workflows(where?: Where): Promise<Result<readonly Workflow[]>> {
    return ipcRenderer.invoke(CHANNEL.workflows, named(where)) as Promise<Result<readonly Workflow[]>>;
  },

  branchSwitch(name: string, where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.branchSwitch, name, named(where)) as Promise<Result<null>>;
  },
  branchCreate(name: string, where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.branchCreate, name, named(where)) as Promise<Result<null>>;
  },
  fetchOrigin(where?: Where): Promise<Result<Fetched>> {
    return ipcRenderer.invoke(CHANNEL.fetchOrigin, named(where)) as Promise<Result<Fetched>>;
  },
  fastForward(where?: Where): Promise<Result<Fetched>> {
    return ipcRenderer.invoke(CHANNEL.fastForward, named(where)) as Promise<Result<Fetched>>;
  },
  worktreeLand(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.worktreeLand, named(where)) as Promise<Result<null>>;
  },

  worktreeDrop(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.worktreeDrop, named(where)) as Promise<Result<null>>;
  },

  preparePrWorktree(prNumber: number, where?: Where): Promise<Result<string>> {
    if (typeof prNumber !== 'number' || !Number.isFinite(prNumber) || prNumber <= 0) {
      return Promise.resolve(refuse<string>('I could not tell which pull request you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.prWorktreePrepare, prNumber, named(where)) as Promise<Result<string>>;
  },

  openPrReview(prNumber: number, where?: Where): Promise<Result<{ folder: string; opened: OpenedProject }>> {
    if (typeof prNumber !== 'number' || !Number.isFinite(prNumber) || prNumber <= 0) {
      return Promise.resolve(refuse<{ folder: string; opened: OpenedProject }>('I could not tell which pull request you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.prReviewOpen, prNumber, named(where)) as Promise<Result<{ folder: string; opened: OpenedProject }>>;
  },

  buildStart(source: { name: string; text: string; instruction?: string }, where?: Where): Promise<Result<BuildPlan>> {
    return ipcRenderer.invoke(CHANNEL.buildStart, source, named(where)) as Promise<Result<BuildPlan>>;
  },

  buildPlan(where?: Where): Promise<Result<BuildPlan | null>> {
    return ipcRenderer.invoke(CHANNEL.buildPlan, named(where)) as Promise<Result<BuildPlan | null>>;
  },

  buildAdvance(op: BuildAdvance, where?: Where): Promise<Result<BuildPlan | null>> {
    if (
      typeof op !== 'object' ||
      op === null ||
      (op.kind !== 'start' && op.kind !== 'finish' && op.kind !== 'add')
    ) {
      return Promise.resolve(
        refuse<BuildPlan | null>('I could not tell how the work moved on.'),
      );
    }
    return ipcRenderer.invoke(CHANNEL.buildAdvance, op, named(where)) as Promise<
      Result<BuildPlan | null>
    >;
  },

  chooseDocument(where?: Where): Promise<Result<{ name: string; text: string } | null>> {
    return ipcRenderer.invoke(CHANNEL.chooseDocument, named(where)) as Promise<
      Result<{ name: string; text: string } | null>
    >;
  },

  buildSave(tasks: readonly { title: string; acceptance: string }[], where?: Where): Promise<Result<BuildPlan | null>> {
    return ipcRenderer.invoke(CHANNEL.buildSave, tasks, named(where)) as Promise<Result<BuildPlan | null>>;
  },

  buildCancel(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.buildCancel, named(where)) as Promise<Result<null>>;
  },

  flowLoad(where?: Where): Promise<Result<readonly import('../src/work/canvas').Flow[]>> {
    return ipcRenderer.invoke(CHANNEL.flowLoad, named(where)) as Promise<Result<readonly import('../src/work/canvas').Flow[]>>;
  },

  flowSave(flow: import('../src/work/canvas').Flow, where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.flowSave, flow, named(where)) as Promise<Result<null>>;
  },


  flowForget(id: string, where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.flowForget, id, named(where)) as Promise<Result<null>>;
  },

  goalLoad(where?: Where): Promise<Result<import('../src/work/goal').Goal | null>> {
    return ipcRenderer.invoke(CHANNEL.goalLoad, named(where)) as Promise<Result<import('../src/work/goal').Goal | null>>;
  },

  goalSave(goal: import('../src/work/goal').Goal, where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.goalSave, goal, named(where)) as Promise<Result<null>>;
  },

  goalClear(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.goalClear, named(where)) as Promise<Result<null>>;
  },

  goalVerify(where?: Where): Promise<Result<{ passed: boolean; reason: string }>> {
    return ipcRenderer.invoke(CHANNEL.goalVerify, named(where)) as Promise<Result<{ passed: boolean; reason: string }>>;
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

  setPlanMode(on: boolean, where?: Where): Promise<Result<boolean>> {
    if (typeof on !== 'boolean') return Promise.resolve(refuse<boolean>('That is not a yes or a no.'));
    return ipcRenderer.invoke(CHANNEL.setPlanMode, on, named(where)) as Promise<Result<boolean>>;
  },

  running(where?: Where): Promise<Result<readonly RunningPiece[]>> {
    return ipcRenderer.invoke(CHANNEL.running, named(where)) as Promise<Result<readonly RunningPiece[]>>;
  },

  stopRunning(id: string, where?: Where): Promise<Result<readonly RunningPiece[]>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<readonly RunningPiece[]>('I could not tell which one you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.stopRunning, id, named(where)) as Promise<
      Result<readonly RunningPiece[]>
    >;
  },

  revealFolder(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.revealFolder, named(where)) as Promise<Result<null>>;
  },

  show(at?: string, point?: boolean, where?: Where): Promise<Result<ShowOutcome>> {
    return ipcRenderer.invoke(CHANNEL.show, at, point === true, named(where)) as Promise<Result<ShowOutcome>>;
  },

  variationsServe(
    parts: { subject: string; variations: readonly VariationSpec[] },
    where?: Where,
  ): Promise<Result<VariationsOutcome>> {
    if (
      typeof parts !== 'object' ||
      parts === null ||
      typeof parts.subject !== 'string' ||
      !Array.isArray(parts.variations)
    ) {
      return Promise.resolve(refuse<VariationsOutcome>('I could not tell what to compare.'));
    }
    return ipcRenderer.invoke(
      CHANNEL.variationsServe,
      parts as { subject: string; variations: readonly VariationSpec[] },
      named(where),
    ) as Promise<Result<VariationsOutcome>>;
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

  onPaneKey(listener: (press: { key: string }) => void): () => void {
    const forward = (_source: IpcRendererEvent, press: { key: string }): void => {
      listener(press);
    };
    ipcRenderer.on(CHANNEL.paneKey, forward);
    return () => {
      ipcRenderer.off(CHANNEL.paneKey, forward);
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

  deleteConversation(path: string, where?: Where): Promise<Result<readonly Conversation[]>> {
    return ipcRenderer.invoke(CHANNEL.deleteConversation, path, named(where)) as Promise<
      Result<readonly Conversation[]>
    >;
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

  designCommit(
    changes: DesignChange,
    where?: Where,
  ): Promise<Result<readonly SavedVersion[]>> {
    const tokens = changes.tokens;
    const motions = changes.motions;
    if (!Array.isArray(tokens) || !Array.isArray(motions)) {
      return Promise.resolve(refuse<readonly SavedVersion[]>('I could not tell what to change.'));
    }
    if (tokens.some((one) => typeof one?.name !== 'string' || typeof one?.value !== 'string')) {
      return Promise.resolve(refuse<readonly SavedVersion[]>('I could not tell what to change.'));
    }
    if (motions.some((one) => !Array.isArray(one?.places) || typeof one?.change !== 'object' || one.change === null)) {
      return Promise.resolve(refuse<readonly SavedVersion[]>('I could not change that.'));
    }
    return ipcRenderer.invoke(CHANNEL.designCommit, changes, named(where)) as Promise<
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

  connection(fresh?: boolean): Promise<Result<ConnectionState>> {
    return ipcRenderer.invoke(CHANNEL.connection, fresh === true) as Promise<Result<ConnectionState>>;
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

  selectAdvisor(choice: ModelChoice | null, where?: Where): Promise<Result<Preferences>> {
    if (choice === null) {
      return ipcRenderer.invoke(CHANNEL.selectAdvisor, null, null, named(where)) as Promise<
        Result<Preferences>
      >;
    }
    if (
      typeof choice !== 'object' ||
      typeof choice.providerId !== 'string' ||
      typeof choice.modelId !== 'string'
    ) {
      return Promise.resolve(refuse<Preferences>('I could not tell which model you meant.'));
    }
    return ipcRenderer.invoke(
      CHANNEL.selectAdvisor,
      choice.providerId,
      choice.modelId,
      named(where),
    ) as Promise<Result<Preferences>>;
  },

  setAdvisorThinking(level: ThinkingLevel, where?: Where): Promise<Result<Preferences>> {
    if (typeof level !== 'string') {
      return Promise.resolve(refuse<Preferences>('I could not tell how long you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.setAdvisorThinking, level, named(where)) as Promise<
      Result<Preferences>
    >;
  },

  setAdvisorGate(
    which: 'completionGate' | 'loopGate',
    on: boolean,
    where?: Where,
  ): Promise<Result<Preferences>> {
    return ipcRenderer.invoke(CHANNEL.setAdvisorGate, which, on, named(where)) as Promise<
      Result<Preferences>
    >;
  },

  setAddons(choice: 'on' | 'tools-only', where?: Where): Promise<Result<Preferences>> {
    return ipcRenderer.invoke(CHANNEL.setAddons, choice, named(where)) as Promise<
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

  tokenUsage(): Promise<Result<TokenUsageView | null>> {
    return ipcRenderer.invoke(CHANNEL.tokenUsage) as Promise<Result<TokenUsageView | null>>;
  },

  pageAt(
    address: string | null,
    bounds: { x: number; y: number; width: number; height: number } | null,
    again?: boolean,
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
    return ipcRenderer.invoke(CHANNEL.pageAt, address, bounds, again === true) as Promise<Result<null>>;
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

  setHoldBack(on: boolean, where?: Where): Promise<Result<Preferences>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.setHoldBack, on, named(where)) as Promise<Result<Preferences>>;
  },

  setKeepLogins(on: boolean, where?: Where): Promise<Result<Preferences>> {
    if (typeof on !== 'boolean') {
      return Promise.resolve(refuse<Preferences>('I could not tell whether that was on or off.'));
    }
    return ipcRenderer.invoke(CHANNEL.setKeepLogins, on, named(where)) as Promise<Result<Preferences>>;
  },

  setTheme(theme: string): Promise<Result<Preferences>> {
    const known = ['system', 'light', 'graphe', 'super', 'pink', 'slate', 'dark'];
    if (typeof theme !== 'string' || !known.includes(theme)) {
      return Promise.resolve(refuse<Preferences>('I could not tell which theme you meant.'));
    }
    return ipcRenderer.invoke(CHANNEL.setTheme, theme) as Promise<Result<Preferences>>;
  },

  setHowMuch(id: string): Promise<Result<Preferences>> {
    if (typeof id !== 'string' || id.trim() === '') {
      return Promise.resolve(refuse<Preferences>('I could not tell which line that was.'));
    }
    return ipcRenderer.invoke(CHANNEL.setHowMuch, id) as Promise<Result<Preferences>>;
  },

  decideOnWork(letIn: boolean, observed: boolean, where?: Where): Promise<Result<Decided>> {
    if (typeof letIn !== 'boolean' || typeof observed !== 'boolean') {
      return Promise.resolve(refuse<Decided>('I could not tell what you decided.'));
    }
    return ipcRenderer.invoke(CHANNEL.decideOnWork, letIn, observed, named(where)) as Promise<Result<Decided>>;
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

  awayEverywhere(): Promise<Result<readonly AwayNotice[]>> {
    return ipcRenderer.invoke(CHANNEL.awayEverywhere) as Promise<Result<readonly AwayNotice[]>>;
  },
  connectedLook(where?: Where): Promise<Result<ConnectedState>> {
    return ipcRenderer.invoke(CHANNEL.connectedLook, named(where)) as Promise<Result<ConnectedState>>;
  },
  connectedCheck(name: string, where?: Where): Promise<Result<ConnectedHealth>> {
    return ipcRenderer.invoke(CHANNEL.connectedCheck, name, named(where)) as Promise<Result<ConnectedHealth>>;
  },
  connectedSave(tools: readonly Connected[], where?: Where): Promise<Result<ConnectedState>> {
    return ipcRenderer.invoke(CHANNEL.connectedSave, tools, named(where)) as Promise<Result<ConnectedState>>;
  },
  changesLook(where?: Where): Promise<Result<string>> {
    return ipcRenderer.invoke(CHANNEL.changesLook, named(where)) as Promise<Result<string>>;
  },
  changesDrop(patch: string, where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.changesDrop, patch, named(where)) as Promise<Result<null>>;
  },
  takeBackQueue(where?: Where): Promise<Result<{ steering: readonly string[]; followUp: readonly string[] }>> {
    return ipcRenderer.invoke(CHANNEL.takeBackQueue, named(where)) as Promise<
      Result<{ steering: readonly string[]; followUp: readonly string[] }>
    >;
  },
  away(where?: Where): Promise<Result<Away>> {
    return ipcRenderer.invoke(CHANNEL.away, named(where)) as Promise<Result<Away>>;
  },

  keepGoing(text: string, untilDone?: boolean, where?: Where): Promise<Result<Away>> {
    if (typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve(refuse<Away>('There was nothing to get on with.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepGoing, text, untilDone === true, named(where)) as Promise<
      Result<Away>
    >;
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

  sayToAway(id: string, text: string, where?: Where): Promise<Result<Away>> {
    if (typeof id !== 'string' || id.trim() === '' || typeof text !== 'string' || text.trim() === '') {
      return Promise.resolve(refuse<Away>('There was nothing to say.'));
    }
    return ipcRenderer.invoke(CHANNEL.sayToAway, id, text, named(where)) as Promise<Result<Away>>;
  },

  keepSet(ids: readonly string[], where?: Where): Promise<Result<Away>> {
    if (!Array.isArray(ids) || ids.some((one) => typeof one !== 'string' || one.trim() === '')) {
      return Promise.resolve(refuse<Away>('I could not tell which pieces of work those were.'));
    }
    return ipcRenderer.invoke(CHANNEL.keepSet, [...ids], named(where)) as Promise<Result<Away>>;
  },

  compareWays(ways: string, where?: Where): Promise<Result<readonly SideOfWork[]>> {
    if (typeof ways !== 'string' || ways.trim() === '') {
      return Promise.resolve(refuse<readonly SideOfWork[]>('There was nothing to compare.'));
    }
    return ipcRenderer.invoke(CHANNEL.compareWays, ways, named(where)) as Promise<
      Result<readonly SideOfWork[]>
    >;
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

  onBuildPlan(
    listener: (notice: { project: string; address: string; plan: BuildPlan | null }) => void,
  ): () => void {
    const forward = (
      _source: IpcRendererEvent,
      notice: { project: string; address: string; plan: BuildPlan | null },
    ): void => {
      listener(notice);
    };
    ipcRenderer.on(CHANNEL.buildPlanChanged, forward);
    return () => {
      ipcRenderer.off(CHANNEL.buildPlanChanged, forward);
    };
  },

  onContinuation(listener: (notice: ContinuationNotice) => void): () => void {
    const forward = (_source: IpcRendererEvent, notice: ContinuationNotice): void => {
      listener(notice);
    };
    ipcRenderer.on(CHANNEL.continuation, forward);
    return () => {
      ipcRenderer.off(CHANNEL.continuation, forward);
    };
  },

  continuationStop(where?: Where): Promise<Result<null>> {
    return ipcRenderer.invoke(CHANNEL.continuationStop, where);
  },

  onMenu(listener: (notice: { id: string }) => void): () => void {
    const forward = (_source: IpcRendererEvent, notice: { id: string }): void => {
      listener(notice);
    };
    ipcRenderer.on(CHANNEL.fromMenu, forward);
    return () => {
      ipcRenderer.off(CHANNEL.fromMenu, forward);
    };
  },

  diagnostics(): Promise<Result<string>> {
    return ipcRenderer.invoke(CHANNEL.diagnostics);
  },

  keepCredential(name: string, value: string): Promise<Result<{ ok: boolean; why?: string }>> {
    return ipcRenderer.invoke(CHANNEL.keepCredential, name, value);
  },

  credentialsKept(): Promise<Result<{ canKeep: boolean; held: readonly string[] }>> {
    return ipcRenderer.invoke(CHANNEL.credentialsKept);
  },

  appVersion(): Promise<Result<string>> {
    return ipcRenderer.invoke(CHANNEL.appVersion);
  },

  longJobs(providerId: string, modelId: string): Promise<Result<string | null>> {
    return ipcRenderer.invoke(CHANNEL.longJobs, providerId, modelId);
  },

  addons(): Promise<Result<{ says: Readonly<Record<string, string>>; running: number }>> {
    return ipcRenderer.invoke(CHANNEL.addons);
  },

  storage(): Promise<Result<{ says: string; couldClear: number; because: string }>> {
    return ipcRenderer.invoke(CHANNEL.storage);
  },

  clearFinishedWork(): Promise<Result<{ removed: number; freed: number; says: string }>> {
    return ipcRenderer.invoke(CHANNEL.clearFinishedWork);
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
