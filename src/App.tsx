import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import ActivityLine from "./components/ActivityLine";
import { Shown } from "./components/Shown";
import AskFirst from "./components/AskFirst";
import type { Attachment } from "./components/Attachments";
import BuildProgress from "./components/BuildProgress";
import Composer from "./components/Composer";
import ConfirmChange from "./components/ConfirmChange";
import ConnectModal from "./components/ConnectModal";
import CostMeter from "./components/CostMeter";
import DesignView, { type DesignPart } from "./components/DesignView";
import HistoryView from "./components/HistoryView";
import ReviewsView, { reviewPrompt } from "./components/ReviewsView";
import ErrorCard from "./components/ErrorCard";
import Files from "./components/Files";
import FileView from "./components/FileView";
import HelperRail from "./components/HelperRail";
import HelpersView from "./components/HelpersView";
import InLine from "./components/InLine";
import Message from "./components/Message";
import type { Outcome } from "./components/Landing";
import Overview from "./components/Overview";
import PlanCard from "./components/PlanCard";
import ReviewCard from "./components/ReviewCard";
import WorkingMark from "./components/WorkingMark";
import AddMore from "./components/AddMore";
import ProjectMenu from "./components/ProjectMenu";
import ProjectPicker from "./components/ProjectPicker";
import BrowserPane, { type Room as PaneRoom } from "./components/BrowserPane";
import EvidenceReel from "./components/EvidenceReel";
import Running from "./components/Running";
import { asksAbout } from "./preview/point";
import { ATTACH_WORDS, pictureType, readsPictures } from "./lib/attachments";
import type { Answers } from "./agent/asking";
import { PLAN_WORDS, decidedMessage, type PlanDecision } from "./agent/plan";
import { reviewAsMarkdown } from "./agent/pi/review";
import { saysUseYours } from "./design/drift";
import { gateOf, howMuchBy } from "./design/gate";
import { holdsBack } from "./projects/heldback";
import { NOTHING_WATCHED, watching, type Watched } from "./preview/watching";
import { keepsLogins } from "./projects/logins";
import { drainStarted } from "./lib/queue";
import type { ReviewVerdict, RunningPiece } from "./agent/types";
import type { ConnectedState } from "./lib/ipc";
import Settings, { type SettingsLink } from "./components/Settings";
import Connected from "./components/Connected";
import Palette from "./components/Palette";
import Changes from "./components/Changes";
import Against from "./components/Against";
import { parseDiff, undoOf } from "./diff/hunks";
import { REACHABLE, alreadyReached, asServer } from "./agent/pi/reach";
import Usage from "./components/Usage";
import Sidebar from "./components/Sidebar";
import Skills from "./components/Skills";
import Tabs, { type Tab } from "./components/Tabs";
import Steps from "./components/Steps";
import ThinkingWith from "./components/ThinkingWith";
import VisualDiff from "./components/VisualDiff";
import Welcome from "./components/Welcome";
import Gallery from "./gallery/Gallery";
import AskAnything from "./components/AskAnything";
import type { Found, Things } from "./lib/anything";
import type { Task } from "./cost/estimate";
import {
  busyService,
  longConversation,
  meter,
  nothingSpentYet,
  retryHonesty,
  sessionSummary,
} from "./cost/phrasing";
import { sizeUp } from "./cost/sizing";
import { parseProposal, shouldLookFirst } from "./agent/plan";
import {
  asLinesOfEnquiry,
  asResearch,
  chosenDepth,
  implementationPlanFromResearch,
  lookingInto,
  stepsNotOnTheList,
} from "./agent/research";
import { asBuildRequest } from "./work/buildbrief";
import { readDesign } from "./design/reading";
import { writeToken } from "./design/tokens";
import { bridge } from "./lib/bridge";
import { lastSaid } from "./lib/describe";
import { quote, smallerFirst } from "./lib/estimating";
import { rows } from "./lib/steps";
import { durationInWords } from "./lib/when";
import {
  showWords,
  swapWords,
  type Away as AwayState,
  type CarriedExtension,
  type EveryKind,
  type ConnectStep,
  type ConnectionState,
  type Decision,
  type FileEntry,
  type FoundAccount,
  type ModelChoice,
  type Conversation,
  type InStep as InStepState,
  type Landing as LandingState,
  type Look,
  type Move,
  type Pack,
  type Page,
  type Preferences,
  type PromptAttachment,
  type ProviderMethod,
  type RecentProject,
  type RepoItem,
  type RepoLook,
  type Result,
  type Room as RoomState,
  type SideOfWork,
  type Skill,
  type Workflow,
  type HowFar,
  type Money,
  type AlwaysDoes,
  type SavedVersion,
  type Overview as OverviewNow,
  type ShowProgress,
  type SpendLimit,
  type ThinkingLevel,
  type Trouble,
  type VisualChange,
  type Where,
} from "./lib/ipc";
import { modelKey } from "./lib/ipc";
import { usePrefersReducedMotion } from "./lib/motion";
import { keeping } from "./projects/kept";
import { behind } from "./lib/showme";
import { ownCopyWhere } from "./lib/owncopy";
import {
  changeCurrent,
  changeDesk,
  closeDesk,
  parkThread,
  threadsIn,
  currentDesk,
  helpersRunning,
  intoTheBox,
  noDesks,
  nowDoing,
  openDesk,
  receive,
  researchLog,
  tookBack,
  recordedIn,
  type Desk,
  type Desks,
  type Recorded,
  type Reference,
  folderCalled,
} from "./lib/projects";
import {
  applyEvent,
  askingYou,
  estimated,
  said,
  withTrouble,
  STOPPED_PART_WAY,
  type EstimateTurn,
  type Turn,
} from "./lib/thread";
import { markFor, themeFrom, type Theme } from "./lib/theme";
import "./App.css";

/** /?gallery renders every component on one page instead of the app, so the UI
 *  can be screenshotted and reviewed in both themes. Read once, at module load. */
const showGallery = new URLSearchParams(window.location.search).has("gallery");

/** /?open=<name> opens one of the preview's own projects on load, so the states
 *  that only exist once a folder is open — the version rail, the strip with the
 *  project's name in it — can be screenshotted without a desktop shell under the
 *  page. Ignored by the app: a window loaded by the shell has no query string. */
const openOnLoad = new URLSearchParams(window.location.search).get("open");

export default function App() {
  return showGallery ? <Gallery /> : <Conversation />;
}

/* -------------------------------------------------------------------------- */
/* What is said when there is no folder yet                                    */
/* -------------------------------------------------------------------------- */

/** Said once, calmly, above anything Graphe did not write. */
const SOMEBODY_ELSES =
  'These are made by other people, and adding one runs their code on your computer alongside your work. Only add things you recognise.';

const NO_FOLDER_YET =
  "Before I can start I need to know which folder your project lives in. Send that again when you have picked one.";

/** The last thing said in a conversation, for the pill that stands in for it
 *  while the page has the window. One line, so it is a reminder of where you
 *  are rather than a second thread to read. */
function lastSaidIn(desk: Desk | null): string | null {
  if (desk === null) return null;
  for (let index = desk.turns.length - 1; index >= 0; index -= 1) {
    const turn = desk.turns[index];
    if (turn?.kind !== 'said') continue;
    const words = turn.text.trim().replace(/\s+/g, ' ');
    if (words === '') continue;
    return words.length > 60 ? `${words.slice(0, 59)}…` : words;
  }
  return null;
}

/** What a conversation is called, on its tab.
 *
 * The first thing the person said, which is what they would call it themselves.
 * A conversation nobody has spoken in yet has no name to take, and saying so is
 * better than borrowing the folder's. */
function titleOf(turns: readonly Turn[]): string {
  const first = turns.find((turn) => turn.kind === 'said' && turn.from === 'you');
  if (first === undefined || first.kind !== 'said') return 'New conversation';
  const words = first.text.trim().replace(/\s+/g, ' ');
  return words.length > 40 ? `${words.slice(0, 39)}…` : words;
}

/** Recent-project storage is ordered by last use, which is useful for a picker
 * on first launch but hostile to a sidebar someone is scanning. Once the UI has
 * shown a project order, preserve that spatial order: refresh the entries in
 * place, remove forgotten folders, and put only genuinely new folders at the
 * end. Selecting a project must move the selection, never the list. */
function stableProjectOrder(
  previous: readonly RecentProject[] | null,
  incoming: readonly RecentProject[],
): readonly RecentProject[] {
  if (previous === null) return incoming;
  const byPath = new Map(incoming.map((project) => [project.path, project]));
  const kept = previous.flatMap((project) => {
    const refreshed = byPath.get(project.path);
    return refreshed === undefined ? [] : [refreshed];
  });
  const known = new Set(previous.map((project) => project.path));
  return [...kept, ...incoming.filter((project) => !known.has(project.path))];
}

/** The label on the button that gets a project ready and opens it. */
const PREVIEW = "Open preview";

/** A picture file, read as the base64 the shell expects — no data: prefix,
 *  which is the one thing that would corrupt the card on the other side. Null
 *  when the file cannot be read, in which case the picture simply does not go
 *  (the reference it belongs to is already recorded, so the overview still
 *  tells the true story of what this message was about). */
function pictureBytes(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? null : result.slice(comma + 1));
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------------------------- */
/* Where a before-and-after sits in the conversation                           */
/* -------------------------------------------------------------------------- */

/** One before-and-after, and the turn it arrived after. Null when it arrived
 *  before anything had been said, which only happens on a first launch. */
type Pinned = { change: VisualChange; after: string | null };

/** One file, open. `text` is null while it is on its way; `trouble` is the one
 *  sentence saying why it cannot be shown at all. */
type Reading = { path: string; text: string | null; trouble: string | null };

/**
 * Sort the pictures into the turns they belong under.
 *
 * A pin whose turn is no longer in the conversation — dismissed, or from a
 * thread that has been cleared — is not thrown away; it goes to the end, where
 * it is still true and still about the last thing that happened. Dropping it
 * instead would mean an error card being dismissed silently taking a picture of
 * somebody's page with it.
 */
function sortPictures(
  pictures: readonly Pinned[],
  turns: readonly Turn[],
): { under: Map<string, Pinned[]>; last: Pinned[] } {
  const known = new Set(turns.map((turn) => turn.id));
  const under = new Map<string, Pinned[]>();
  const last: Pinned[] = [];

  for (const picture of pictures) {
    if (picture.after === null || !known.has(picture.after)) {
      last.push(picture);
      continue;
    }
    const already = under.get(picture.after);
    if (already === undefined) under.set(picture.after, [picture]);
    else already.push(picture);
  }

  return { under, last };
}

/* -------------------------------------------------------------------------- */
/* Design edits held in the window                                             */
/* -------------------------------------------------------------------------- */

/**
 * The stylesheet with the window's unsaved design edits laid over it.
 *
 * The design view reads the stylesheet from disk, so with a draft held in the
 * window that reading needs a copy with the draft values substituted in — the
 * sliders and the readings describe what is being tested, not only what the
 * project already is. Nothing is written; the project only changes when
 * `commitDesign` files the draft.
 */
function withDesignDraft(
  styles: { file: string; tokens: readonly import("./lib/ipc").StyleToken[]; text: string } | null,
  draft: { tokens: Record<string, string> } | undefined,
): { file: string; tokens: readonly import("./lib/ipc").StyleToken[]; text: string } | null {
  if (styles === null || draft === undefined) return styles;
  const names = Object.keys(draft.tokens);
  if (names.length === 0) return styles;
  let text = styles.text;
  for (const name of names) {
    const value = draft.tokens[name];
    if (value === undefined) continue;
    const next = writeToken(text, name, value);
    if (next !== text) text = next;
  }
  const tokens = styles.tokens.map((token) => {
    const value = draft.tokens[token.name];
    return value === undefined ? token : { ...token, value };
  });
  return { file: styles.file, text, tokens };
}

/* -------------------------------------------------------------------------- */
/* The app                                                                     */
/* -------------------------------------------------------------------------- */

function Conversation() {
  /**
   * A desk per project, and nothing shared between them.
   *
   * The conversation, the meter and the versions all live on the desk, so
   * switching folders swaps all three in one `setState` and there is no moment
   * where the thread on screen belongs to one project and the money to another
   * (BACKLOG B2). See src/lib/projects.ts for the whole of it.
   */
  const [desks, setDesks] = useState<Desks>(noDesks);
  const desk = currentDesk(desks);
  /* The front conversation is busy when its own stream is live — not when some
     other tab is running, which is different work and must not turn this one's
     Send into Stop. Same test the tab row uses for its working dot. */
  /* Busy is what the turns show, plus the window's own "sent and waiting"
     window — the gap between pressing Send and the first visible step, when
     the model is thinking and nothing has arrived yet. `busyConversation` is
     set in `deliver` and cleared when the shell answers, so a second thought
     in that gap lands on the queue buttons instead of a raw error. */
  /** How many sends each conversation has in the air. `busy` is window-wide (it
   *  also covers picking a folder), so tabs need this narrower identity.
   *
   * A count rather than one name, because two sends overlap all the time: queue
   * a second thought behind a running turn and both belong to this
   * conversation. Holding one name meant the first to finish cleared it while
   * the second was still going, and the quiet mark went out until the next
   * visible step arrived. Read by `frontBusy` below, so it lives above it. */
  const [sendsInTheAir, setSendsInTheAir] = useState<Readonly<Record<string, number>>>({});
  const holdSend = useCallback((owner: string) => {
    setSendsInTheAir((current) => ({ ...current, [owner]: (current[owner] ?? 0) + 1 }));
  }, []);
  const letSendGo = useCallback((owner: string) => {
    setSendsInTheAir((current) => {
      const left = (current[owner] ?? 0) - 1;
      if (left > 0) return { ...current, [owner]: left };
      const { [owner]: _gone, ...rest } = current;
      return rest;
    });
  }, []);
  /** Whether a running row is already on screen carrying the motion — a
   *  streaming reply, a step in progress, a tidy. The quiet mark only fills
   *  the silent gaps of a run, so the two never speak at once. */
  const runningNow =
    desk !== null &&
    desk.turns.some(
      (turn) =>
        (turn.kind === 'said' && turn.from === 'graphe' && turn.streaming) ||
        (turn.kind === 'did' && turn.state === 'running') ||
        (turn.kind === 'tidying' && turn.state === 'running'),
    );
  const frontBusy =
    (desk !== null &&
      desk.turns.some(
        (turn) =>
          (turn.kind === 'said' && turn.from === 'graphe' && turn.streaming) ||
          (turn.kind === 'did' && turn.state === 'running') ||
          (turn.kind === 'tidying' && turn.state === 'running'),
      )) ||
    (desk !== null && (sendsInTheAir[`${desk.path}\u0000${desk.address ?? ''}`] ?? 0) > 0);

  /** What this computer remembers. Null until the shell has been asked — which
   *  is not the same as an empty list, and the two states look different: one is
   *  a first launch, the other is a launch we have not finished yet. */
  const [recent, setRecent] = useState<readonly RecentProject[] | null>(null);
  /** True while the picker is hanging under the project's name as a switcher. */
  const [switching, setSwitching] = useState(false);
  /** The screens of the project in front, so the bar can open any of them.
   *  Asked for once when a folder opens — pages are a fact about the project,
   *  not about the sitting. */
  const [pages, setPages] = useState<readonly Page[]>([]);
  /** The one bar that reaches everything. Openable by hand as well as by key —
   *  a shortcut nobody is told about is a feature nobody has. */
  const [asking, setAsking] = useState(false);
  /** The conversations this project has had, and which one is on screen. */
  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [inConversation, setInConversation] = useState<string | null>(null);
  /** Whether the conversation on screen works on its own copy of the project.
   *  Only the shell knows, and only about the one it just put in front, so this
   *  is replaced on every swap rather than accumulated. */
  const [ownCopyHere, setOwnCopyHere] = useState(false);
  /** Every size the project designs at, once somebody has asked for them. */
  const [looks, setLooks] = useState<{ looks: readonly Look[]; says: string }>({
    looks: [],
    says: '',
  });
  const [checkingWidths, setCheckingWidths] = useState(false);
  /** The size being worked at. It lasts as long as the window does: it is what
   *  somebody is looking at now, not a setting about the project. */
  const [workingAt, setWorkingAt] = useState<string | null>(null);
  /** The screen where more can be added to Graphe, and what it is showing. */
  const [addMore, setAddMore] = useState(false);
  const [packs, setPacks] = useState<readonly Pack[]>([]);
  /** What the open project brought with it, and which of those are loaded. Read
   *  when the screen opens: it changes only when a session is built. */
  const [carried, setCarried] = useState<readonly CarriedExtension[]>([]);
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Readonly<Record<string, string>>>({});
  /** Whether a message gets a looking-around pass before anything is touched.
   *  `auto` decides from the sentence, which is what almost everybody wants;
   *  the other two are for somebody who has an opinion about this one. */
  const [plans, setPlans] = useState<'auto' | 'always' | 'never' | 'research'>('auto');
  /** Research is a one-message choice. While that one run is live, its model
   *  output is kept by conversation so an explicit IMPLEMENTATION PLAN section
   *  can become the build checklist. No word matching decides the next action. */
  const researchRuns = useRef(new Set<string>());
  const researchReports = useRef<Record<string, string>>({});
  /** What was asked for while a plan is being made, so approving it can send
   *  the same sentence rather than a reconstruction of it. */
  const asked = useRef<string>("");
  /** True while what somebody types next is the answer to a look-around.
   *
   * A plan is followed by "now do it", and the words people reach for there are
   * the same ones that made it look around to begin with — "implement the
   * redesign", "build all of it". Judged again by the same rule, that plans the
   * plan, and the answer never gets built. So the message after a look-around
   * never triggers another, and the one after that is judged fresh. No word
   * list and no guessing at intent: the only thing remembered is that we asked. */
  const justLookedFirst = useRef(false);
  /** A project that would not open, said beside the picker rather than in a
   *  conversation that does not exist yet. */
  const [pickerTrouble, setPickerTrouble] = useState<{
    path: string;
    trouble: Trouble;
  } | null>(null);

  /**
   * What this person has chosen about the app itself, and what this machine can
   * offer them (BACKLOG D1, D2).
   *
   * Both are asked for once, on the way in. `showMe` starts off — the default is
   * load-bearing, because for the audience this product exists for a second line
   * of machinery under every step is the exact texture of the tools they came
   * here to avoid. Once somebody turns it on, the shell remembers, and it stays
   * on until they say otherwise.
   */
  const [preferences, setPreferences] = useState<Preferences>({
    showMe: false,
    model: null,
    thinking: {},
    kept: {},
    showFiles: false,
    heldBack: {},
    keptLogins: {},
    howMuch: null,
    ceiling: null,
    theme: 'system',
  });
  const [editor, setEditor] = useState<string | null>(null);

  /* ------------------------------------------------------------- connecting */

  /** Whether the connect screen is up. Null before the shell has ever been
   *  asked, so the first open does not flash an empty list. */
  const [connectOpen, setConnectOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  /** The step the connection in progress is on, or null when it is not. */
  const [connectStep, setConnectStep] = useState<ConnectStep | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  /** What the last attempt said when it failed, or null. */
  const [connectFailure, setConnectFailure] = useState<string | null>(null);
  /** The accounts opencode and Codex have saved on this computer. Asked for
   *  each time the screen opens, so a key pasted into opencode while this app
   *  was running is there when the screen opens. */
  const [discovered, setDiscovered] = useState<readonly FoundAccount[]>([]);
  /** The account being brought over right now, or null. */
  const [importing, setImporting] = useState<FoundAccount | null>(null);

  /** The folder somebody asked for and could not have, because nothing was
   *  connected yet. Without it, connecting an account left the folder shut and
   *  the next sentence went to a window with no session behind it. */
  const waitingFor = useRef<string | null>(null);
  /** The current `open`, reachable from the connect callbacks declared above it. */
  const openRef = useRef<((path: string) => Promise<void>) | null>(null);

  /** Connecting finished, so finish what the person was actually doing. */
  const resumeWaiting = useCallback(() => {
    const path = waitingFor.current;
    if (path === null) return;
    void openRef.current?.(path);
  }, []);

  /** Ask the shell for the whole state of "who can think for me". Rebuilt
   *  after every connect, disconnect and model choice — the shell owns the
   *  truth, and the window's job is to draw it, not to remember it. */
  const refreshConnection = useCallback((fresh = false) => {
    return bridge.connection(fresh).then((answer) => {
      if (answer.ok) setConnection(answer.value);
    });
  }, []);

  const refreshSkills = useCallback(() => {
    void bridge.skills().then((answer) => {
      if (answer.ok) setSkills(answer.value);
    });
  }, []);

  /** The other tools this project has plugged in. Read on opening the panel and
   *  after every change, so what is on screen is what is on disk. */
  const refreshConnected = useCallback(async () => {
    const answer = await bridge.connectedLook();
    if (answer.ok) setConnected(answer.value);
  }, []);

  const refreshWorkflows = useCallback(() => {
    void bridge.workflows().then((answer) => {
      if (answer.ok) setWorkflows(answer.value);
    });
  }, []);

  useEffect(() => {
    refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    refreshSkills();
    refreshWorkflows();
  }, [desks.current, refreshSkills, refreshWorkflows]);

  /** Follow along while a connection happens. Each step is one moment of the
   *  provider's sign-in — a browser it opened, a question it asked. The step
   *  is kept for as long as the modal is up and then let go. */
  useEffect(
    () =>
      bridge.onConnectStep((step) => {
        setConnectStep(step);
      }),
    [],
  );

  const openConnect = useCallback(() => {
    setConnectFailure(null);
    setConnectStep(null);
    setConnectOpen(true);
    refreshConnection();
    void bridge.discoveredAccounts().then((answer) => {
      if (answer.ok) setDiscovered(answer.value);
    });
  }, [refreshConnection]);

  /** Reached from the shelf and from the project's name, so it lives here
   *  rather than at either call site. */
  const openAddMore = useCallback(() => {
    setSwitching(false);
    setAddMore(true);
    void bridge.packages().then((answer) => {
      if (answer.ok) setPacks(answer.value);
    });
    void bridge.carried().then((answer) => {
      if (answer.ok) setCarried(answer.value);
    });
    // Which of the vouched-for tools this project already has, so the shelf
    // says "connected" rather than offering one that is already on.
    void bridge.connectedLook().then((answer) => {
      if (answer.ok) setConnected(answer.value);
    });
  }, []);


  /** Bring an account opencode or Codex saved over into this app's own store.
   *  The shell does the moving; here is only the waiting and the telling. */
  const importAccount = useCallback(
    (account: FoundAccount) => {
      setImporting(account);
      void bridge.importAccount(account).then((answer) => {
        setImporting(null);
        if (!answer.ok) {
          setConnectFailure(answer.trouble.because);
          return;
        }
        setConnectFailure(null);
        refreshConnection();
        void bridge.discoveredAccounts().then((found) => {
          if (found.ok) setDiscovered(found.value);
        });
        resumeWaiting();
      });
    },
    [refreshConnection, resumeWaiting],
  );

  const closeConnect = useCallback(() => {
    if (connectBusy) {
      void bridge.cancelConnect();
      setConnectBusy(false);
    }
    setConnectOpen(false);
    // Closing this screen is somebody saying they are done here. If they came
    // to it because a folder would not open, that folder is what they were
    // actually trying to do — so it opens now, without being asked for twice.
    resumeWaiting();
  }, [connectBusy, resumeWaiting]);

  const startConnect = useCallback(
    (providerId: string, method: ProviderMethod) => {
      setConnectFailure(null);
      setConnectStep(null);
      setConnectBusy(true);
      void bridge.connect(providerId, method).then((answer) => {
        setConnectBusy(false);
        if (!answer.ok) {
          setConnectFailure(answer.trouble.because);
          return;
        }
        if (answer.value.kind === "failed") {
          setConnectFailure(answer.value.because);
          return;
        }
        setConnectStep(null);
        refreshConnection();
        resumeWaiting();
      });
    },
    [refreshConnection, resumeWaiting],
  );

  const answerConnect = useCallback((promptId: string, value: string | null) => {
    void bridge.connectAnswer(promptId, value);
  }, []);

  const cancelConnect = useCallback(() => {
    void bridge.cancelConnect();
    setConnectBusy(false);
    setConnectStep(null);
  }, []);


  /** "Take more time": how long the chosen model thinks before it answers,
   *  remembered per model and applied to the conversation in front of us now,
   *  not only to the next one. */
  const changeThinking = useCallback(
    (choice: ModelChoice, level: ThinkingLevel) => {
      void bridge.setThinking(choice, level).then((answer) => {
        if (!answer.ok) return;
        setPreferences(answer.value);
        setConnection((current) =>
          current === null ? current : { ...current, chosenThinking: level },
        );
      });
    },
    [],
  );

  const disconnect = useCallback(
    (providerId: string) => {
      void bridge.disconnect(providerId).then(() => {
        refreshConnection();
        // An account that was carried over and then forgotten is an account
        // the other tool still has — it belongs back in the found list.
        void bridge.discoveredAccounts().then((answer) => {
          if (answer.ok) setDiscovered(answer.value);
        });
        setConnection((current) => {
          if (current === null) return current;
          return {
            ...current,
            providers: current.providers.map((provider) =>
              provider.providerId === providerId
                ? { ...provider, connected: false, available: false }
                : provider,
            ),
          };
        });
      });
    },
    [refreshConnection],
  );

  /**
   * The before-and-afters, per project, each pinned to the moment it belongs to
   * (BACKLOG F2).
   *
   * Pictures are taken after a turn has already settled and can take a while to
   * arrive — a project that has to be built first is half a minute of work — so
   * by the time one lands the conversation may well have moved on. Pinning it to
   * the last thing that had been said when the turn ended is what keeps it under
   * the change it describes rather than at the bottom of whatever is happening
   * now.
   */
  const [changes, setChanges] = useState<Record<string, readonly Pinned[]>>({});
  /** What each version looked like, per project. Asked for whenever the
   *  timeline is, and never per row: the rail draws a card for every moment of
   *  the afternoon and reading a picture inside one would be a disk on hover. */
  const [versionPictures, setVersionPictures] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});
  /** Read inside the listener below, which is subscribed once and must not be
   *  torn down and rebuilt every time somebody says something. */
  const desksNow = useRef(desks);
  desksNow.current = desks;
  /** Last project/conversation navigation request. Only its response may change
   *  what is in front; IPC replies can arrive out of order. */
  const navigation = useRef(0);

  /** The folders open right now, in the order the tabs draw them, so ⌘1–9 lands
   *  on the tab somebody is looking at rather than on a stale list. */
  const openNow = useRef<readonly string[]>([]);
  /** Read by the keyboard, which is subscribed once and must not be torn down
   *  and rebuilt every time a tab changes state. */
  const goToTabNow = useRef<(id: string) => Promise<void>>(async () => {});
  const closeTabNow = useRef<(id: string) => Promise<void>>(async () => {});
  /** Which tab is in front, and which one is waiting on a person. */
  const atNow = useRef<string | null>(null);
  const wantsYouNow = useRef<string | undefined>(undefined);

  /** Whether the shelf is open. Deliberately not remembered across launches —
   *  it is a thing people flip all the time and it costs nothing to reset. */
  const [shelfOpen, setShelfOpen] = useState(true);

  /** Light, dark, or whatever the computer is set to. Kept on this computer
   *  rather than per project — it is about the person, not the work. */
  const [theme, setTheme] = useState<Theme>(() =>
    themeFrom(typeof localStorage === 'undefined' ? null : localStorage.getItem('graphe:theme')),
  );

  useEffect(() => {
    const mark = markFor(theme);
    // Removing it is the point of "follow this computer": the stylesheet's own
    // prefers-color-scheme block then decides, and keeps deciding.
    if (mark === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mark);
    // Diagrams are drawn in the palette that was on screen when they rendered;
    // this is their cue to draw again.
    window.dispatchEvent(new Event('graphe:theme'));
    try {
      localStorage.setItem('graphe:theme', theme);
    } catch {
      // A window with no storage still gets the theme, just not next time.
    }
  }, [theme]);

  const changeTheme = useCallback(
    (next: Theme) => {
      const wanted = themeFrom(next);
      setTheme(wanted);
      // Persist to preferences.json (desktop) and keep the in-memory copy in sync
      // so the next launch reads the same value without waiting for the async reply.
      setPreferences((was) => ({ ...was, theme: wanted }));
      void bridge.setTheme(wanted).then((answer) => {
        if (answer.ok) setPreferences(answer.value);
      });
    },
    [],
  );
  /** The project file rail keeps its setting when folded, just like the main
   *  sidebar: showing it again is one press rather than a trip to settings. */
  const [filesOpen, setFilesOpen] = useState(true);
  /* Once a project has earned its right rail, keep that shell mounted for the
     sitting. Snapshot and status refreshes arrive independently of agent events;
     deriving the rail directly from each one made it blink out for a frame and
     reflow the conversation under a running response. */
  const overviewSeen = useRef(new Set<string>());
  const [skillsOpen, setSkillsOpen] = useState(false);
  /** What is waiting behind the run, as pi holds it. Keyed by conversation, so
   *  a second tab's line is never drawn under this one's. */
  const [queued, setQueued] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  /** The change in the folder, read when the view opens. Null while reading. */
  const [changeText, setChangeText] = useState<string | null>(null);
  const [connectedOpen, setConnectedOpen] = useState(false);
  const [connected, setConnected] = useState<ConnectedState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [workflows, setWorkflows] = useState<readonly Workflow[]>([]);
  /** What the open project does without being asked. Null until it is read. */
  const [alwaysNow, setAlwaysNow] = useState<AlwaysDoes | null>(null);
  /** Whose history the full-screen graph is drawing, in a folder holding
   *  several projects. Null for a folder that is one project. */
  const [graphRepo, setGraphRepo] = useState<string | null>(null);
  /* Which project the panel is showing, mirrored up so the band at its foot is
     read for the same one its buttons act on. */
  const [panelRepo, setPanelRepo] = useState<string | null>(null);
  const panelRepoNow = useRef<string | null>(null);
  panelRepoNow.current = panelRepo;
  const actingRepoNow = useRef<string | null>(null);
  /* Whose pull requests the reviews screen is showing. A ref beside it, because
     the fetch reads it and re-creating the fetch on every pick would refetch. */
  const [reviewsRepo, setReviewsRepo] = useState<string | null>(null);
  const reviewsRepoNow = useRef<string | null>(null);
  reviewsRepoNow.current = reviewsRepo;

  /** Which band of the design view is open, or null when it is not. Both of the
   *  surfaces that take the whole width live here rather than inside a panel:
   *  they cover the conversation, and the conversation belongs to this file. */
  const [designAt, setDesignAt] = useState<DesignPart | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  /** The github pull requests and issues of the project in front. */
  const [reviewsOpen, setReviewsOpen] = useState(false);
  /** The fetched reading of the open project's repository, and whether a fetch
   *  is in flight. */
  const [repo, setRepo] = useState<RepoLook | null>(null);
  const [reviewsBusy, setReviewsBusy] = useState(false);
  /** The pairing whose colour is on its way to being changed. Cleared the
   *  moment new values arrive, which is what finishing looks like from here. */
  const [fixing, setFixing] = useState<string | null>(null);
  /** Design edits being tested but not yet saved, per project. Nothing here
   *  has touched the project — a slider moves in the view, and only "Save
   *  changes" writes it. Keyed by token name, and appended to for motion. */
  const [designDraft, setDesignDraft] = useState<
    Readonly<
      Record<string, { tokens: Record<string, string>; motions: readonly { places: readonly unknown[]; change: unknown }[] }>
    >
  >({});

  /** True while a turn is still running. */
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  /** When each project's active run began, epoch ms. Kept per project so two
   *  conversations working at once never borrow each other's measure. Used for
   *  the quiet "worked for" line at the end of a long run. */
  const runStartedAt = useRef<Readonly<Record<string, number>>>({});
  /** Whether each project's active run has done real tool work since it
   *  settled last. A settle with no work in it is an answer, not a build step,
   *  and must not advance the tracker. */
  const didWorkSinceSettle = useRef<Readonly<Record<string, boolean>>>({});
  /** A run that is finished and was long enough to be worth a line, with how
   *  long it went for in seconds — kept with the project it belongs to so it
   *  is never drawn under another project's conversation. */
  const [finishedRun, setFinishedRun] = useState<{ owner: string; seconds: number } | null>(null);
  /* Busy is how many operations are in flight, so a turn in one tab stopping
     must not clear the busy another tab is still using. Counted, not a flag. */
  const goBusy = (): void => setBusyCount((count) => count + 1);
  const goQuiet = (): void => setBusyCount((count) => Math.max(0, count - 1));
  /** How full the conversation on screen is, and whether it is being shortened
   *  right now. Asked for rather than counted here: the number is the model's
   *  own reckoning, and only the shell can see it. */
  const [room, setRoom] = useState<RoomState | null>(null);
  const [tidying, setTidying] = useState(false);
  /** Whether the Guard is stopping to ask. Never remembered across launches:
   *  the shell holds it on the session, and a new session asks again. */
  /** How far it may go on its own. Four rungs rather than a switch; it lasts as
   *  long as the window does and is never written down. Somebody who loosened
   *  this a week ago and forgot is the failure this app is a reaction to. */
  const [howFar, setHowFarHere] = useState<HowFar>('asking');
  /** What "See it" is up to, in its own words. Null when it is not up to
   *  anything. */
  const [progress, setProgress] = useState<ShowProgress | null>(null);

  /** Attachments before there is a project to attach them to. Once a folder is
   *  open they live on its desk, like everything else. */
  const [loose, setLoose] = useState<readonly Attachment[]>([]);
  const attachments = desk?.attachments ?? loose;

  /** Attachments, read inside `deliver` the same way `desksNow` is read inside
   *  the listener: `deliver` is rebuilt whenever the desk in front changes,
   *  but the attachments it sends are the ones sitting in the box at the
   *  moment it runs. */
  const attachmentsNow = useRef(attachments);
  attachmentsNow.current = attachments;

  /** Take everything out of the box. Called the moment its contents have been
   *  sent, wherever they were sent from. */
  const emptyTheBox = useCallback(() => {
    setLoose([]);
    setDesks((current) =>
      current.current === null ? current : changeCurrent(current, (one) => ({ ...one, attachments: [] })),
    );
  }, []);

  /** An example from the welcome screen, put in the box ready to be edited.
   *  Never sent on anybody's behalf — a click that spends money on a sentence
   *  the user did not write is exactly the surprise this product exists to
   *  avoid. */
  const [draft, setDraft] = useState("");

  /** How the window is split between the conversation and the project's own
   *  page. Off until somebody opens it. */
  const [pane, setPane] = useState<PaneRoom>('off');
  /** A native page must yield to renderer popovers; it cannot be stacked under
     them with CSS alone. */
  const [composerPopoverOpen, setComposerPopoverOpen] = useState(false);
  /** Read inside the event listener, which is subscribed once and so cannot
   *  close over a changing `pane`. */
  const paneNow = useRef<PaneRoom>('off');
  /** Where the page is pointed. Null until something is being served. */
  const [pageAt, setPageAt] = useState<string | null>(null);
  /** The address the window opened on its own, so it does so once and does not
   *  reopen a pane somebody deliberately closed. */
  const openedItself = useRef<string | null>(null);
  /** Servers and watchers this conversation has kept up. Drawn from what the
   *  shell last said rather than asked for on a clock. */
  const [running, setRunning] = useState<readonly RunningPiece[]>([]);
  /** A set of designs being compared, each served on its own address. Null until
   *  somebody asks for variations. */
  const [variations, setVariations] = useState<{
    subject: string;
    members: readonly { id: string; name: string; address: string }[];
    inFront: string | null;
  } | null>(null);
  /** The build plan for the project in front, as the tracker draws it. Null
   *  until a document-to-build has produced one. Kept with the folder it came
   *  from, so a plan is never drawn under another project's conversation. */
  const [buildPlan, setBuildPlan] = useState<{
    path: string;
    plan: import('./lib/ipc').BuildPlan;
  } | null>(null);
  /** Read inside the one-shot event listener, which cannot close over the
   *  state. */
  const buildPlanNow = useRef(buildPlan);
  buildPlanNow.current = buildPlan;

  /** Move the page between its modes, mirrored into `paneNow` so the one-shot
   *  event listener can tell whether it is open. */
  /** The address the page is on, read inside a callback that must not be
   *  rebuilt when it changes. */
  const pageAtNow = useRef<string | null>(null);

  /** Where the page is drawn. Stable on purpose: the pane reports its box from
   *  an effect, and a callback rebuilt on every render made that effect run on
   *  every render — which, while a turn was working, was constantly. */
  const movedPage = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      void bridge.pageAt(pageAtNow.current, bounds);
    },
    [],
  );

  const movePane = useCallback((next: PaneRoom) => {
    paneNow.current = next;
    setPane(next);
  }, []);
  const togglePane = useCallback(() => {
    setPane((was) => {
      const next = was === 'whole' ? 'split' : was === 'split' ? 'whole' : 'split';
      paneNow.current = next;
      return next;
    });
  }, []);
  /** True while a walkthrough is being recorded in the page. */
  const [recording, setRecording] = useState(false);
  /** The last walkthrough, waiting to be looked through. */
  const [recorded, setRecorded] = useState<Recorded | null>(null);

  /** The ceiling somebody set on spending, or null when they have not set one.
   *  Read from the shell once, and again whenever it is changed here. */
  const [ceiling, setCeiling] = useState<SpendLimit | null>(null);

  /** Which helper the sheet is open on, or null when it is shut. `at` of null
   *  means "open on the newest one". */
  const [helpersAt, setHelpersAt] = useState<{ at: string | null } | null>(null);

  /**
   * Following the reply, until somebody would rather read something else.
   *
   * `use-stick-to-bottom` separates the two cases a scroll effect cannot tell
   * apart: it watches the content with a ResizeObserver, so it knows a scroll it
   * caused from a scroll a person caused, and it lets go the instant the wheel
   * turns upward. Sticking is `instant` in both directions — the thread grows
   * while the reply streams, and animating that would mean the page is
   * permanently gliding under the words somebody is trying to read.
   */
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      initial: "instant",
      resize: "instant",
    });
  const reducedMotion = usePrefersReducedMotion();

  /** Sending a note from the page, read inside a listener subscribed once. Set
   *  below, where the sender and whether a turn is running are both known. */
  const handNow = useRef<(text: string) => void>(() => undefined);

  /* Somebody wrote a note on the page, at the thing it is about.
     
     It goes straight to the agent, the way any other message does: now when
     nothing of theirs is running, behind the turn when something is. Writing a
     note about a button and then having to find the message box, and read a
     paragraph of measurements to check we knew which button, was the whole of
     what made this feel like work. */
  useEffect(() => {
    return bridge.onPointed((at) => {
      // A note with nothing in it is not a message. Nothing is written into the
      // box either: somebody writing on the page is not writing in the box, and
      // finding a paragraph about an element in there is how this felt broken.
      if ((at.pointed.said ?? '').trim() === '') return;
      handNow.current(asksAbout(at.pointed));
    });
  }, []);

  /* Full screen takes the traffic lights away, so the room reserved for them
     goes too. An attribute, because the thing that needs to know is a
     stylesheet. */
  useEffect(() => {
    return bridge.onWindowState((state) => {
      if (state.fullScreen) document.documentElement.dataset["full"] = "yes";
      else delete document.documentElement.dataset["full"];
    });
  }, []);

  /* Where the conversation's column actually sits, published to CSS so the strip
     along the top can put the project's name over the first word under it and
     the preview pill on its right margin. Measured rather than computed: the
     arithmetic has to know about the shelf, the rail, the cap on the gap and the
     width of a scrollbar, and it was wrong about at least one of them at every
     window size. Observing the scroller catches all four — each of them changes
     its content box. */
  useEffect(() => {
    const app = scrollRef.current;
    if (app === null) return;
    const measure = () => {
      const column = contentRef.current;
      if (column === null) return;
      const box = column.getBoundingClientRect();
      app.style.setProperty("--column-left", `${Math.round(box.left)}px`);
      app.style.setProperty(
        "--column-right",
        `${Math.round(window.innerWidth - box.right)}px`,
      );
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(app);
    return () => watch.disconnect();
  }, [scrollRef, contentRef]);

  /* The one scroll a person asks for by name, so it is allowed to be a movement
     rather than a jump — a spring, damped so it settles instead of bouncing,
     and instant for anyone who has asked for less of that. It is interruptible:
     touching the wheel on the way down stops it where it is. */
  const jumpToLatest = useCallback(() => {
    void scrollToBottom({
      animation: reducedMotion
        ? "instant"
        : { damping: 0.9, stiffness: 0.1, mass: 1 },
    });
  }, [scrollToBottom, reducedMotion]);

  /** Say something on the desk in front. Nothing is said when there is none —
   *  a sentence with nowhere to go is a sentence nobody reads. */
  const say = useCallback((text: string) => {
    setDesks((current) =>
      changeCurrent(current, (one) => ({
        ...one,
        turns: [...one.turns, said("graphe", text)],
      })),
    );
  }, []);

  const troubleHere = useCallback((trouble: Trouble) => {
    // A failed connect is not a desk problem — the connect screen is the place
    // where connecting matters, so the failure sentence goes there instead of
    // into whatever conversation this window was having.
    if (trouble.marker === "connect") {
      setConnectOpen(true);
      setConnectBusy(false);
      setConnectStep(null);
      setConnectFailure(trouble.because);
      refreshConnection();
      return;
    }
    setDesks((current) =>
      changeCurrent(current, (one) => ({
        ...one,
        turns: withTrouble(one.turns, trouble),
      })),
    );
  }, [refreshConnection]);

  /** Put an asynchronous failure back in the conversation that made the call.
   *  A person may have switched tabs while IPC was waiting; "current" at the
   *  end of the await is not ownership. Unknown/closed owners are left alone. */
  const troubleAt = useCallback((where: Where, trouble: Trouble) => {
    if (trouble.marker === 'connect' || where.project === undefined) {
      troubleHere(trouble);
      return;
    }
    setDesks((current) =>
      changeDesk(current, where.project!, (one) => {
        const conversation = where.conversation;
        if (conversation === undefined || conversation === one.address) {
          return { ...one, turns: withTrouble(one.turns, trouble) };
        }
        const parked = one.parked[conversation];
        if (parked === undefined) return one;
        return {
          ...one,
          parked: {
            ...one.parked,
            [conversation]: { ...parked, turns: withTrouble(parked.turns, trouble) },
          },
        };
      }),
    );
  }, [troubleHere]);

  const selectModel = useCallback(
    (choice: ModelChoice) => {
      void bridge.selectModel(choice).then((answer) => {
        // Said, not swallowed: a chip naming one model while the conversation
        // answers as another is the thing this reports.
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setPreferences(answer.value);
        setConnection((current) =>
          current === null
            ? current
            : {
                ...current,
                chosen: answer.value.model,
                chosenThinking:
                  answer.value.model === null
                    ? 'off'
                    : (answer.value.thinking[modelKey(answer.value.model)] ??
                      current.chosenThinking),
              },
        );
        resumeWaiting();
      });
    },
    [resumeWaiting, troubleHere],
  );

  /** Saying yes to one of a project's own extensions builds the session again,
   *  which is the only moment extensions are decided. The shell answers with the
   *  list as it stands afterwards. */
  const trustCarried = useCallback(
    (id: string, trust: boolean) => {
      void bridge.trustCarried(id, trust).then((answer) => {
        if (answer.ok) setCarried(answer.value);
        else troubleHere(answer.trouble);
      });
    },
    [troubleHere],
  );

  /* ---------------------------------------------------------------- versions */

  /** Ask for the timeline of the project in front, and put it on that desk.
   *  Applied only if it is still the one in front by the time the answer comes
   *  back — the shell answers about whatever is current, so a switch mid-flight
   *  would otherwise write one project's history onto another's desk. */
  const refreshVersions = useCallback(async (path: string) => {
    const [answer, seen] = await Promise.all([bridge.versions(), bridge.versionPictures()]);
    // The pictures are answered about whatever project is in front of the
    // shell, exactly as the timeline is, so they stand on the same guard: a
    // switch mid-flight must not file one project's pictures under another.
    if (seen.ok && desksNow.current.current === path) {
      setVersionPictures((current) => ({ ...current, [path]: seen.value }));
    }
    // A folder holding several projects has no timeline of its own. Each
    // project answers where it lives, and the panel shows whichever is chosen.
    const several = desksNow.current.byPath[path]?.overview?.repos ?? [];
    const each = await Promise.all(
      several.map(
        async (one) =>
          [one.name, await bridge.versions({ project: path, repo: one.name })] as const,
      ),
    );
    if (desksNow.current.current !== path) return;
    const perRepo: Record<string, readonly SavedVersion[]> = {};
    for (const [name, got] of each) if (got.ok) perRepo[name] = got.value;
    if (!answer.ok && several.length === 0) return;
    setDesks((current) =>
      current.current === path
        ? changeDesk(current, path, (one) => ({
            ...one,
            versions: answer.ok ? answer.value : one.versions,
            ...(several.length === 0 ? {} : { repoVersions: perRepo }),
          }))
        : current,
    );
  }, []);

  /** How full the conversation on screen is. Asked for after anything that
   *  could change it, and never on a timer. */
  /** Anything that puts a conversation on screen puts the conversation on
   *  screen. The two full-width surfaces cover it, so asking for a different
   *  one while the design view is up would otherwise change something nobody
   *  can see. */
  const toChat = useCallback(() => {
    setDesignAt(null);
    setGraphOpen(false);
    setReviewsOpen(false);
    setHelpersAt(null);
  }, []);

  /** The screens that take the whole work over the conversation, so that
   *  opening one closes the rest. "Design", "History", the shelf and the
   *  others all live on flags that could otherwise stay set side by side, and
   *  two full-width surfaces on top of each other hide one entirely. */
  const goToScreen = useCallback(
    (
      screen:
        | 'chat'
        | 'design'
        | 'graph'
        | 'reviews'
        | 'skills'
        | 'connected'
        | 'settings'
        | 'usage'
        | 'add-more'
        | 'helpers',
    ) => {
      if (screen !== 'chat') setDesignAt(null);
      if (screen !== 'graph') setGraphOpen(false);
      if (screen !== 'reviews') setReviewsOpen(false);
      if (screen !== 'skills') setSkillsOpen(false);
      if (screen !== 'settings') setSettingsOpen(false);
      if (screen !== 'usage') setUsageOpen(false);
      if (screen !== 'add-more') setAddMore(false);
      if (screen !== 'helpers') setHelpersAt(null);
    },
    [],
  );

  /** Optimistic on screen, confirmed underneath — the same bargain "Show me"
   *  makes: the chip has to change on the click, and the shell's answer is what
   *  survives if the switch did not take. */
  const setLimit = useCallback((amount: Money | null) => {
    void bridge.setSpendLimit(amount).then((answer) => {
      if (answer.ok) setCeiling(answer.value);
    });
  }, []);

  const setHowFar = useCallback((rung: HowFar) => {
    const desk = currentDesk(desksNow.current);
    const where: Where = {
      ...(desk === null ? {} : { project: desk.path }),
      ...(desk?.address == null ? {} : { conversation: desk.address }),
    };
    setHowFarHere(rung);
    void bridge.goAsFarAs(rung, where).then((answer) => {
      if (answer.ok) setHowFarHere(answer.value);
    });
  }, []);

  /** What is already up. The band is kept in step by events afterwards, but a
   *  window that has just opened has heard none of them yet. The destination is
   *  required: an old conversation settling must never clear the project that
   *  is on screen now. */
  const refreshRunning = useCallback((where?: Where) => {
    const desk = currentDesk(desksNow.current);
    const asked: Where = where ?? {
      ...(desk === null ? {} : { project: desk.path }),
      ...(desk?.address == null ? {} : { conversation: desk.address }),
    };
    void bridge.running(asked).then((answer) => {
      if (!answer.ok) return;
      const current = currentDesk(desksNow.current);
      if (asked.project !== undefined && current?.path !== asked.project) return;
      setRunning(answer.value);
    });
  }, []);

  const refreshRoom = useCallback((where?: Where) => {
    const desk = currentDesk(desksNow.current);
    const asked: Where = where ?? {
      ...(desk === null ? {} : { project: desk.path }),
      ...(desk?.address == null ? {} : { conversation: desk.address }),
    };
    void bridge.room(asked).then((answer) => {
      if (!answer.ok) return;
      const current = currentDesk(desksNow.current);
      if (asked.project !== undefined && current?.path !== asked.project) return;
      if (asked.conversation !== undefined && current?.address !== asked.conversation) return;
      setRoom(answer.value);
    });
  }, []);

  /* How much a conversation can hold is the model's own number, so the ring is
     read again whenever somebody changes model. */
  useEffect(() => {
    refreshRoom();
  }, [connection?.chosen, refreshRoom]);

  /** Ask for the git state of the project in front, for the overview. Applied
   *  only if it is still the one in front by the time the answer comes back —
   *  the same guard `refreshVersions` stands on, for the same reason. */
  const refreshOverview = useCallback(async (path: string, conversation?: string | null) => {
    const here = desksNow.current.byPath[path];
    const address = conversation === undefined ? here?.address : conversation;
    const where: Where = {
      project: path,
      ...(address == null ? {} : { conversation: address }),
    };
    const answer = await bridge.overview(where);
    if (!answer.ok) return;
    setDesks((current) =>
      current.current === path
        ? changeDesk(current, path, (one) => ({
            ...one,
            overview: answer.value,
          }))
        : current,
    );
    // Which projects a folder holds is only known once this has answered, so
    // the first ask for their timelines has to be here rather than earlier —
    // otherwise the panel says "nothing saved yet" about a project that has.
    const held = answer.value.repos ?? [];
    const already = desksNow.current.byPath[path]?.repoVersions ?? {};
    if (held.some((one) => already[one.name] === undefined)) void refreshVersions(path);
    if (held.length === 0) return;
    const styled = await Promise.all(
      held.map(
        async (one) =>
          [one.name, await bridge.overview({ ...where, repo: one.name })] as const,
      ),
    );
    if (desksNow.current.current !== path) return;
    const perRepo: Record<string, OverviewNow['styles']> = {};
    for (const [name, got] of styled) if (got.ok) perRepo[name] = got.value.styles;
    setDesks((current) =>
      current.current === path
        ? changeDesk(current, path, (one) => ({ ...one, repoStyles: perRepo }))
        : current,
    );
  }, [refreshVersions]);

  /** Read the build plan for the project in front, for the tracker above the
   *  box. Same in-front guard as everything else that answers about a folder. */
  const refreshBuildPlan = useCallback(async (path: string) => {
    const answer = await bridge.buildPlan();
    if (!answer.ok) return;
    setBuildPlan((current) => {
      if (desksNow.current.current !== path) return current;
      return answer.value === null ? null : { path, plan: answer.value };
    });
  }, []);

  /** Whether the turn that just settled finished well. The ending decides, not
   *  any single step along the way: a failure the agent recovered from is
   *  history, not how the run ended. The last thing it did — skipping the
   *  messages around it — is the answer: a failed step or a problem means
   *  stuck; anything else means it got there. */
  const settledWell = useCallback((turns: readonly Turn[]): boolean => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn === undefined) continue;
      if (turn.kind === 'did') return turn.state !== 'failed';
      if (turn.kind === 'trouble') return false;
      // A question is not a failure — the run got to where it stopped and
      // asked instead of breaking.
      if (turn.kind === 'asked' || turn.kind === 'estimate' || turn.kind === 'plan') return true;
    }
    return true;
  }, []);

  /* ------------------------------------------ everything in this project */

  /** Everything each project holds, by folder — kept apart for the same reason
   *  the pictures are: one project's files must never be drawn under another's
   *  name. */
  const [files, setFiles] = useState<Readonly<Record<string, readonly FileEntry[]>>>({});
  /** The file being read, if somebody has opened one. Null while it is on its
   *  way is the state `FileView` draws as "Opening it…". */
  const [reading, setReading] = useState<Reading | null>(null);

  /** Read inside the callbacks below, which must not be rebuilt every time a
   *  preference changes. */
  const wantsFiles = useRef(preferences.showFiles);
  wantsFiles.current = preferences.showFiles;

  /** The same guard the timeline stands on: the shell answers about whatever is
   *  in front of it, so a switch mid-flight must not file one project's files
   *  under another. */
  const refreshFiles = useCallback(async (path: string) => {
    if (!wantsFiles.current) return;
    const answer = await bridge.projectFiles();
    if (!answer.ok || desksNow.current.current !== path) return;
    setFiles((current) => ({ ...current, [path]: answer.value }));
  }, []);

  const readFile = useCallback((path: string) => {
    setReading({ path, text: null, trouble: null });
    void bridge.fileText(path).then((answer) => {
      setReading((current) =>
        current === null || current.path !== path
          ? current
          : answer.ok
            ? { path, text: answer.value, trouble: null }
            : { path, text: null, trouble: answer.trouble.because },
      );
    });
  }, []);

  /* Asked for once per project, the first time there is something to draw it
     in. Nothing is read while the panel is off, so a person who never opens it
     never pays for a folder being walked. */
  useEffect(() => {
    const path = desks.current;
    if (!preferences.showFiles || path === null || files[path] !== undefined) return;
    void refreshFiles(path);
  }, [preferences.showFiles, desks.current, files, refreshFiles]);

  /* ------------------------------------------------------------- the folder */

  const open = useCallback(
    async (path: string): Promise<void> => {
      const request = ++navigation.current;
      const opened = await bridge.openProject(path);
      if (request !== navigation.current) return;
      if (!opened.ok) {
        // A connect problem while opening means there is no model to think
        // with; the picker's usual "this folder is a dud" phrasing would be
        // wrong, so the connect screen opens to say what is actually wrong.
        if (opened.trouble.marker === "connect") {
          // Held so that connecting can finish this, rather than leaving
          // somebody on a screen about accounts with the folder still shut.
          waitingFor.current = path;
          troubleHere(opened.trouble);
          return;
        }
        // Before there is a conversation the picker is the only place a sentence
        // can go, and the useful thing to offer there is taking the project off
        // the list rather than trying the same folder again.
        if (desks.current === null)
          setPickerTrouble({ path, trouble: opened.trouble });
        else troubleHere(opened.trouble);
        return;
      }

      // If this was the folder waiting on an account, the connect screen has
      // done its job and should get out of the way.
      if (waitingFor.current === path) {
        waitingFor.current = null;
        setConnectOpen(false);
      }

      setSwitching(false);
      setPickerTrouble(null);
      setTidying(false);
      setRoom(null);
      setRepo(null);
      setReviewsBusy(false);
      toChat();
      // A resumed session keeps its real rung; a genuinely new one reports the
      // default. Never show “asks first” while the live session has full access.
      setHowFarHere(opened.value.howFar ?? 'asking');
      // A file of the folder we were in is not a file of this one.
      setReading(null);
      // Which conversation this landed in. Without it nothing in the shelf is
      // marked, and pressing the row you are already in looks like a dead button.
      setInConversation(opened.value.conversation);
      setOwnCopyHere(opened.value.ownCopy === true);
      // The shelf and running band are about the project in front. Clear the old
      // project's rows while this project's readings are on their way so they
      // can never briefly appear under the wrong project.
      setConversations([]);
      setRunning([]);
      setDesks((current) => {
        const next = openDesk(current, opened.value);
        const desk = next.byPath[opened.value.path];
        // Only the first time. A folder reopened in this sitting comes back
        // exactly as it was left; one with a conversation saved on disk gets
        // that conversation back, folded through the same reducer the live
        // stream runs. A folder where nothing was ever said stays empty, and
        // the first screen is the one that asks what you want to make.
        if (desk === undefined) return next;
        const named = changeDesk(next, opened.value.path, (one) => ({
          ...one,
          address: opened.value.address ?? one.address,
          order:
            opened.value.address == null || one.order.includes(opened.value.address)
              ? one.order
              : [...one.order, opened.value.address],
        }));
        if (desk.turns.length > 0) return named;
        const revived = opened.value.history.reduce(
          (turns, event) => applyEvent(turns, event),
          desk.turns,
        );
        if (revived.length === 0) return named;
        return changeDesk(named, opened.value.path, (one) => ({ ...one, turns: revived }));
      });

      void refreshVersions(opened.value.path);
      void refreshOverview(opened.value.path, opened.value.address);
      void refreshBuildPlan(opened.value.path);
      refreshRoom({
        project: opened.value.path,
        ...(opened.value.address == null ? {} : { conversation: opened.value.address }),
      });
      refreshRunning({
        project: opened.value.path,
        ...(opened.value.address == null ? {} : { conversation: opened.value.address }),
      });
      void bridge.pages().then((answer) => {
        if (answer.ok) setPages(answer.value);
      });
      void bridge.conversations({ project: opened.value.path }).then((answer) => {
        if (answer.ok && desksNow.current.current === opened.value.path) {
          setConversations(answer.value);
        }
      });
      void bridge.recentProjects().then((answer) => {
        if (answer.ok) setRecent((current) => stableProjectOrder(current, answer.value));
      });
    },
    [desks.current, refreshVersions, refreshOverview, refreshBuildPlan, toChat, troubleHere],
  );
  openRef.current = open;

  /**
   * Put a different conversation on screen, or start a fresh one.
   *
   * The desk is emptied first and refilled from what comes back, because a
   * thread half from one conversation and half from another is worse than
   * either. The versions and the spend belong to the project, not the
   * conversation, so they stay.
   */
  const swapConversation = useCallback(
    async (path: string | null) => {
      // Already here. Silent, because pressing the row you are on is a person
      // checking where they are, not asking for anything. A conversation
      // nothing has been said in yet is the same case: "new" from an empty
      // screen would swap it for another empty screen.
      if (path !== null && path === inConversation) return;
      if (path === null && (desk?.turns.length ?? 0) === 0) {
        // Already looking at an empty one. Still worth getting out of the way
        // of it, since that is what was pressed.
        toChat();
        return;
      }
      toChat();
      setTidying(false);
      setRoom(null);
      // Opening another conversation leaves an in-flight turn where it is,
      // running in the conversation it belongs to. Each conversation is its
      // own agent session, so the turn on the tab being left carries on in the
      // background and stays saved — this is how two tabs work at once. The
      // turn only stops if somebody presses Stop on it.
      const projectAtStart = desksNow.current.current;
      const request = ++navigation.current;
      const opened = await bridge.openConversation(
        path,
        projectAtStart === null ? undefined : { project: projectAtStart },
      );
      if (request !== navigation.current) return;
      if (!opened.ok) {
        troubleAt(projectAtStart === null ? {} : { project: projectAtStart }, opened.trouble);
        return;
      }
      // Another tab/project choice won the race while this conversation was
      // opening. It is live in the shell, but must not replace the newer choice.
      if (desksNow.current.current !== opened.value.path) return;
      const turns = opened.value.history.reduce(
        (sofar, event) => applyEvent(sofar, event),
        [] as readonly Turn[],
      );
      // A conversation that was written down but reads back as nothing is a
      // fault, not an empty conversation. Blanking the desk would look like the
      // conversation had been lost, so the desk stays and the reason is said.
      if (opened.value.history.length > 0 && turns.length === 0) {
        troubleHere(swapWords.unreadable);
        return;
      }
      setInConversation(opened.value.conversation);
      setOwnCopyHere(opened.value.ownCopy === true);
      setDesks((current) =>
        changeDesk(current, opened.value.path, (one) => {
          // The one being left goes down whole, so coming back to it finds it
          // as it was rather than as something to be read off disk again.
          const incoming =
            opened.value.address == null ? undefined : one.parked[opened.value.address];
          const withoutIncoming =
            opened.value.address == null
              ? one.parked
              : Object.fromEntries(
                  Object.entries(one.parked).filter(([address]) => address !== opened.value.address),
                );
          const parked =
            one.address === null || one.address === opened.value.address
              ? withoutIncoming
              : {
                  ...withoutIncoming,
                  [one.address]: {
                    turns: one.turns,
                    doing: one.doing,
                    counted: one.counted,
                  },
                };
          return {
            ...one,
            turns,
            doing: incoming?.doing ?? null,
            counted: incoming?.counted ?? 0,
            address: opened.value.address ?? null,
            parked,
            order:
              opened.value.address == null || one.order.includes(opened.value.address)
                ? one.order
                : [...one.order, opened.value.address],
          };
        }),
      );
      refreshRoom({
        project: opened.value.path,
        ...(opened.value.address == null ? {} : { conversation: opened.value.address }),
      });
      refreshRunning({
        project: opened.value.path,
        ...(opened.value.address == null ? {} : { conversation: opened.value.address }),
      });
      setHowFarHere(opened.value.howFar ?? 'asking');
      const project = desksNow.current.current;
      if (project !== null) setConversations([]);
      void bridge.conversations(project === null ? undefined : { project }).then((answer) => {
        if (answer.ok && desksNow.current.current === project) setConversations(answer.value);
      });
    },
    [inConversation, desk?.turns.length, toChat, troubleHere, troubleAt],
  );

  /** Throw a conversation away. If it is the one on screen, open a fresh one
   *  after so the desk is never left pointing at a file that is gone. */
  const deleteConversation = useCallback(
    async (path: string) => {
      const wasHere = path === inConversation;
      const here = currentDesk(desksNow.current);
      const where: Where = {
        ...(here === null ? {} : { project: here.path }),
        ...(here?.address == null ? {} : { conversation: here.address }),
      };
      if (wasHere && busy) {
        await bridge.stop(where);
        goQuiet();
      }
      const answer = await bridge.deleteConversation(path, where);
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setConversations(answer.value);
      if (wasHere) await swapConversation(null);
    },
    [busy, inConversation, swapConversation, troubleHere],
  );

  /**
   * The two ways out of a conversation's own copy of the project.
   *
   * Both name the conversation they act on. Left unnamed the shell would act on
   * whichever is in front, and one of the two deletes.
   *
   * Either way the copy is gone afterwards, so the offer goes with it, and the
   * project on screen is read again — landing changes the folder underneath it.
   */
  const bringWorkBack = useCallback(
    async (path: string) => {
      const answer = await bridge.worktreeLand(ownCopyWhere(path));
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setOwnCopyHere(false);
      const project = desksNow.current.current;
      if (project !== null) {
        void refreshVersions(project);
        void refreshOverview(project);
      }
    },
    [refreshOverview, refreshVersions, troubleHere],
  );

  const throwWorkAway = useCallback(
    async (path: string) => {
      const answer = await bridge.worktreeDrop(ownCopyWhere(path));
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setOwnCopyHere(false);
    },
    [troubleHere],
  );

  /** A second copy of a conversation, opened straight away: copying one and
   *  then having to find it is two steps for one thought. */
  const copyConversation = useCallback(
    async (path: string) => {
      const made = await bridge.copyConversation(path);
      if (!made.ok) {
        troubleHere(made.trouble);
        return;
      }
      await swapConversation(made.value);
      const listed = await bridge.conversations();
      if (listed.ok) setConversations(listed.value);
    },
    [swapConversation, troubleHere],
  );

  const browse = useCallback(async () => {
    const picked = await bridge.chooseFolder();
    if (!picked.ok) {
      if (desks.current === null)
        setPickerTrouble({ path: "", trouble: picked.trouble });
      else troubleHere(picked.trouble);
      return;
    }
    if (picked.value === null) return;
    await open(picked.value);
  }, [desks.current, open, troubleHere]);

  const forget = useCallback(async (project: { path: string }) => {
    setPickerTrouble(null);
    setDesks((current) => closeDesk(current, project.path));
    // The pictures go with the desk. A project taken off the list must not
    // leave screenshots of itself in the window's memory.
    setChanges((current) => {
      if (current[project.path] === undefined) return current;
      const next = { ...current };
      delete next[project.path];
      return next;
    });
    setFiles((current) => {
      if (current[project.path] === undefined) return current;
      const next = { ...current };
      delete next[project.path];
      return next;
    });
    const answer = await bridge.forgetProject(project.path);
    if (answer.ok) setRecent((current) => stableProjectOrder(current, answer.value));
  }, []);

  /* ------------------------------------------------------------ first paint */

  useEffect(() => {
    let stillHere = true;
    void bridge.preferences().then((answer) => {
      if (stillHere && answer.ok) {
        setPreferences(answer.value);
        // The file knows the theme too. It wins over the localStorage value we
        // used for the first paint — one extra write would still be correct,
        // but this is quieter and keeps the early paint from flashing.
        const fromFile = themeFrom(answer.value.theme);
        setTheme((current) => (current === fromFile ? current : fromFile));
      }
    });
    void bridge.hatches().then((answer) => {
      if (stillHere && answer.ok) setEditor(answer.value.editor);
    });
    void bridge.spendLimit().then((answer) => {
      if (stillHere && answer.ok) setCeiling(answer.value);
    });
    void bridge.recentProjects().then((answer) => {
      if (!stillHere) return;
      setRecent((current) => stableProjectOrder(current, answer.ok ? answer.value : []));
      if (openOnLoad === null || !answer.ok) return;
      const wanted =
        answer.value.find((one) => one.name === openOnLoad && !one.missing) ??
        answer.value.find((one) => !one.missing);
      if (wanted !== undefined) void open(wanted.path);
    });
    return () => {
      stillHere = false;
    };
    // Once, on the way in. `open` is rebuilt whenever the project in front
    // changes, and this is a first paint rather than a subscription to that.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Everything the agent does, in order. Subscribed once for the life of the
     window: the bridge outlives any one prompt, and re-subscribing per send
     would drop events that arrive between them. Each event carries the folder
     it belongs to, so a reply that was still arriving when somebody switched
     lands on the desk it started on. */
  useEffect(
    () =>
      bridge.onEvent((notice) => {
        const key = notice.project ?? '';
        const runKey = `${key}\u0000${notice.conversation ?? ''}`;
        const front = currentDesk(desksNow.current);
        const noticeIsHere =
          notice.project === front?.path &&
          (notice.conversation == null || notice.conversation === front.address);

        // "Digs deep" is one message, not a sticky interpretation of everything
        // said afterwards. Keep that one report long enough to turn the model's
        // explicit IMPLEMENTATION PLAN section into the build checklist. The
        // person's next message is never classified here; it reaches the model
        // unchanged after the switch has returned to Auto.
        if (researchRuns.current.has(runKey) && notice.event.type === 'message-delta') {
          researchReports.current[runKey] =
            (researchReports.current[runKey] ?? '') + notice.event.text;
        }
        if (researchRuns.current.has(runKey) && notice.event.type === 'settled') {
          researchRuns.current.delete(runKey);
          const report = researchReports.current[runKey] ?? '';
          const withoutThis = { ...researchReports.current };
          delete withoutThis[runKey];
          researchReports.current = withoutThis;
          const planText = implementationPlanFromResearch(report);
          const project = notice.project;
          const proposal = planText === null ? null : parseProposal(planText);
          const steps = proposal?.steps ?? [];
          if (planText !== null && project !== null && steps.length > 0) {
            void bridge
              .buildSave(
                steps.map((title) => ({ title, acceptance: '' })),
                { project },
              )
              .then((answer) => {
                if (!answer.ok) return;
                void refreshBuildPlan(project);
                // A list that stops short and says nothing reads as the whole
                // plan, which is the one thing it is not.
                const missed = stepsNotOnTheList(proposal?.caveats ?? []);
                if (missed === null) return;
                setDesks((current) =>
                  changeDesk(current, project, (one) => ({
                    ...one,
                    turns: [...one.turns, said('graphe', missed)],
                  })),
                );
              });
          }
          // Whether "now build it" gets a checklist depends on what came back.
          // Research that wrote one leaves it standing, and the answer works
          // through it. Research that wrote none leaves nothing to work
          // through, so the answer is judged like any other message and a big
          // one still earns its own look-around. Exempting it either way is how
          // a large job ends up running with nothing tracking it.
          if (steps.length === 0) justLookedFirst.current = false;
        }
        // How long the active run is going for, so a long one ends with a quiet
        // "worked for" line rather than silence. The clock starts on the first
        // real step and stops when the run settles.
        if (notice.event.type === 'tool-start') {
          didWorkSinceSettle.current = { ...didWorkSinceSettle.current, [runKey]: true };
          if (runStartedAt.current[runKey] === undefined) {
            runStartedAt.current = { ...runStartedAt.current, [runKey]: Date.now() };
            // A new run makes the old footer's measure history.
            setFinishedRun((was) => (was !== null && was.owner === runKey ? null : was));
            // Real work has begun on a build that still has tasks: the tracker
            // picks the next one up as the one being worked on.
            const plan = buildPlanNow.current;
            if (plan !== null && plan.path === key && plan.plan.next !== null) {
              void bridge.buildAdvance({ kind: 'start' }, key === '' ? undefined : { project: key })
                .then((answer) => {
                  if (answer.ok && answer.value !== null) {
                    setBuildPlan({ path: key, plan: answer.value });
                  } else if (!answer.ok) {
                    void refreshBuildPlan(key);
                  }
                })
                .catch(() => refreshBuildPlan(key));
            }
          }
        }
        setDesks((current) => receive(current, notice));
        // A sitting that has settled is a sitting that has been saved, so the
        // timeline and the overview have something new in them — and when a
        // live preview is already being served, the page turns itself on so
        // there is somewhere to see the work.
        if (notice.event.type === "settled") {
          /* A settled session has drained every follow-up. Pi normally follows
             this with an empty queue update, but clearing the local mirror here
             too prevents an old or missed update from leaving “Waiting in line”
             on screen after its message has already run. */
          const queueOwner = `${notice.project ?? ''}\u0000${notice.conversation ?? ''}`;
          setQueued((was) => {
            if (!(queueOwner in was)) return was;
            const { [queueOwner]: _drained, ...withoutDrained } = was;
            return withoutDrained;
          });
          // A long run earns its quiet measure. Short runs stay silent — a
          // line under every quick change is the noise this product removes.
          const started = runStartedAt.current[runKey];
          const rest = { ...runStartedAt.current };
          delete rest[runKey];
          runStartedAt.current = rest;
          if (started !== undefined) {
            const seconds = Math.round((Date.now() - started) / 1000);
            if (seconds >= 60) setFinishedRun({ owner: runKey, seconds });
          }
        }
        if (notice.event.type === "settled" && notice.project !== null) {
          const where = notice.project;
          void refreshVersions(where);
          void refreshOverview(where, notice.conversation);
          void refreshFiles(where);
          refreshRoom({
            project: where,
            ...(notice.conversation == null ? {} : { conversation: notice.conversation }),
          });
          refreshRunning({
            project: where,
            ...(notice.conversation == null ? {} : { conversation: notice.conversation }),
          });
          // A settle with real work behind it advances the build tracker one
          // task: the turn either finished the task it was on, or it got stuck.
          // Either way the plan on disk is the truth the next session resumes
          // from. A settle with no tool work in it is an answer to a question,
          // and an answer must not move the build.
          const didWork = didWorkSinceSettle.current[runKey] === true;
          if (didWork) {
            didWorkSinceSettle.current = { ...didWorkSinceSettle.current, [runKey]: false };
            // The conversation that settled, not whichever is in front. A
            // background tab's turns live in `parked`, so reading `turns` here
            // marked its step done or failed on the evidence of a different
            // conversation entirely.
            const settledIn = desksNow.current.byPath[where];
            const said =
              notice.conversation != null && notice.conversation !== settledIn?.address
                ? settledIn?.parked[notice.conversation]?.turns
                : settledIn?.turns;
            // Nothing known about it is not the same as it having gone well, so
            // the build is left where it is rather than advanced on a guess.
            if (said !== undefined) {
              void bridge
                .buildAdvance({ kind: 'finish', ok: settledWell(said) }, { project: where })
                .then((answer) => {
                  if (answer.ok) {
                    setBuildPlan(answer.value === null ? null : { path: where, plan: answer.value });
                  } else {
                    void refreshBuildPlan(where);
                  }
                })
                .catch(() => refreshBuildPlan(where));
            }
            // Work that is finished is work to be looked at: when a live
            // preview is already being served, the page turns itself on so
            // there is somewhere to see it. Plain answers leave the pane alone.
            const front = currentDesk(desksNow.current);
            if (paneNow.current === 'off' && front?.overview?.preview != null) {
              movePane('split');
            }
          }
        }
        // Pi tidies on its own as well as when asked, and the ring says the
        // same thing either way — from where somebody is sitting it is one
        // event.
        // What is waiting behind the run, as the agent holds it. Kept per
        // conversation so a second tab's line never draws under this one's.
        if (notice.event.type === 'queued') {
          const owner = `${notice.project ?? ''}\u0000${notice.conversation ?? ''}`;
          const words = [...notice.event.steering, ...notice.event.followUp];
          setQueued((was) => ({ ...was, [owner]: words }));
        }
        // The agent has begun on one of the queued messages, so it is not
        // waiting any more. Pi reports this drain through its own bookkeeping
        // too, but that removal is exact-text and can silently no-op, and the
        // whole reason the line is drawn is that one of the two promises can
        // be kept. When the words match, the message is gone from the line;
        // a message that starts without matching anything is the primary
        // prompt, not one of ours.
        if (notice.event.type === 'message-started') {
          const owner = `${notice.project ?? ''}\u0000${notice.conversation ?? ''}`;
          const started = notice.event.text;
          setQueued((was) => {
            const remaining = drainStarted(was[owner] ?? [], started);
            return remaining === was[owner] ? was : { ...was, [owner]: remaining };
          });
        }
        if (notice.event.type === 'running') {
          if (notice.project === desksNow.current.current) setRunning(notice.event.pieces);
          // A server the agent started is the work, so it opens where the work
          // is looked at. Once per address, and never over a page somebody is
          // already on: the pane is theirs once it is open.
          const up = notice.event.pieces.find(
            (one) => one.state === 'running' && one.address !== null && one.showsAPage === true,
          );
          if (
            up?.address != null &&
            notice.project !== null &&
            desksNow.current.current === notice.project &&
            pageAtNow.current === null &&
            openedItself.current !== up.address
          ) {
            openedItself.current = up.address;
            setPageAt(up.address);
            movePane('split');
          }
        }
        if (notice.event.type === "tidying" && noticeIsHere) setTidying(true);
        if (notice.event.type === "tidied") {
          if (noticeIsHere) {
            setTidying(false);
            // Pi intentionally has no post-compaction count until the next
            // successful model reply. Keep the meter, but never show the old
            // pre-compaction number as if it described the shortened context.
            setRoom((was) =>
              was === null ? was : { used: null, total: was.total, part: null },
            );
          }
          if (notice.project !== null) {
            refreshRoom({
              project: notice.project,
              ...(notice.conversation == null ? {} : { conversation: notice.conversation }),
            });
            refreshRunning({
              project: notice.project,
              ...(notice.conversation == null ? {} : { conversation: notice.conversation }),
            });
          }
        }
      }),
    [
      refreshVersions,
      refreshOverview,
      refreshFiles,
      refreshRoom,
      refreshRunning,
      refreshBuildPlan,
      settledWell,
      movePane,
    ],
  );

  useEffect(() => bridge.onShowProgress(setProgress), []);

  /* A before and after has been worked out. Pinned to whatever the conversation
     had last said for that project at the moment it arrived — see `Pinned`. */
  useEffect(
    () =>
      bridge.onVisualChange(({ project, change }) => {
        if (project === null) return;
        const turns = desksNow.current.byPath[project]?.turns ?? [];
        const after = turns[turns.length - 1]?.id ?? null;
        setChanges((current) => {
          const already = current[project] ?? [];
          if (already.some((one) => one.change.id === change.id))
            return current;
          return { ...current, [project]: [...already, { change, after }] };
        });
      }),
    [],
  );

  /* A dropdown closes when you look away from it. Pointer down rather than
     click, so it is gone by the time the finger lifts. */
  useEffect(() => {
    if (!switching) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".topbar") !== null)
        return;
      setSwitching(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [switching]);

  /** Which project's browser is being watched, or null when nobody is. */
  const [watchAt, setWatchAt] = useState<string | null>(null);
  const [watched, setWatched] = useState<Watched>(NOTHING_WATCHED);

  /* The pictures arrive from the shell, which is the only side of the app that
     can reach a service on this machine. */
  useEffect(() => {
    return bridge.onBrowserFrame((frame) => {
      setWatched((was) => (frame.project === watchAt ? watching(was, frame.bytes) : was));
    });
  }, [watchAt]);

  /** Which ask for the stream is the live one. A second press while the first
   *  is still travelling must not have its answer arrive afterwards and turn
   *  watching back on. */
  const watchAsked = useRef(0);

  /** Whose browser is being watched. Kept apart from whichever project is in
   *  front: turning a stream off has to reach the project that turned it on,
   *  and by the time somebody switches, that is no longer the one in front. */
  const watchedProject = useRef<string | null>(null);

  const watchTheBrowser = useCallback((want: boolean, project?: string | null) => {
    const path = project === undefined ? desksNow.current.current : project;
    const mine = watchAsked.current + 1;
    watchAsked.current = mine;
    setWatched(NOTHING_WATCHED);
    if (!want) {
      setWatchAt(null);
      watchedProject.current = null;
      void bridge.watchBrowser(false, path === null ? undefined : { project: path });
      return;
    }
    watchedProject.current = path;
    void bridge
      .watchBrowser(true, path === null ? undefined : { project: path })
      .then((answer) => {
        if (watchAsked.current !== mine) return;
        setWatchAt(answer.ok && answer.value ? path : null);
      });
  }, []);

  /* A browser nobody is watching should not be drawing itself. Switching
     project, or closing the pane, is nobody watching — and the stream is turned
     off on the project that started it, not on whichever is now in front. */
  useEffect(() => {
    if (watchAt === null) return;
    if (desks.current === watchedProject.current && pane !== 'off') return;
    watchTheBrowser(false, watchedProject.current);
  }, [desks.current, pane, watchAt, watchTheBrowser]);

  /** Whether each conversation's run is waiting for somebody, by its owner. */
  const [holding, setHolding] = useState<Readonly<Record<string, boolean>>>({});

  const waitForMe = useCallback((on: boolean) => {
    const desk = currentDesk(desksNow.current);
    if (desk === null) return;
    const owner = `${desk.path}\u0000${desk.address ?? ''}`;
    setHolding((current) => ({ ...current, [owner]: on }));
    void bridge.waitForMe(on, {
      project: desk.path,
      ...(desk.address == null ? {} : { conversation: desk.address }),
    });
  }, []);

  const halt = useCallback(() => {
    // Name *which* conversation is being stopped. Without the `where`, Stop
    // would end whatever the shell has in front — which, with two tabs open,
    // may not be the one on screen (see the `where` fixes in bridge.ts).
    const desk = currentDesk(desksNow.current);
    if (desk !== null) {
      // Optimistic: make the UI feel stopped within the same tick, before the
      // shell answers. Clears the "sends in the air" count and marks any
      // streaming turn as done so frontBusy becomes false immediately.
      const owner = `${desk.path}\u0000${desk.address ?? ''}`;
      setSendsInTheAir((current) => {
        const { [owner]: _gone, ...rest } = current as Record<string, number>;
        return rest;
      });
      setDesks((current) =>
        changeDesk(current, desk.path, (one) => ({
          ...one,
          turns: one.turns.map((t) => (t.kind === 'said' && (t as { streaming: boolean }).streaming ? { ...t, streaming: false } : t)),
        })),
      );
    }
    if (desk !== null) {
      const owner = `${desk.path}\u0000${desk.address ?? ''}`;
      setHolding((current) => ({ ...current, [owner]: false }));
    }
    void bridge.stop({
      ...(desk === null ? {} : { project: desk.path }),
      ...(desk?.address == null ? {} : { conversation: desk.address }),
    });
  }, []);


  /** Shorten the conversation now rather than waiting for it to fill up. The
   *  narration is Pi's own, arriving through the ordinary event stream, so
   *  there is nothing to say here. */
  const tidyNow = useCallback(() => {
    const desk = currentDesk(desksNow.current);
    const where: Where = {
      ...(desk === null ? {} : { project: desk.path }),
      ...(desk?.address == null ? {} : { conversation: desk.address }),
    };
    void bridge
      .tidyNow(where)
      .then((answer) => {
        const current = currentDesk(desksNow.current);
        const stillHere =
          (where.project === undefined || current?.path === where.project) &&
          (where.conversation === undefined || current?.address === where.conversation);
        if (answer.ok && stillHere) setRoom(answer.value);
        // "Not enough to shorten" and "Pi was already shortening it" are
        // ordinary, harmless outcomes. Pi's event stream has already left the
        // truthful activity line in the conversation when there was work to
        // narrate, so a large error card here would only contradict it.
        else if (!answer.ok && answer.trouble.what !== 'I could not tidy this conversation just now.') {
          troubleAt(where, answer.trouble);
        }
      })
      .finally(() => {
        const current = currentDesk(desksNow.current);
        if (
          (where.project === undefined || current?.path === where.project) &&
          (where.conversation === undefined || current?.address === where.conversation)
        ) setTidying(false);
      });
  }, [troubleAt]);

  /** Sticky, so the answer comes back from the shell rather than being assumed
   *  here — if the write failed, the switch shows what was actually kept. */
  const changeShowMe = useCallback((on: boolean) => {
    setPreferences((was) => ({ ...was, showMe: on }));
    void bridge.setShowMe(on).then((answer) => {
      if (answer.ok) setPreferences(answer.value);
    });
  }, []);

  /** Sticky the same way, and the menu closes on the way out: what was asked
   *  for is about to appear beside the conversation. Closing it puts the file
   *  that was open away with it. */
  const changeShowFiles = useCallback((on: boolean) => {
    setSwitching(false);
    setPreferences((was) => ({ ...was, showFiles: on }));
    wantsFiles.current = on;
    if (!on) setReading(null);
    void bridge.setShowFiles(on).then((answer) => {
      if (answer.ok) setPreferences(answer.value);
    });
  }, []);

  /** Both hatches close the menu on the way out: the thing you asked for is
   *  about to appear in front of this window, and a dropdown still hanging open
   *  behind it is litter. */
  const openInEditor = useCallback(() => {
    setSwitching(false);
    void bridge.openInEditor().then((answer) => {
      if (!answer.ok) troubleHere(answer.trouble);
    });
  }, [troubleHere]);

  const revealFolder = useCallback(() => {
    setSwitching(false);
    void bridge.revealFolder().then((answer) => {
      if (!answer.ok) troubleHere(answer.trouble);
    });
  }, [troubleHere]);

  /* Esc cancels the current run and closes the switcher — the keyboard rules in
     UI-DESIGN.md. ⌘O opens a folder · ⌘B folds the shelf · ⌘D the design view ·
     ⌘J the page · ⌘T another conversation · ⌘⇧T another project · ⌘W puts this
     conversation down · ⌘1–9 goes to one of the things open · ⌘⇧[ and ⌘⇧] move
     along the row · ⌘⇧N goes to whatever has stopped to ask you. */
  useEffect(() => {
    /* Escape means "back out of what is in front of me". Only when nothing is
       in front of you does it mean "stop the run", and one press must never do
       both — this listener sits on the window and was registered before any
       panel's, so it ran first: opening Settings, looking, and pressing Escape
       to leave stopped the turn and killed every helper with it, in the same
       frame as the panel closing. */
    const overlayUp = (): boolean =>
      settingsOpen ||
      usageOpen ||
      skillsOpen ||
      connectedOpen ||
      addMore ||
      paletteOpen ||
      graphOpen ||
      reviewsOpen ||
      changesOpen ||
      asking ||
      helpersAt !== null ||
      designAt !== null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Something nearer the key already answered it — the composer's own
        // menu, or anything else below the window.
        if (event.defaultPrevented) return;
        if (connectOpen) {
          if (connectBusy) cancelConnect();
          else closeConnect();
        } else if (switching) setSwitching(false);
        else if (overlayUp()) return;
        else if (busy) halt();
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      // Everything this window can do, by name. Not ⌘K — "Ask for anything"
      // has owned that since before this existed, and takes it at the document
      // before anything here can see it. Pressed many times a day, so it opens
      // with no animation at all.
      if (event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPaletteOpen((was) => !was);
        return;
      }
      if (event.key === "o") {
        event.preventDefault();
        void browse();
        return;
      }
      if (event.key === "d" && desk !== null) {
        event.preventDefault();
        // Design toggles on and off on the same key, like the shelf. Only a
        // switch from another screen clears the rest.
        setDesignAt((was) => {
          if (was !== null) return null;
          goToScreen("design");
          return "styles";
        });
        return;
      }
      /* Moving between what is open. `openNow` is the row as drawn, so these
         land where the eye is rather than on some other order. */
      if (event.shiftKey && (event.key === "{" || event.key === "}")) {
        const row = openNow.current;
        const here = row.indexOf(atNow.current ?? "");
        if (here === -1 || row.length < 2) return;
        event.preventDefault();
        const step = event.key === "}" ? 1 : -1;
        const wanted = row[(here + step + row.length) % row.length];
        if (wanted !== undefined) void goToTabNow.current(wanted);
        return;
      }
      // The one worth a key of its own: whatever has stopped to ask you. It is
      // the only state that cannot move on without a person.
      if (event.shiftKey && event.key.toLowerCase() === "n") {
        const wanted = wantsYouNow.current;
        if (wanted === undefined) return;
        event.preventDefault();
        void goToTabNow.current(wanted);
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        void browse();
        return;
      }
      if (event.key === "w" && desk !== null) {
        const wanted = atNow.current;
        if (wanted === null) return;
        event.preventDefault();
        void closeTabNow.current(wanted);
        return;
      }
      // One key between the conversation and the page, from either side, and
      // always the same key. In the split the question does not arise.
      if (event.key === "j" && desk !== null) {
        event.preventDefault();
        togglePane();
        return;
      }
      if (event.key === "b" && desk !== null) {
        event.preventDefault();
        setShelfOpen((was) => !was);
        return;
      }
      if (event.key === "t" && desk !== null) {
        event.preventDefault();
        void swapConversation(null);
        return;
      }
      // ⌘1–9 goes to what is open, not to what is remembered. Recent projects
      // are one press away in the name at the top and in "Ask for anything",
      // and a number key that jumps to a folder you cannot see is a surprise.
      const nth = Number.parseInt(event.key, 10);
      if (Number.isFinite(nth) && nth >= 1 && nth <= 9) {
        const wanted = openNow.current[nth - 1];
        if (wanted === undefined) return;
        event.preventDefault();
        void goToTabNow.current(wanted);
      }
    };
      window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    busy,
    halt,
    switching,
    browse,
    open,
    swapConversation,
    desk,
    connectOpen,
    connectBusy,
    cancelConnect,
    closeConnect,
    togglePane,
    // What is in front of the conversation. Escape belongs to whichever of
    // these is up, and only reaches the run when none of them is.
    settingsOpen,
    usageOpen,
    skillsOpen,
    connectedOpen,
    addMore,
    paletteOpen,
    graphOpen,
    reviewsOpen,
    changesOpen,
    asking,
    helpersAt,
    designAt,
  ]);

  /* ----------------------------------------------------------------- saying */

  /**
   * Hand the message over, and remember what kind of job it was.
   *
   * Everything that decides *whether* to send is above this. The task is put on
   * the desk before the work starts so that whatever this turn costs can be
   * filed against it when the sitting settles — which is what turns the next
   * estimate from a guess into a measurement (COST-DESIGN §2).
   */
  const deliver = useCallback(
    async (text: string, task: Task, ways?: { lookFirst?: boolean; queue?: 'followUp' }) => {
      /* A recorded walkthrough is a brief handoff from the page. Once somebody
         sends their next message, it has done its job; leaving its “Look” row
         parked above the composer makes it read as still recording. */
      setRecorded(null);
      // Ownership is captured before reading attachments: a large image can
      // take long enough to decode for somebody to switch tabs meanwhile.
      const desk = currentDesk(desksNow.current);
      const target: Where = {
        ...(desk === null ? {} : { project: desk.path }),
        ...(desk?.address == null ? {} : { conversation: desk.address }),
      };
      const owner = desk === null ? null : `${desk.path}\u0000${desk.address ?? ''}`;
      // What is in the box at the moment of sending — never a snapshot from
      // whenever this callback was last rebuilt (see `attachmentsNow`).
      const inTheBox = attachmentsNow.current;
      // A model that cannot read pictures never gets sent one, whichever door
      // the message came through. The composer stops this at the box; a note
      // drawn on the page goes straight to here, and used to carry the picture
      // past that check and into the slow provider refusal it exists to
      // pre-empt. The pictures stay put, so the line explaining why is still
      // on screen beside them.
      const blind = readsPictures(connection) === false;
      // And the box is empty afterwards. It used to keep them: a picture
      // attached once went out again with every message after it, so a model
      // that could not read pictures failed on the next message too, and the
      // one after that, and nothing on screen said why.
      if (inTheBox.length > 0 && !blind) emptyTheBox();

      // The pictures go along for the ride: read into the base64 the shell
      // expects, and — the same moment — recorded in the overview as the
      // references this message worked from. The recording happens whether or
      // not the shell could read the bytes, so a reference that did not reach
      // the agent is still a reference somebody meant it to have.
      const reference: Reference[] = [];
      const pictures: PromptAttachment[] = [];
      // Pasting a Figma address turns it into a chip and takes it out of the
      // box, so unless it is put back here the agent never hears the link at
      // all — it sees a message about a design it was never given.
      const links: string[] = [];
      for (const attached of inTheBox) {
        if (attached.kind === "image" || attached.kind === "figma") {
          reference.push({
            id: attached.id,
            kind: attached.kind,
            name: attached.name,
            note: attached.note,
            preview: attached.preview,
          });
        }
        if (attached.kind === "figma" && attached.url !== undefined) {
          links.push(attached.url);
        }
        if (!blind && attached.kind === "image" && attached.file !== undefined) {
          const bytes = await pictureBytes(attached.file);
          if (bytes !== null) {
            pictures.push({
              kind: "image",
              name: attached.name,
              // The shell will not carry a picture whose type is blank, and a
              // file dragged out of some folders arrives with nothing said
              // about it. Its name is the only other thing we know.
              mimeType: pictureType(attached.name, attached.file.type),
              bytes,
            });
          }
        }
      }

      setDesks((current) => {
        const update = (one: Desk): Desk => {
          const started = { task, startedAt: Date.now() };
          const conversation = target.conversation;
          if (conversation !== undefined && conversation !== one.address) {
            const parked = one.parked[conversation];
            if (parked === undefined) return one;
            return {
              ...one,
              references: [...one.references, ...reference],
              parked: {
                ...one.parked,
                [conversation]: { ...parked, doing: parked.doing ?? started },
              },
            };
          }
          return {
            ...one,
            // Never over the top of a job already in flight. Queueing a second
            // message used to replace the running one's task and start time.
            doing: one.doing ?? started,
            references: [...one.references, ...reference],
          };
        };
        return target.project === undefined
          ? changeCurrent(current, update)
          : changeDesk(current, target.project, update);
      });
      goBusy();
      if (owner !== null) holdSend(owner);
      try {
        const said =
          links.length === 0 ? text : `${text}\n\n${ATTACH_WORDS.alsoLook(links)}`;
        const reply = await bridge.prompt(said, pictures, ways, target);
        if (!reply.ok) troubleAt(target, reply.trouble);
      } catch (cause) {
        // The bridge is not supposed to throw. If it ever does, the window says
        // something calm rather than turning white.
        troubleAt(target, {
          what: STOPPED_PART_WAY,
          because: "Something went wrong on my side. Nothing has been changed.",
          actionLabel: "Got it",
          details:
            cause instanceof Error ? (cause.stack ?? cause.message) : undefined,
        });
      } finally {
        goQuiet();
        if (owner !== null) letSendGo(owner);
      }
    },
    [troubleAt, emptyTheBox, holdSend, letSendGo, connection],
  );

  /**
   * Send one message.
   *
   * The folder is still asked for here when there is not one, because a first
   * launch with nothing remembered is a conversation and nothing else — the
   * picker only exists once there is something to pick.
   *
   * The one thing that can come between typing and sending is an estimate, and
   * only for a job big enough to be worth interrupting for (BACKLOG F7).
   * Everything else goes straight through with nothing said about money at all.
   */
  const send = useCallback(
    async (text: string) => {
      const before = desks.current;
      setDesks((current) =>
        current.current === null
          ? current
          : changeCurrent(current, (one) => ({
              ...one,
              turns: [...one.turns, said("you", text)],
            })),
      );

      if (before === null) {
        if (!bridge.desktop) return;
        goBusy();
        const picked = await bridge
          .chooseFolder()
          .finally(() => goQuiet());
        if (!picked.ok) {
          setPickerTrouble({ path: "", trouble: picked.trouble });
          return;
        }
        if (picked.value === null) {
          setPickerTrouble({
            path: "",
            trouble: {
              what: "I still do not have a folder to work in.",
              because: NO_FOLDER_YET,
              actionLabel: "Got it",
            },
          });
          return;
        }
        await open(picked.value);
        // The sentence goes on the desk that has just been made, so it is not
        // lost with the screen it was typed on.
        setDesks((current) =>
          changeCurrent(current, (one) => ({
            ...one,
            turns: [...one.turns, said("you", text)],
          })),
        );
      }

      // Priced against what this project has actually cost so far, which on a
      // first visit is nothing — and the estimate then says so in its own words
      // rather than quoting a precision it does not have.
      const desk = currentDesk(desks);
      const priced = quote(desk?.jobs ?? [], desk?.spent?.total ?? null, text);
      // Full access is an explicit instruction to proceed. It still records the
      // work, but does not put either kind of large-job pause in its way.
      const asking = howFar === 'doing' ? null : priced.prompt;
      if (asking !== null) {
        setDesks((current) =>
          changeCurrent(current, (one) => ({
            ...one,
            turns: [...one.turns, estimated(text, asking)],
          })),
        );
        return;
      }

      // Research goes out with its method in front of it and no looking-around
      // pass: the brief already says to look, and at more than this turn.
      // It is deliberately one-shot. Once this message has been handed over the
      // switch returns to Auto, so whatever the person says next — implement,
      // research more, challenge this, or anything else — reaches the LLM whole
      // and unclassified. The model, not a word list, decides what they mean.
      if (plans === 'research') {
        const researching = currentDesk(desksNow.current);
        if (researching !== null) {
          const owner = `${researching.path}\u0000${researching.address ?? ''}`;
          researchRuns.current.add(owner);
          researchReports.current[owner] = '';
        }
        setPlans('auto');
        // What comes back is a report to answer, not a request to look around.
        justLookedFirst.current = true;
        await deliver(asResearch(text, chosenDepth()), priced.task, { lookFirst: false });
        return;
      }

      // A big-sounding request looks around before it touches anything, unless
      // somebody has said otherwise for this message. It is not a mode people
      // switch on: the failure designers fear most is forty files changed
      // without warning, and that is worth a round trip by default.
      const answering = justLookedFirst.current;
      justLookedFirst.current = false;
      // "Always" means always: somebody who set it gets a look-around for
      // anything they type, and answers the plan with the button. Only the
      // guess — "auto" reading the words — steps aside for its own answer.
      // Full access means do not stop and ask. It never meant work without a
      // list — the biggest jobs are the ones that most need one, and the plan
      // approves itself the moment it lands.
      const lookFirst = shouldLookFirst({ plans, answering, text });
      if (lookFirst) {
        asked.current = text;
        justLookedFirst.current = true;
      }
      await deliver(text, priced.task, { lookFirst });
    },
    [deliver, desks, howFar, open, plans, say],
  );

  /* ------------------------------------------------------------ in line */

  /**
   * What the composer actually calls.
   *
   * A second thought during a long run used to have nowhere to go: the box took
   * the words and did nothing with them. Now it joins a line, one per project,
   * and goes out on its own the moment the one before it is finished.
   */
  const hand = useCallback(
    (text: string, mode?: 'steer' | 'followUp') => {
      if (desks.current === null) {
        void send(text);
        return;
      }
      const desk = currentDesk(desksNow.current);
      if (desk === null) {
        void send(text);
        return;
      }
      // The two quiet choices beside the box, taken at face value: interrupt
      // the live turn with this message, or queue it behind the run. The
      // window owns the person's own words (the shell never sends them back),
      // so the steer is laid down here just as `send` would.
      if (mode === 'steer') {
        setDesks((current) =>
          changeDesk(current, desk.path, (one) => ({
            ...one,
            turns: [...one.turns, said('you', text)],
          })),
        );
        // An interrupt carries words only — there is nowhere in a steer to put a
        // picture. So the box is emptied here too: left full, whatever was in it
        // went out with the *next* ordinary message instead, which is the
        // re-sending this was supposed to have ended.
        if (attachmentsNow.current.length > 0) emptyTheBox();
        void bridge.steer(text, {
          project: desk.path,
          conversation: desk.address ?? undefined,
        });
        return;
      }
      if (mode === 'followUp') {
        // Written into the conversation the moment it is asked for, the same
        // way an interrupt is. It used to go straight out and appear only when
        // the model got round to answering it, so between pressing the button
        // and the reply there was nothing on screen to say it had been said at
        // all — and with a picture attached, which fails slowly, that gap was
        // the whole of the wait.
        setDesks((current) =>
          changeDesk(current, desk.path, (one) => ({
            ...one,
            turns: [...one.turns, said('you', text)],
          })),
        );
        // The same two switches the box is showing. A message queued while
        // "research" or "plan first" is on used to go out as a plain one: the
        // setting was visible, deliberate, and quietly ignored.
        //
        // The estimate is deliberately not asked for here. This message was put
        // behind a run on purpose, and a money question that then sits
        // unanswered while that run finishes is not what the button said.
        if (plans === 'research') {
          const owner = `${desk.path}\u0000${desk.address ?? ''}`;
          researchRuns.current.add(owner);
          researchReports.current[owner] = '';
          setPlans('auto');
          // What comes back is a report to answer, not a request to look around.
          justLookedFirst.current = true;
          void deliver(asResearch(text, chosenDepth()), sizeUp(text), { lookFirst: false, queue: 'followUp' });
          return;
        }
        const answering = justLookedFirst.current;
        justLookedFirst.current = false;
        const lookFirst = shouldLookFirst({ plans, answering, text });
        if (lookFirst) {
          asked.current = text;
          justLookedFirst.current = true;
        }
        void deliver(text, sizeUp(text), { lookFirst, queue: 'followUp' });
        return;
      }
      // No turn of mine is going — nothing at all is, or another conversation
      // is running its own. Send to my conversation now; two tabs working at
      // once is the point, not a turn that waits for the other's to finish.
      void send(text);
    },
    [deliver, desks, send, plans, howFar, emptyTheBox],
  );

  /* A note written on the page joins the line when a turn of mine is going, and
     goes out now when none is — the same two answers the box gives. */
  useEffect(() => {
    handNow.current = (text: string) => {
      hand(text, frontBusy ? 'followUp' : undefined);
    };
  }, [hand, frontBusy]);

  /** Fetch the open project's github pull requests and issues, and hold the
   *  reading for the reviews screen. Asked whenever that screen opens or its
   *  Refresh is pressed; the shell reads it from the terminal's own `gh`, so it
   *  is never kept past the moment it is fetched. */
  const refreshRepo = useCallback(() => {
    const desk = currentDesk(desksNow.current);
    const project = desk?.path ?? null;
    const inside = desk?.overview?.repos ?? [];
    const named =
      inside.find((one) => one.name === reviewsRepoNow.current)?.name ?? inside[0]?.name ?? null;
    setRepo(null);
    setReviewsBusy(true);
    void bridge
      .repoLook({
        ...(desk === null ? {} : { project: desk.path }),
        ...(desk?.address == null ? {} : { conversation: desk.address }),
        ...(named === null ? {} : { repo: named }),
      })
      .then((answer) => {
        if (currentDesk(desksNow.current)?.path !== project) return;
        if (answer.ok) {
          setRepo(answer.value);
          return;
        }
        // Left alone, this showed the "not a github repository" screen for a
        // reading that failed, which is the same lie one layer up.
        troubleAt(project === null ? {} : { project }, answer.trouble);
      })
      .finally(() => {
        if (currentDesk(desksNow.current)?.path === project) setReviewsBusy(false);
      });
  }, [troubleAt]);

  /** Open a fresh conversation and send the review of one pull request into
   *  it, so the agent reads the whole change on this codebase and posts its
   *  thoughts as the terminal user's github account. */
  const startReview = useCallback(
    (item: RepoItem) => {
      if (repo === null) return;
      const project = currentDesk(desksNow.current)?.path ?? null;
      const repository = repo.full;
      const request = navigation.current + 1;
      toChat();
      void swapConversation(null).then(() => {
        // A newer project/tab choice may have won while the fresh review
        // conversation was opening. Never send a repository prompt there.
        if (
          project === null ||
          navigation.current !== request ||
          currentDesk(desksNow.current)?.path !== project
        ) return;
        void send(reviewPrompt(item, repository, repo?.here ?? null));
      });
    },
    [repo, toChat, swapConversation, send],
  );

  /* A tab names a conversation inside a project, so going to one is at most two
     moves: bring the project to the front, then bring its conversation. */
  const goToTab = useCallback(
    async (id: string) => {
      const [project, address] = id.split('\u0000');
      if (project === undefined || address === undefined) return;
      const here = desksNow.current;
      if (here.current !== project) await open(project);
      const desk = desksNow.current.byPath[project];
      if (desk === undefined || desk.address === address) return;
      // Ask the shell to resume it as well as swapping the renderer's words.
      // An idle session may have left the soft live-session cache; a visual-only
      // switch would then show a tab that could no longer receive a prompt.
      await swapConversation(address);
    },
    [open, swapConversation],
  );

  /** Closing a tab puts the conversation down; it does not throw it away.
   *  Opening it again picks up where it was left. */
  const closeTab = useCallback(
    async (id: string) => {
      const [project, address] = id.split('\u0000');
      if (project === undefined || address === undefined) return;
      const desk = desksNow.current.byPath[project];
      if (desk === undefined) return;
      // Closing the last tab used to take the whole project off the list with
      // it, which put somebody back on the list of projects for pressing the
      // small x on a tab. Closing a tab is closing a tab: the project stays
      // open and a fresh conversation takes the place of the one put down.
      if (desk.address === address && Object.keys(desk.parked).length === 0) {
        // Nothing said in it yet, so there is nothing to put down and nothing
        // a new one would be different from. The press does nothing, which is
        // better than a flicker that ends where it started.
        if (desk.turns.length === 0) return;
        await swapConversation(null);
        setDesks((current) => parkThread(current, project, address));
        void bridge.closeConversation({ project, conversation: address });
        return;
      }
      // Closing the one you are looking at moves to its neighbour first, so
      // there is never a moment with nothing on screen. The window already
      // holds them all, so this is a swap and not a fetch.
      if (desk.address === address) {
        // The neighbour, the way every tab strip has gone for twenty years:
        // the one on the left, or the one on the right when there is no left.
        const row = threadsIn(desk).map((one) => one.address);
        const here = row.indexOf(address);
        const next = row[here - 1] ?? row[here + 1];
        if (next === undefined) return;
        await swapConversation(next);
      }
      setDesks((current) => parkThread(current, project, address));
      void bridge.closeConversation({ project, conversation: address });
    },
    [swapConversation],
  );

  goToTabNow.current = goToTab;
  closeTabNow.current = closeTab;

  /** Out of the line and back into the box, so a second thought can be changed
   *  rather than only cancelled. */
  /**
   * Take the line back out and put it in the box.
   *
   * Everything at once, because that is the whole of what can honestly be
   * offered: the queue belongs to the agent, and it hands back all of it or
   * none. Taking one and re-queueing the rest would reorder them behind the
   * person's back, which is worse than one press that says what it does.
   */
  const takeBack = useCallback(() => {
    const desk = currentDesk(desksNow.current);
    const target: Where = {
      ...(desk === null ? {} : { project: desk.path }),
      ...(desk?.address == null ? {} : { conversation: desk.address }),
    };
    const owner = desk === null ? null : `${desk.path}\u0000${desk.address ?? ''}`;
    void bridge.takeBackQueue(target).then((answer) => {
      // The line did not come back, so it is still waiting behind the run. The
      // screen keeps showing it, and the person is told rather than left with a
      // press that appeared to work.
      if (!answer.ok) {
        troubleAt(target, answer.trouble);
        return;
      }
      const words = tookBack(answer.value);
      // Nothing was queued: nothing to put in the box, and nothing on screen to
      // clear.
      if (words.length === 0) return;
      setDraft((was) => intoTheBox(was, words));
      if (owner !== null) setQueued((was) => ({ ...was, [owner]: [] }));
    });
  }, [troubleAt]);

  /**
   * The answer to "this is a bigger job".
   *
   * Saying no does not throw the message away and does not send a smaller
   * version of it on somebody's behalf — it says one sentence and leaves the
   * next move with them. Guessing at "smaller" would be us deciding what to
   * build, which is the one thing this confirmation exists to avoid.
   */
  const answerEstimate = useCallback(
    (answered: EstimateTurn, go: boolean) => {
      setDesks((current) =>
        changeCurrent(current, (one) => ({
          ...one,
          turns: one.turns.flatMap((turn): Turn[] => {
            if (turn.kind !== "estimate" || turn.id !== answered.id)
              return [turn];
            return go
              ? [{ ...turn, answered: "went-ahead" }]
              : [
                  { ...turn, answered: "smaller" },
                  said("graphe", smallerFirst),
                ];
          }),
        })),
      );
      // The message was never sent, so sending it now is the whole of "go
      // ahead". Sized again rather than remembered: the same sentence gives the
      // same answer, and one fewer thing on the turn is one fewer thing to keep
      // in step.
      if (go) void deliver(answered.text, sizeUp(answered.text));
    },
    [deliver],
  );

  /**
   * The answer to "here's what I'd do".
   *
   * Going ahead sends the same sentence again with the looking-around pass off,
   * so the plan is carried out rather than described a second time. Changing
   * something first puts their own words back in the box, where they can be
   * edited — nothing is sent on anybody's behalf.
   */
  const answerPlan = useCallback(
    (
      turnId: string,
      go: boolean,
      chosen?: {
        kept: readonly string[];
        dropped: readonly string[];
        decision?: PlanDecision;
      },
    ) => {
      const text = asked.current;
      // The steps the agent proposed for this plan, read before the answer is
      // written — the build-plan store wants the real task list.
      const planTurn =
        desk === null ? null : desk.turns.find((turn): turn is Extract<typeof turn, { kind: "plan" }> => turn.kind === "plan" && turn.id === turnId);
      const steps = planTurn === undefined || planTurn === null ? [] : planTurn.steps;
      setDesks((current) =>
        changeCurrent(current, (one) => ({
          ...one,
          turns: one.turns.map((turn) =>
            turn.kind === "plan" && turn.id === turnId
              ? { ...turn, answered: go ? ("went-ahead" as const) : ("changing" as const) }
              : turn,
          ),
        })),
      );
      if (text === "") return;
      asked.current = "";
      // The look-around has been answered here. Without this the next thing
      // somebody typed counted as the answer to it and skipped its own list,
      // so every message straight after an accepted plan got none.
      justLookedFirst.current = false;
      if (go) {
        // A build plan keeps the real task list the agent proposed, so a
        // resumed session knows each step and where it got to.
        // Only what was agreed to. The build plan tracks the same list, so a
        // resumed session does not carry on with a step somebody struck out.
        const dropped = chosen?.dropped ?? [];
        // Already in the order somebody put them in, which is why this reads
        // the kept list even when nothing was struck out.
        const agreed = chosen?.kept ?? steps;
        const path = desks.current;
        if (path !== null && agreed.length > 0) {
          void bridge.buildSave(
            agreed.map((step) => ({ title: step, acceptance: "" })),
            { project: path },
          ).then(() => void refreshBuildPlan(path));
        }
        // Saying which steps to leave out as well as which to do: a model told
        // only what to do will helpfully do the rest of what it proposed.
        // Everything they did to the plan — struck, moved, annotated, answered
        // — in one paragraph. Null when they agreed to it exactly as proposed,
        // which is the common case and sends their own sentence untouched.
        const extra =
          chosen?.decision === undefined
            ? dropped.length === 0
              ? null
              : PLAN_WORDS.doThese(agreed, dropped)
            : decidedMessage(chosen.decision);
        const withExtra = extra === null ? text : `${text}\n\n${extra}`;
        // A list nobody told the model about is a list nobody ticks.
        const say = agreed.length > 0 ? `${withExtra}\n\n${PLAN_WORDS.ticking}` : withExtra;
        void deliver(say, sizeUp(say), { lookFirst: false });
      } else setDraft(text);
    },
    [deliver, desk, desks, refreshBuildPlan],
  );

  /**
   * "Fix the blocking ones" from a review card.
   *
   * The card names the findings; the button sends one sentence back asking for
   * the blocking ones fixed. Nothing is sent on anybody's behalf beyond the
   * ask itself — the agent goes and reads the findings it wrote.
   */
  /** Send the findings back to the pull request they are about. The app posts
   *  it rather than the agent, so no shell and no question stand between a
   *  finished review and the people waiting on it. */
  const postReview = useCallback(
    async (verdict: ReviewVerdict): Promise<boolean> => {
      if (verdict.pull === undefined) return false;
      const path = desks.current;
      const sent = await bridge.repoComment(verdict.pull, reviewAsMarkdown(verdict), {
        project: path ?? undefined,
      });
      return sent.ok;
    },
    [desks.current],
  );

  const fixReview = useCallback(
    (turnId: string) => {
      setDesks((current) =>
        changeCurrent(current, (one) => ({
          ...one,
          turns: one.turns.map((turn) =>
            turn.kind === "review" && turn.id === turnId
              ? { ...turn, asked: true }
              : turn,
          ),
        })),
      );
      const text =
        "Fix the blocking findings from the review I just asked for — the P0 and P1 ones — and tell me what you changed.";
      void deliver(text, sizeUp(text), { lookFirst: false });
    },
    [deliver],
  );

  /* "Get on with it" means what it says: a plan is there to be built, not to
     sit waiting for a click while somebody stepped away. Where the project's
     hold-back is off, an unanswered plan approves itself the moment it lands,
     so a big document can be kicked off and left alone.*/
  useEffect(() => {
    if (desk === null) return;
    // "Until it's done" is itself the answer, whatever the project's hold-back
    // says: somebody who picked it has already said not to stop and ask.
    if (howFar !== 'doing' && holdsBack(preferences.heldBack, desk.path)) return;
    const waiting = desk.turns.find((one) => one.kind === 'plan' && one.answered === null);
    if (waiting === undefined || waiting.kind !== 'plan') return;
    // A plan that asked something must never answer itself. Asking two
    // questions and then answering them yourself is worse than never asking.
    if (waiting.questions.length > 0) return;
    answerPlan(waiting.id, true);
  }, [desk, preferences.heldBack, answerPlan, howFar]);

  const respond = useCallback(
    (turnId: string, callId: string, decision: Decision) => {
      setDesks((current) =>
        changeCurrent(current, (one) => ({
          ...one,
          turns: one.turns.map((turn) =>
            turn.kind === "asked" && turn.id === turnId
              ? { ...turn, answered: decision }
              : turn,
          ),
        })),
      );
      const here = currentDesk(desksNow.current);
      void bridge.answer(callId, decision, {
        ...(here === null ? {} : { project: here.path }),
        ...(here?.address == null ? {} : { conversation: here.address }),
      });
    },
    [],
  );

  /**
   * The answer to the questions asked before the work started.
   *
   * Null is a real answer — "just decide for me" — and the shell reads it as
   * one. The turn is closed here rather than waited on: the agent withdraws
   * every ask it answers, and a card still open when that arrives would be
   * marked as never answered at all.
   */
  const answerAsked = useCallback((turnId: string, answers: Answers | null) => {
    setDesks((current) =>
      changeCurrent(current, (one) => ({
        ...one,
        turns: one.turns.map((turn) =>
          turn.kind === "asked-first" && turn.id === turnId
            ? {
                ...turn,
                answers: answers ?? {},
                answered:
                  answers === null
                    ? ("waved-through" as const)
                    : ("answered" as const),
              }
            : turn,
        ),
      })),
    );
    const here = currentDesk(desksNow.current);
    void bridge.answerAsked(turnId, answers, {
      ...(here === null ? {} : { project: here.path }),
      ...(here?.address == null ? {} : { conversation: here.address }),
    });
  }, []);

  const dismiss = useCallback((turnId: string) => {
    setDesks((current) =>
      changeCurrent(current, (one) => ({
        ...one,
        turns: one.turns.filter((turn) => turn.id !== turnId),
      })),
    );
  }, []);

  /* -------------------------------------------------------------- versions */

  const putBack = useCallback(
    async (versionId: string, repo?: string) => {
      const path = desks.current;
      if (path === null) return;
      goBusy();
      try {
        const answer = await bridge.putBack(versionId, {
          project: path,
          ...(repo === undefined ? {} : { repo }),
        });
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setDesks((current) =>
          changeDesk(current, path, (one) => ({
            ...one,
            ...(repo === undefined
              ? { versions: answer.value.versions }
              : { repoVersions: { ...one.repoVersions, [repo]: answer.value.versions } }),
            putBack: answer.value,
          })),
        );
      } finally {
        goQuiet();
      }
    },
    [desks.current, troubleHere],
  );

  const nameVersion = useCallback(
    async (versionId: string, name: string, repo?: string) => {
      const path = desks.current;
      if (path === null) return;
      const answer = await bridge.nameVersion(versionId, name, {
        project: path,
        ...(repo === undefined ? {} : { repo }),
      });
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setDesks((current) =>
        changeDesk(current, path, (one) => ({
          ...one,
          ...(repo === undefined
            ? { versions: answer.value }
            : { repoVersions: { ...one.repoVersions, [repo]: answer.value } }),
        })),
      );
    },
    [desks.current, troubleHere],
  );

  /** Keeping is instant on screen and confirmed underneath, like "Show me":
   *  the mark in the corner of a card must land on the click, and the answer
   *  from the shell is what survives if the write did not. */
  const keepVersion = useCallback((versionId: string, keep: boolean) => {
    const path = desks.current;
    if (path === null) return;
    setPreferences((was) => ({ ...was, kept: keeping(was.kept, path, versionId, keep) }));
    void bridge.keepVersion(versionId, keep).then((answer) => {
      if (answer.ok) setPreferences(answer.value);
    });
  }, [desks.current]);

  const dismissPutBack = useCallback(() => {
    setDesks((current) =>
      changeCurrent(current, (one) => ({ ...one, putBack: null })),
    );
  }, []);

  /* ---------------------------------------------------------- landing it */

  /**
   * What can be done with the work now that it exists.
   *
   * Asked for rather than assumed, and asked for again after anything that
   * could change the answer — connecting an account, handing work over,
   * switching project. The shell remembers the expensive parts of the answer
   * for a few minutes, so asking often is cheap.
   */
  const [landing, setLanding] = useState<LandingState | null>(null);
  const [going, setGoing] = useState<"developer" | "online" | null>(null);
  const [landed, setLanded] = useState<Outcome>(null);
  const [decided, setDecided] = useState<{ letIn: boolean; undoTo: string } | null>(null);

  const refreshLanding = useCallback((path: string | null) => {
    if (path === null) return;
    // A project is named so a slow answer from another project cannot land here
    // and repaint this panel — the same gap the away board had until that fix.
    const named = panelRepoNow.current;
    void bridge
      .landing({ project: path, ...(named === null ? {} : { repo: named }) })
      .then((answer) => {
        setLanding(answer.ok ? answer.value : null);
      });
  }, []);

  useEffect(() => {
    if (desks.current === null) {
      setLanding(null);
      return;
    }
    setLanded(null);
    setDecided(null);
    refreshLanding(desks.current);
  }, [desks.current, refreshLanding]);

  /**
   * The Figma file this project is kept in step with.
   *
   * Asked for when a project comes to the front and looked at again on demand.
   * Never on a timer: reading somebody's Figma file on a schedule they did not
   * ask for is somebody else's product.
   */
  const [inStep, setInStep] = useState<InStepState | null>(null);
  const [lookingAtFigma, setLookingAtFigma] = useState(false);

  useEffect(() => {
    if (desks.current === null) {
      setInStep(null);
      return;
    }
    void bridge.inStep().then((answer) => {
      setInStep(answer.ok ? answer.value : null);
    });
  }, [desks.current]);

  /** Every one of these answers with the whole of it, so the band never has to
   *  work out what changed about itself. */
  const askFigma = useCallback(
    (ask: () => Promise<Result<InStepState>>) => {
      setLookingAtFigma(true);
      void ask()
        .then((answer) => {
          if (answer.ok) setInStep(answer.value);
          else troubleHere(answer.trouble);
        })
        .finally(() => setLookingAtFigma(false));
    },
    [troubleHere],
  );

  const changeKeepLogins = useCallback(
    (on: boolean) => {
      const path = desks.current;
      setPreferences((was) =>
        path === null ? was : { ...was, keptLogins: { ...was.keptLogins, [path]: on } },
      );
      void bridge.setKeepLogins(on, { project: path ?? undefined }).then((answer) => {
        if (answer.ok) setPreferences(answer.value);
      });
    },
    [desks.current],
  );

  const changeHoldBack = useCallback(
    (on: boolean) => {
      const path = desks.current;
      setPreferences((was) =>
        path === null ? was : { ...was, heldBack: { ...was.heldBack, [path]: on } },
      );
      setLanding((was) => (was === null ? was : { ...was, holdBack: on }));
      void bridge.setHoldBack(on, { project: path ?? undefined }).then((answer) => {
        if (answer.ok) setPreferences(answer.value);
        refreshLanding(path);
      });
    },
    [desks.current, refreshLanding],
  );

  const decideOnWork = useCallback(
    (letIn: boolean, observed = true) => {
      const here = currentDesk(desksNow.current);
      if (here === null) return;
      const path = here.path;
      goBusy();
      void bridge
        .decideOnWork(letIn, observed, {
          project: here.path,
          ...(here.address == null ? {} : { conversation: here.address }),
        })
        .then((answer) => {
          if (!answer.ok) {
            troubleHere(answer.trouble);
            return;
          }
          setLanding(answer.value.landing);
          setDecided(
            answer.value.undoTo === null
              ? null
              : { letIn: answer.value.letIn, undoTo: answer.value.undoTo },
          );
          setDesks((current) =>
            changeDesk(current, path, (one) => ({ ...one, versions: answer.value.versions })),
          );
          void refreshOverview(path);
        })
        .finally(() => goQuiet());
    },
    [desks.current, refreshOverview, troubleHere],
  );

  /* How far the waiting work has moved from the pictures that were agreed to,
     read against the line in force. Null when nothing was compared: an empty
     set is the absence of a reading, never a reading of "nothing moved". */
  const gate = useMemo(() => {
    const changes = landing?.held?.changes ?? [];
    return changes.length === 0 ? null : gateOf(changes, howMuchBy(preferences.howMuch));
  }, [landing?.held?.changes, preferences.howMuch]);

  const changeHowMuch = useCallback((id: string) => {
    setPreferences((was) => ({ ...was, howMuch: howMuchBy(id).id }));
    void bridge.setHowMuch(id).then((answer) => {
      if (answer.ok) setPreferences(answer.value);
    });
  }, []);

  /* Nothing has moved far enough since the picture somebody last agreed to, so
     nobody is asked: the work goes in and the undo sits where the question
     would have been. Auto-clear deliberately does not move that picture. Small
     changes therefore accumulate until somebody actually looks and agrees.

     A first or unchecked picture still asks: there is no honest baseline until
     a person has seen one. Once per piece of work, whatever comes back — a
     refusal must not become a loop of the window trying again forever. */
  const letThrough = useRef<string | null>(null);
  useEffect(() => {
    const waiting = landing?.waiting ?? null;
    if (waiting === null || waiting.state !== 'waiting') return;
    if (gate === null || gate.standing !== 'clear') return;
    if (letThrough.current === waiting.id) return;
    letThrough.current = waiting.id;
    decideOnWork(true, false);
  }, [landing?.waiting, gate?.standing, decideOnWork]);

  /** The two that can send something off this computer. Both are only ever
   *  called from the band's own confirmation, which has already said what is
   *  about to happen — this is the press, not the offer. */
  const handToDeveloper = useCallback((repo?: string) => {
    setGoing("developer");
    setLanded(null);
    void bridge
      .handToDeveloper(true, repo === undefined ? undefined : { repo })
      .then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setLanded({ kind: "handed", handed: answer.value });
      })
      .finally(() => {
        setGoing(null);
        refreshLanding(desks.current);
      });
  }, [desks.current, refreshLanding, troubleHere]);

  /** The two moves on the lines of work: switch onto another one, or start a
   *  new one. Both change what the project on screen is, so after either one
   *  the readings that describe it are asked for again — the versions, the
   *  overview, and the band that answers "what now?". */
  /* Read the current desk at the press, not the value from the first render.
     A parallel conversation may live in its own checkout: its branch control
     must address that conversation rather than silently moving the project’s
     primary checkout. */
  const branchMove = useCallback(
    (move: (where: Where) => Promise<Result<null>>, repo?: string) => {
      const here = currentDesk(desksNow.current);
      if (here === null) return;
      const where: Where = {
        project: here.path,
        ...(here.address == null ? {} : { conversation: here.address }),
        ...(repo === undefined ? {} : { repo }),
      };
      void move(where).then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        void refreshVersions(here.path);
        void refreshOverview(here.path, here.address);
        refreshLanding(here.path);
      });
    },
    [refreshVersions, refreshOverview, refreshLanding, troubleHere],
  );

  // One place reads which folder/conversation is in front, and it is the one above.
  const switchBranch = useCallback(
    (name: string, repo?: string) => {
      branchMove((where) => bridge.branchSwitch(name, where), repo);
    },
    [branchMove],
  );

  const createBranch = useCallback(
    (name: string, repo?: string) => {
      branchMove((where) => bridge.branchCreate(name, where), repo);
    },
    [branchMove],
  );

  /* ------------------------------------------- while you are not looking */

  /**
   * What is happening for each project whether or not this window is open.
   *
   * Kept per folder, for the same reason the pictures and the files are: a run
   * can land for a project somebody has just switched away from, and it must
   * never be drawn under another folder's name.
   */
  const [away, setAway] = useState<Readonly<Record<string, AwayState>>>({});
  const awayHere = desks.current === null ? null : (away[desks.current] ?? null);

  /* Everything reachable by name. `ready` is false rather than absent when a
     thing needs a project open — an action that vanishes teaches nobody where
     it went. */
  const everyCommand = useMemo(() => {
    const here = desks.current !== null;
    const needsProject = 'Open a project first.';
    const made = [
      { id: 'new', name: 'Start a new conversation', where: 'Conversation', keys: 'mod+shift+n',
        run: () => void swapConversation(null), ready: here, whyNot: needsProject },
      { id: 'design', name: 'Open the design view', where: 'Conversation', keys: 'mod+d',
        run: () => { goToScreen('design'); setDesignAt('styles'); }, ready: here, whyNot: needsProject },
      { id: 'files', name: 'Show everything in this project', where: 'Project', keys: 'mod+shift+f',
        run: () => setFilesOpen(true), ready: here, whyNot: needsProject },
      { id: 'page', name: 'Show the page beside the conversation', where: 'Conversation', keys: 'mod+j',
        run: () => togglePane(), ready: here, whyNot: needsProject },
      { id: 'shelf', name: 'Show or hide the shelf', where: 'Conversation', keys: 'mod+b',
        run: () => setShelfOpen((was) => !was) },
      { id: 'changes', name: 'Review the working diff', where: 'Project',
        run: () => {
          setChangeText(null);
          setChangesOpen(true);
          void bridge
            .changesLook(actingRepo === null ? undefined : { repo: actingRepo })
            .then((answer) => {
              // A refusal read as "nothing has changed", which is a different
              // sentence and not a true one.
              if (!answer.ok) {
                setChangesOpen(false);
                troubleHere(answer.trouble);
                return;
              }
              setChangeText(answer.value);
            });
        }, ready: here, whyNot: needsProject },
      { id: 'history', name: 'Look through the history', where: 'Project',
        run: () => goToScreen('graph'), ready: here, whyNot: needsProject },
      { id: 'reviews', name: 'Read the pull requests', where: 'Project',
        run: () => { goToScreen('reviews'); refreshRepo(); }, ready: here, whyNot: needsProject },
      { id: 'skills', name: 'Look at the skills', where: 'Graphe',
        run: () => { goToScreen('skills'); refreshSkills(); refreshWorkflows(); setSkillsOpen(true); } },
      { id: 'connected', name: 'Other tools', where: 'Graphe',
        run: () => { goToScreen('connected'); setConnectedOpen(true); void refreshConnected(); } },
      { id: 'more', name: 'Add more to Graphe', where: 'Graphe', run: () => openAddMore() },
      { id: 'model', name: 'Change which model answers', where: 'Graphe', run: () => openConnect() },
      { id: 'usage', name: 'See what this cost', where: 'Graphe', run: () => goToScreen('usage') },
      { id: 'open', name: 'Open another project', where: 'Project', keys: 'mod+o', run: () => void browse() },
      { id: 'tidy', name: 'Compact the context', where: 'Conversation',
        run: () => tidyNow(), ready: here, whyNot: needsProject },
      { id: 'stop', name: 'Stop what is running', where: 'Conversation',
        run: () => halt(), ready: busy, whyNot: 'Nothing is running.' },
    ];
    return made.map((one) => ({ ...one, run: () => { setPaletteOpen(false); one.run(); } }));
  }, [
    desks.current, busy, swapConversation, goToScreen, togglePane, refreshRepo, refreshSkills,
    refreshWorkflows, refreshConnected, openAddMore, openConnect, browse, tidyNow, halt,
  ]);

  /* The line for the conversation in front, as words with a place each. */
  const waitingHere = useMemo(() => {
    const desk = currentDesk(desks);
    if (desk === null) return [];
    const owner = `${desk.path}\u0000${desk.address ?? ''}`;
    return (queued[owner] ?? []).map((text, at) => ({ id: `${owner}-${String(at)}`, text }));
  }, [desks, queued]);

  /* Every other folder that has anything of its own going on. Work does not
     stop because somebody opened another project, and this is the only place
     that says so. */
  const awayElsewhere = useMemo(
    () =>
      Object.entries(away)
        .filter(([path, state]) => path !== desks.current && state.pieces.length > 0)
        .map(([path, state]) => ({ where: path, project: folderCalled(path), away: state })),
    [away, desks.current],
  );

  /* The board says how long ago each thing was, so the window needs a clock of
     its own. Half a minute is finer than anything it draws. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const refreshAway = useCallback(async (path: string) => {
    const answer = await bridge.away({ project: path });
    if (!answer.ok || desksNow.current.current !== path) return;
    setAway((current) => ({ ...current, [path]: answer.value }));
  }, []);

  useEffect(() => {
    const path = desks.current;
    if (path === null) return;
    void refreshAway(path);
  }, [desks.current, refreshAway]);

  /* Pushed at the window whenever something lands, including the first moment
     after it has been away and come back. Subscribed once. */
  useEffect(() => {
    const stopAway = bridge.onAway((notice) => {
      setAway((current) => ({ ...current, [notice.project]: notice.away }));
      setNow(Date.now());
    });
    // The checklist, while the reply is still going. The model ticks its own
    // items off now, so this is the only thing that shows it moving.
    const stopPlan = bridge.onBuildPlan((notice) => {
      setBuildPlan(notice.plan === null ? null : { path: notice.project, plan: notice.plan });
    });
    return () => {
      stopAway();
      stopPlan();
    };
  }, []);

  /* Every folder's board, once, on the way in. Notices arrive as things happen;
     without this first read, work already running in a project nobody has
     opened yet would be invisible until it next moved. */
  useEffect(() => {
    void bridge.awayEverywhere().then((answer) => {
      if (!answer.ok) return;
      setAway((current) => {
        const next = { ...current };
        for (const notice of answer.value) next[notice.project] = notice.away;
        return next;
      });
    });
  }, []);

  /** Everything the band can do comes back with the whole state, so the window
   *  never has to work out what its own press did. */
  const afterAway = useCallback((path: string) => {
    return (answer: { ok: true; value: AwayState } | { ok: false; trouble: Trouble }) => {
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setAway((current) => ({ ...current, [path]: answer.value }));
    };
  }, [troubleHere]);

  const keepGoing = useCallback(
    (text: string, untilDone = false) => {
      const path = desks.current;
      if (path === null) return;
      void bridge.keepGoing(text, untilDone, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway],
  );

  /** The same ask, in order: this one waits until that one has finished. The
   *  shell refuses a plan that could never run, and says why. */
  const startAfter = useCallback(
    (text: string, after: string) => {
      const path = desks.current;
      if (path === null) return;
      // A plan that could never run comes back refused, with the reason in
      // plain words — the same door every other failure comes through.
      void bridge.startAfter(text, after, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway, troubleHere],
  );

  const keepAway = useCallback(
    // `then` is how a sheet finds out whether the press worked, so it can stay
    // where it is and show the reason when it did not.
    (id: string, where?: string, then?: (ok: boolean) => void) => {
      const path = where ?? desks.current;
      if (path === null) return;
      void bridge.keepAway(id, { project: path }).then((answer) => {
        afterAway(path)(answer);
        // Keeping one is a version like any other, and the rail has to say so.
        void refreshVersions(path);
        void refreshOverview(path);
        then?.(answer.ok);
      });
    },
    [desks.current, afterAway, refreshVersions, refreshOverview],
  );

  const dropAway = useCallback(
    (id: string, where?: string) => {
      const path = where ?? desks.current;
      if (path === null) return;
      void bridge.stopAway(id, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway],
  );

  /** The one press that can answer a question a run stopped on. Nothing else in
   *  this window, and nothing at all on the other side, can. */
  const answerAway = useCallback(
    (id: string, callId: string, decision: Decision, where?: string) => {
      const path = where ?? desks.current;
      if (path === null) return;
      void bridge.answerAway(id, callId, decision, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway],
  );

  /** The several goes at one job, held up against each other. Read on the
   *  press: a go still working has a different answer a minute later. */
  const [against, setAgainst] = useState<{
    where: string;
    /** What the goes are goes at, for the strip that stands against them. */
    subject: string;
    sides: readonly SideOfWork[];
  } | null>(null);

  const compareWays = useCallback(
    (named: string, where?: string) => {
      const path = where ?? desks.current;
      if (path === null) return;
      void bridge.compareWays(named, { project: path }).then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        // Nothing left of the group to hold up against anything: an empty
        // sheet would be a screen with nothing on it and no way to read why.
        if (answer.value.length === 0) return;
        setAgainst({ where: path, subject: named, sides: answer.value });
      });
    },
    [desks.current, troubleHere],
  );

  /** Take several finished pieces in, in the order they need to be in.
   *  Whatever happens, the whole run is one version away from undone. */
  const takeAll = useCallback(
    (ids: readonly string[], where?: string) => {
      const path = where ?? desks.current;
      if (path === null) return;
      void bridge.keepSet(ids, { project: path }).then((answer) => {
        afterAway(path)(answer);
        // A set landing is a version like any other, and the rail has to say so.
        void refreshVersions(path);
        void refreshOverview(path);
      });
    },
    [desks.current, afterAway, refreshVersions, refreshOverview],
  );

  /** Let a piece off the wait it was given, so it takes the next free slot.
   *  The wait could be set when work was asked for and never changed after —
   *  a piece waiting on something abandoned waited for good. */
  const stopWaiting = useCallback(
    (id: string, where?: string) => {
      const path = where ?? desks.current;
      if (path === null) return;
      void bridge.putAfter(id, null, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway],
  );

  /**
   * Serve every go in the comparison and put them in the pane.
   *
   * A patch says what changed; a running copy says what it looks like, which is
   * the half a designer decides on. Each go already has a copy of its own, so
   * this only makes them ready and points the pane at them — nothing new is
   * built and nothing is written.
   */
  const openWaysInBrowser = useCallback(() => {
    const set = against;
    if (set === null) return;
    const members = set.sides
      .filter((one) => one.folder !== null)
      .map((one) => ({ id: one.id, name: one.name, folder: one.folder as string }));
    if (members.length === 0) return;
    void bridge
      .variationsServe({ subject: set.subject, variations: members }, { project: set.where })
      .then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        // Asked something back rather than served: it is a question, not a set.
        if (answer.value.kind === 'unsure') {
          troubleHere({ what: answer.value.question, because: '', actionLabel: 'Got it' });
          return;
        }
        const first = answer.value.variations[0];
        if (first === undefined) return;
        setAgainst(null);
        setVariations({
          subject: answer.value.subject,
          members: answer.value.variations,
          inFront: first.id,
        });
        setPageAt(first.address);
        movePane('split');
      });
  }, [against, troubleHere, movePane]);

  /** A sentence into work already going. It is heard between steps, so nothing
   *  half-done is thrown away to make room for it. */
  const sayToAway = useCallback(
    async (id: string, text: string, where?: string): Promise<boolean> => {
      const path = where ?? desks.current;
      if (path === null) return false;
      const answer = await bridge.sayToAway(id, text, { project: path });
      afterAway(path)(answer);
      // Handed back so the card can wait to say it was heard. A refusal is
      // already on screen as a sheet; a note beside it saying the opposite is
      // the one pair of sentences a person cannot reconcile.
      return answer.ok;
    },
    [desks.current, afterAway],
  );

  const addRepeat = useCallback(
    (doing: string, every: EveryKind, at: { hour: number; minute: number }, on?: number) => {
      const path = desks.current;
      if (path === null) return;
      void bridge.addRepeat(doing, every, at, on, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway],
  );

  const switchRepeat = useCallback(
    (id: string, on: boolean) => {
      const path = desks.current;
      if (path === null) return;
      void bridge.switchRepeat(id, on, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway],
  );

  const forgetRepeat = useCallback(
    (id: string) => {
      const path = desks.current;
      if (path === null) return;
      void bridge.forgetRepeat(id, { project: path }).then(afterAway(path));
    },
    [desks.current, afterAway],
  );

  /** One value moved, from wherever the panel offered it: a slider, or a colour
   *  nobody could read against the one underneath it. Filed in the draft and
   *  nothing more — the project is untouched until "Save changes" is pressed. */
  const nudge = useCallback((name: string, value: string) => {
    setDesignDraft((current) => {
      const path = desks.current;
      if (path === null) return current;
      const here = current[path] ?? { tokens: {}, motions: [] };
      return {
        ...current,
        [path]: { ...here, tokens: { ...here.tokens, [name]: value } },
      };
    });
  }, [desks.current]);

  /* Same bargain as a colour: the change waits in the draft, and lands with the
     whole batch the moment somebody saves. */
  const nudgeMotion = useCallback(
    (move: { places: readonly unknown[] }, change: unknown) => {
      setDesignDraft((current) => {
        const path = desks.current;
        if (path === null) return current;
        const here = current[path] ?? { tokens: {}, motions: [] };
        return { ...current, [path]: { ...here, motions: [...here.motions, { places: move.places, change }] } };
      });
    },
    [desks.current],
  );

  /** "Save changes": write the draft to the stylesheet and keep it as one
   *  version, then let go of the draft. Nothing has been saved until this. */
  const commitDesign = useCallback(() => {
    const path = desks.current;
    if (path === null) return;
    const draft = designDraft[path];
    if (draft === undefined) return;
    const tokens = Object.entries(draft.tokens).map(([name, value]) => ({ name, value }));
    if (tokens.length === 0 && draft.motions.length === 0) return;
    const named = panelRepoNow.current ?? actingRepoNow.current;
    void bridge
      .designCommit(
        { tokens, motions: draft.motions },
        named === null ? undefined : { repo: named },
      )
      .then((answer) => {
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setDesignDraft((current) => {
        if (current[path] === undefined) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      setDesks((current) =>
        current.current === path
          ? changeDesk(current, path, (one) => ({ ...one, versions: answer.value }))
          : current,
      );
      void refreshOverview(path);
    });
  }, [designDraft, desks.current, refreshOverview]);

  /** Throw the draft away. Nothing was ever written, so there is nothing to
   *  undo — forgetting the values is all there was. */
  const discardDesign = useCallback(() => {
    const path = desks.current;
    if (path === null) return;
    setDesignDraft((current) => {
      if (current[path] === undefined) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, [desks.current]);

  /** Whether the project in front has edits waiting to be saved. */
  const designDirty = useCallback((): boolean => {
    const path = desk === null ? null : desk.path;
    if (path === null) return false;
    const here = designDraft[path];
    if (here === undefined) return false;
    return Object.keys(here.tokens).length > 0 || here.motions.length > 0;
  }, [desk, designDraft]);

  /** The stylesheet with the draft edits laid over it, so the design view shows
   *  what is being tested without anything reaching the project. */
  const designStyles = useMemo(() => {
    const inside = desk?.overview?.repos ?? [];
    const named = inside.find((one) => one.name === panelRepo)?.name ?? inside[0]?.name ?? null;
    const sheet =
      named === null ? (desk?.overview?.styles ?? null) : (desk?.repoStyles[named] ?? null);
    return withDesignDraft(sheet, desk === null ? undefined : designDraft[desk.path]);
  }, [desk, desk?.overview?.styles, desk?.repoStyles, panelRepo, designDraft]);

  /** What the project's own stylesheet says about itself: how it moves, what
   *  was written by hand, what cannot be read. One reading, shared by the panel
   *  that counts it and the view that draws it. */
  const design = useMemo(
    () => readDesign(designStyles, desk?.overview?.swatches ?? []),
    [designStyles, desk?.overview?.swatches],
  );

  useEffect(() => setFixing(null), [desk?.overview?.styles]);

  /* A native view paints above the window's own contents, so anything that
     would cover it has to take it off screen first. */
  const covered =
    watchAt !== null ||
    designAt !== null ||
    graphOpen ||
    reviewsOpen ||
    helpersAt !== null ||
    connectOpen ||
    addMore ||
    composerPopoverOpen;
  useEffect(() => {
    if (pane === 'off') return;
    void bridge.pageHidden(covered);
  }, [covered, pane]);

  /* The page closes when the pane does, rather than lingering behind a window
     that is no longer showing it. */
  useEffect(() => {
    if (pane !== 'off') return;
    void bridge.pageAt(null, null);
  }, [pane]);

  /**
   * Record somebody using the page, and keep what it saw.
   *
   * Nothing is asked for first: the states worth arguing about — hovered,
   * loading, empty, the message that shows for two seconds — only exist while
   * somebody is using the page, so anything that has to be filled in beforehand
   * is a state already gone. What comes back goes into the conversation, where
   * everything else about the work already is.
   */
  const record = useCallback((want: boolean) => {
    if (want) {
      setRecorded(null);
      void bridge.watchStart().then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setRecording(true);
      });
      return;
    }
    // Off the moment it is pressed, whatever the run turns out to hold: a
    // control that stays lit while the pictures come back reads as one that
    // did not hear the press.
    setRecording(false);
    void bridge.watchStop().then((answer) => {
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setRecorded(recordedIn(desksNow.current.current, answer.value));
    });
  }, [troubleHere]);

  /* Closing the pane takes the page with it, so a run against it is over
     whether or not anybody pressed stop — and what it saw is kept, because
     closing the page is not asking to throw the last few minutes away. */
  useEffect(() => {
    if (pane !== 'off' || !recording) return;
    record(false);
  }, [pane, recording, record]);

  /* ------------------------------------------------------------------ money */

  /**
   * "See where it went": the split between the work and our own retries.
   *
   * It is said in the conversation rather than shown in a panel, because it is
   * us telling somebody something, and because the sentence that admits what
   * our mistakes cost them should sit in the same thread as everything else we
   * said — not in a report they have to go and open.
   */
  const showSplit = useCallback(async () => {
    // Asked for, not waited for. The split arrives as an aside to a settled
    // sitting, so a window that has not seen one yet had a button that did
    // nothing — which is worse than a button that is not there.
    const known = desk?.spent?.split;
    const split = known ?? (await bridge.spendSplit().then((answer) => (answer.ok ? answer.value : null)));
    if (!split) {
      say(nothingSpentYet);
      return;
    }
    const usage = desk?.spent?.usage;
    const extra: string[] = [];
    if (usage?.reusedShare !== null && usage?.reusedShare !== undefined) {
      extra.push(meter.reused(usage.reusedShare));
    }
    const body = [
      ...sessionSummary(split).lines,
      ...extra,
      '',
      retryHonesty,
    ].join('\n');
    say(body);
  }, [desk, say]);

  const openSettingsLink = useCallback(
    (link: SettingsLink) => {
      switch (link) {
        case 'skills':
          goToScreen("skills");
          refreshSkills();
          refreshWorkflows();
          setSkillsOpen(true);
          return;
        case 'always': {
          // The file is the whole feature, so this opens the file.
          const file = alwaysNow?.file ?? '';
          if (file !== '') void bridge.openInEditor(file);
          return;
        }
        case 'connected':
          goToScreen("connected");
          setConnectedOpen(true);
          void refreshConnected();
          return;
        case 'add-more':
          goToScreen("add-more");
          openAddMore();
          return;
        case 'usage':
          goToScreen("usage");
          setUsageOpen(true);
          return;
        case 'folder':
          revealFolder();
          return;
        case 'editor':
          openInEditor();
          return;
        default:
          return;
      }
    },
    [refreshSkills, openAddMore, showSplit, revealFolder, openInEditor],
  );

  /* ----------------------------------------------------------------- see it */

  /**
   * Get the project ready and open it.
   *
   * Whatever the project makes, served from this machine and opened in their own
   * browser — never the thing a developer runs while they are working. That
   * decision belongs to notes/strategy/SHARING.md §1 and is not the window's to
   * revisit; all this does is press the button and put the answer in the thread.
   */
  const seeIt = useCallback(async (at?: string, point?: boolean, repo?: string) => {
    const askedFor = desks.current;
    if (askedFor === null) return;
    // Said here as well as by the shell, so pressing the button has an answer
    // inside 100ms rather than after a folder has been read.
    setProgress({ says: showWords.puttingTogether, done: false });
    try {
      const answer = await bridge.show(at, point, {
        project: askedFor,
        ...(repo === undefined ? {} : { repo }),
      });
      if (!answer.ok) {
        setProgress(null);
        troubleHere(answer.trouble);
        return;
      }
      if (answer.value.kind === "unsure") {
        setProgress(null);
        // The question lands in the thread, so the thread is where to be looking.
        // Pressing a button in the shelf and being answered off-screen is the
        // same as not being answered at all.
        say(answer.value.question);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        return;
      }
      // "Ready" gets a beat on screen, and the pane beside the conversation
      // opens showing what was served. The page belongs here in the window
      // now, not in a separate browser. Only when the project that asked is
      // still the one in front — a serve that lands after somebody switched
      // must not open the page under a project that did not ask for it.
      const address = answer.value.address;
      if (desksNow.current.current === askedFor) {
        setPageAt(address);
        movePane('split');
      }
      setProgress({ says: showWords.ready, done: true });
      window.setTimeout(() => setProgress(null), 1400);
      // The overview keeps the address of what was just served, so the pill can
      // take you back to it all evening.
      void refreshOverview(askedFor);
    } catch (cause) {
      // Never silent. A progress line that clears on its own is indistinguishable
      // from a preview that opened behind the window.
      setProgress(null);
      troubleHere({
        what: 'I could not put your site together.',
        because: 'Something stopped part-way through, and it did not say what.',
        actionLabel: 'Got it',
        details: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [desks.current, say, troubleHere, refreshOverview, movePane]);

  /* The commits the bar can search. A folder of several projects keeps them per
     project, so they are gathered up and each one remembers where it came from. */
  const fromRepo = useRef<Record<string, string>>({});
  const barVersions = useMemo(() => {
    const inside = desk?.overview?.repos ?? [];
    if (inside.length === 0) {
      fromRepo.current = {};
      return desk?.versions ?? [];
    }
    const seen: Record<string, string> = {};
    const all: SavedVersion[] = [];
    for (const one of inside) {
      for (const version of desk?.repoVersions[one.name] ?? []) {
        seen[version.id] = one.name;
        all.push(version);
      }
    }
    fromRepo.current = seen;
    return all;
  }, [desk?.overview?.repos, desk?.versions, desk?.repoVersions]);

  /* Everything the bar can reach. Held still between renders so the search does
     not re-run on every keystroke elsewhere. */
  const reachable: Things = useMemo(
    () => ({
      projects: recent ?? [],
      conversations,
      pages,
      versions: barVersions,
    }),
    [recent, conversations, pages, barVersions],
  );

  const pick = useCallback(
    (found: Found) => {
      switch (found.kind) {
        case "project":
          void open(found.project.path);
          return;
        case "conversation":
          void swapConversation(found.conversation.path);
          return;
        case "page":
          void seeIt(found.page.route, undefined, panelRepoNow.current ?? undefined);
          return;
        // Going back is snapshotted first and is itself undoable, which is what
        // makes it safe to reach from here rather than only from the rail.
        case "version":
          void putBack(found.version.id, fromRepo.current[found.version.id]);
          return;
        case "say":
          setDraft(found.say);
      }
    },
    [open, swapConversation, seeIt, putBack],
  );

  /* ------------------------------------------------------------------- draw */

  // The first screen is a single centred conversation. Nothing else.
  // Regions appear the first time they have something to say — see
  // notes/strategy/UI-DESIGN.md.
  const pictures = sortPictures(
    desks.current === null ? [] : (changes[desks.current] ?? []),
    desk?.turns ?? [],
  );

  const picking = desk === null && recent !== null && recent.length > 0;
  const empty = desk === null || desk.turns.length === 0;
  // Which regions have earned their place (notes/strategy/UI-DESIGN.md):
  // the shelf the moment there is a folder in front; the overview the moment
  // there is anything at all to tell about the work — a git state, a search, a
  // reference, or a second version. Both appear once and then stay.
  const shelved = desk !== null;
  const research = researchLog(desk?.turns ?? []);
  const helpers = desk === null ? [] : helpersRunning(desk);
  // On the rail, each helper wears the one question it is answering: a run
  // working four angles at once should read as four angles, not as a spinner.
  // The board behind it keeps the whole of what each was asked.
  const angles = asLinesOfEnquiry(helpers);
  const intoIt = lookingInto(helpers);
  const doingNow = nowDoing(desk?.turns ?? []);
  // What it is looking into takes the band while any of it is still out: that
  // is the thing worth reading, and the step underneath it will come back.
  const nowThere = intoIt === null ? doingNow : { ...doingNow, step: intoIt };

  /* The top row is only the conversations open in this project. Projects are
     switched in the sidebar, where the whole project list stays in one stable
     place. `threadsIn` preserves opening order, so selecting a tab never
     shuffles the row beneath the pointer. */
  const tabs: readonly Tab[] = desk === null ? [] : threadsIn(desk).map(({ address, here }) => {
      const turns = here ? desk.turns : (desk.parked[address]?.turns ?? []);
      // `busy` belongs to the window, not a conversation. Applying it to
      // `here` made the spinner jump to whichever tab was clicked while another
      // conversation was doing the work. A live turn is its own evidence.
      const running = turns.some(
        (turn) =>
          (turn.kind === 'said' && turn.from === 'graphe' && turn.streaming) ||
          (turn.kind === 'did' && turn.state === 'running') ||
          turn.kind === 'tidying' && turn.state === 'running',
      );
      return {
        id: `${desk.path}\u0000${address}`,
        title: titleOf(turns),
        project: desk.name,
        projectPath: desk.path,
        state: running || (sendsInTheAir[`${desk.path}\u0000${address}`] ?? 0) > 0
          ? ('working' as const)
          : askingYou(turns) ? ('asking' as const)
          : ('idle' as const),
      };
    });

  openNow.current = tabs.map((one) => one.id);
  atNow.current =
    desks.current === null || desk === null
      ? null
      : `${desks.current}\u0000${desk.address ?? ''}`;
  wantsYouNow.current = tabs.find((one) => one.state === 'asking')?.id;

  /* An account paid for by its own plan is not billed per use, so the meter
     must stop quoting a per-use figure at it as though it were a bill. */
  const onAPlan =
    connection?.providers.find(
      (provider) => provider.providerId === connection.chosen?.providerId,
    )?.subscription === true;
  const hasOverview =
    desk !== null &&
    ((desk.overview?.repos?.length ?? 0) > 0 ||
      desk.overview?.git !== null ||
      research.length > 0 ||
      desk.references.length > 0 ||
      desk.versions.length >= 2);
  if (desk !== null && hasOverview) overviewSeen.current.add(desk.path);
  const overviewed = desk !== null && (hasOverview || overviewSeen.current.has(desk.path));

  // The pill that takes you back to the live preview. It earns its place the
  // moment there is an address to go to — nothing here is worth a button before
  // the work is actually being served.
  const previewUrl = desk?.overview?.preview ?? null;
  pageAtNow.current = pageAt ?? previewUrl;
  const pillShown = desk !== null && (previewUrl !== null || progress !== null);
  const pillLabel = progress !== null ? progress.says : PREVIEW;
  // A folder holding several projects has nothing at the top level to serve —
  // what runs lives inside one of them, and its row is where it is started.
  const severalProjects = (desk?.overview?.repos?.length ?? 0) >= 2;

  /* A folder holding several projects has no history of its own, so "no project
     chosen" cannot mean the parent — it means the first one. */
  const actingRepo = ((): string | null => {
    const inside = desk?.overview?.repos ?? [];
    return inside.length === 0 ? null : (inside[0]?.name ?? null);
  })();
  actingRepoNow.current = actingRepo;
  const historyRepo = ((): string | null => {
    const inside = desk?.overview?.repos ?? [];
    if (inside.length === 0) return null;
    return inside.find((one) => one.name === graphRepo)?.name ?? inside[0]?.name ?? null;
  })();

  // The one region nobody is given: it is here because somebody went and asked
  // for it, and it stays until they say otherwise.
  const filesShown = desk !== null && preferences.showFiles;
  const filesExpanded = filesShown && filesOpen;

  return (
    <main
      className={`app ${empty ? "app--empty" : ""} ${overviewed ? "app--overviewed" : ""} ${shelved ? "app--shelved" : ""} ${shelved && !shelfOpen ? "app--shelfclosed" : ""} ${filesExpanded ? "app--files" : ""} ${pane === "split" ? "app--split" : ""} ${pane === "whole" ? "app--whole" : ""}`}
      ref={scrollRef}
    >
      {bridge.desktop || desk !== null ? (
        <div className="topbar">
          {/* The row of what is open. It replaces nothing — the project's own
              name stays as the way into its other conversations — but it is
              where switching actually happens once there is more than one. */}
          {desk !== null ? (
            <Tabs
              tabs={tabs}
              at={atNow.current}
              onOpen={(id) => void goToTab(id)}
              onClose={(id) => void closeTab(id)}
              onNew={() => void swapConversation(null)}
            />
          ) : null}

          <div className="topbar__project">
            {desk === null ? (
              <span className="topbar__name topbar__name--quiet">Graphe</span>
            ) : (
              <button
                type="button"
                className="topbar__name"
                onClick={() => setSwitching((was) => !was)}
                aria-expanded={switching}
                aria-haspopup="menu"
              >
                {desk.name}
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2.5 4.5 6 8l3.5-3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}

            {switching && recent !== null ? (
              <div className="topbar__switcher" role="menu">
                <ProjectMenu
                  projects={recent}
                  openPath={desks.current}
                  onOpen={(project) => void open(project.path)}
                  onForget={(project) => void forget(project)}
                  onBrowse={() => void browse()}
                  editor={editor}
                  onOpenInEditor={openInEditor}
                  onRevealFolder={revealFolder}
                  showMe={preferences.showMe}
                  onShowMe={changeShowMe}
                  showFiles={preferences.showFiles}
                  onShowFiles={changeShowFiles}
                  onPreview={() => (severalProjects ? movePane('split') : void seeIt())}
                  onAccount={openConnect}
                  onAddMore={openAddMore}
                />
              </div>
            ) : null}
          </div>

          {/* Only where the composer is not: with a project open the chip lives
              in the composer's own row, and two of them saying the same thing
              would be one too many. */}
          {picking ? (
            <div className="topbar__thinking">
              <ThinkingWith
                state={connection}
                onSelect={selectModel}
                onConnect={openConnect}
                onThinking={changeThinking}
                bare
              />
            </div>
          ) : null}

        </div>
      ) : null}

      {/* The preview pill floats over the right edge — near the words about the
          work, not the housekeeping of the top bar. Disabled while a serving is
          on the way, so it cannot be asked twice. One button: pointing lives on
          the page it points at, not in a second pill saying almost the same. */}
      {pillShown ? (
        <div className="previewpill__pair">
          <button
            type="button"
            className="previewpill"
            /* In a folder holding several projects the pill is a way back to
               the page already being served, not a way to start one — starting
               is a press on the project's own row, which is the only place
               that knows which project is meant. */
            onClick={() => (severalProjects ? movePane('split') : void seeIt())}
            disabled={busy || (progress !== null && !progress.done)}
          >
            {pillLabel}
          </button>
        </div>
      ) : null}

      <AskAnything
        things={reachable}
        open={asking}
        onOpenChange={setAsking}
        onPick={pick}
      />

      {shelved ? (
        <Sidebar
          projects={recent ?? []}
          openPath={desks.current}
          onOpen={(project) => void open(project.path)}
          onBrowse={() => void browse()}
          pinned={desk?.references ?? []}
          conversations={conversations}
          openConversation={inConversation}
          onOpenConversation={(path) => void swapConversation(path)}
          onNewConversation={() => void swapConversation(null)}
          open={shelfOpen}
          onToggle={() => setShelfOpen((was) => !was)}
          onAsk={() => setAsking(true)}
          onDesign={() => {
            goToScreen("design");
            setDesignAt("styles");
          }}
          onHistory={() => {
            goToScreen("graph");
            setGraphOpen(true);
          }}
          onReviews={() => {
            goToScreen("reviews");
            setReviewsOpen(true);
          }}
          onSkills={() => {
            goToScreen("skills");
            refreshSkills();
            refreshWorkflows();
            setSkillsOpen(true);
          }}
          onAddMore={() => {
            goToScreen("add-more");
            openAddMore();
          }}
          onFiles={filesShown ? () => setFilesOpen(true) : undefined}
          onDeleteConversation={(path) => void deleteConversation(path)}
          onCopyConversation={(path) => void copyConversation(path)}
          ownCopy={ownCopyHere}
          onBringWorkBack={(path) => void bringWorkBack(path)}
          onThrowWorkAway={(path) => void throwWorkAway(path)}
          onSettings={() => {
            goToScreen("settings");
            setSettingsOpen(true);
            // Read when the sheet opens rather than kept in step: the file is
            // edited outside this window, so the only true reading is a fresh
            // one.
            const path = desks.current;
            void bridge
              .alwaysDoes(
                path === null
                  ? undefined
                  : {
                      project: path,
                      ...(panelRepoNow.current === null ? {} : { repo: panelRepoNow.current }),
                    },
              )
              .then((answer) => {
                if (answer.ok) setAlwaysNow(answer.value);
              });
          }}
        />
      ) : null}

      {/* Everything this window can do, by name. Built here because every action
          it offers already lives here; the list is the same one the keys use. */}
      {/* The change in the folder, hunk by hunk. Keeping a subset takes the
          rest back out, which is a real edit — so it snapshots first. */}
      {/* Which of the several goes to take. The one question the board cannot
          answer on its own, because the answer is in the files. */}
      <Against
        open={against !== null}
        sides={against?.sides ?? []}
        busy={busy}
        onOpenInBrowser={openWaysInBrowser}
        onClose={() => setAgainst(null)}
        onKeep={(id) => {
          // Open until the answer comes back: closing first hides the sheet
          // behind whatever the press turns out to say.
          keepAway(id, against?.where, (ok) => {
            if (ok) setAgainst(null);
          });
        }}
      />

      <Changes
        open={changesOpen}
        diff={changeText}
        busy={busy}
        onClose={() => setChangesOpen(false)}
        onKeep={(kept) => {
          const whole = changeText ?? '';
          const keeping = new Set(parseDiff(kept).flatMap((one) => one.hunks).map((one) => one.id));
          // What was NOT kept is what to undo. Built from the whole change so
          // the line numbers on the way out are the ones on the way in — and
          // left where they are, because this is applied in reverse against a
          // file that still holds every piece.
          const dropping = undoOf(parseDiff(whole), (hunk) => !keeping.has(hunk.id));
          setChangesOpen(false);
          if (dropping.trim() === '') return;
          void bridge.changesDrop(dropping).then((answer) => {
            if (!answer.ok) troubleHere(answer.trouble);
            else if (desks.current !== null) void refreshOverview(desks.current);
          });
        }}
      />

      <Palette
        open={paletteOpen}
        commands={everyCommand}
        onClose={() => setPaletteOpen(false)}
      />

      <Connected
        open={connectedOpen}
        state={connected}
        onClose={() => setConnectedOpen(false)}
        onCheck={async (name) => {
          const answer = await bridge.connectedCheck(name);
          return answer.ok ? answer.value : { state: 'would-not-start', because: answer.trouble.because };
        }}
        onSave={async (tools) => {
          const answer = await bridge.connectedSave(tools);
          if (answer.ok) setConnected(answer.value);
          else troubleHere(answer.trouble);
        }}
      />

      <Skills
        open={skillsOpen}
        skills={skills}
        workflows={workflows}
        onClose={() => setSkillsOpen(false)}
        onRefresh={refreshSkills}
        onOpen={async (skill) => {
          const answer = await bridge.skillText(skill.id);
          return answer.ok ? answer.value : null;
        }}
      />

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        showMe={preferences.showMe}
        showFiles={preferences.showFiles}
        holdBack={holdsBack(preferences.heldBack, desk?.path)}
        theme={theme}
        onTheme={changeTheme}
        onToggleShowMe={() => changeShowMe(!preferences.showMe)}
        onToggleShowFiles={() => changeShowFiles(!preferences.showFiles)}
        onToggleHoldBack={() => changeHoldBack(!holdsBack(preferences.heldBack, desk?.path))}
        always={alwaysNow}
        keepLogins={keepsLogins(preferences.keptLogins, desk?.path)}
        onToggleKeepLogins={() =>
          changeKeepLogins(!keepsLogins(preferences.keptLogins, desk?.path))
        }
        onGo={openSettingsLink}
      />

      <Usage
        open={usageOpen}
        spent={desk?.spent ?? null}
        onClose={() => setUsageOpen(false)}
        onTokens={() =>
          bridge.tokenUsage().then((answer) => (answer.ok ? answer.value : null))
        }
      />

      {filesExpanded && desk !== null ? (
        <aside className="filespanel">
          <div className="filespanel__head">
            <h2 className="filespanel__title">Everything in this project</h2>
            <button
              type="button"
              className="filespanel__collapse"
              onClick={() => setFilesOpen(false)}
              aria-label="Collapse the project files"
              title="Collapse project files"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6.5 4 10.5 8l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <Files
            files={files[desk.path] ?? []}
            selected={reading?.path ?? null}
            onSelect={readFile}
          />
        </aside>
      ) : null}

      <div className="app__column" ref={contentRef}>
        {/* The file sits where the reading happens rather than squeezed into
            the panel: a column of code is prose-width, not sidebar-width. */}
        {filesExpanded && reading !== null ? (
          <div className="app__file">
            <FileView
              path={reading.path}
              text={reading.text}
              trouble={reading.trouble}
              onClose={() => setReading(null)}
            />
          </div>
        ) : null}

        {picking ? (
          <ProjectPicker
            projects={recent ?? []}
            onOpen={(project) => void open(project.path)}
            onForget={(project) => void forget(project)}
            onBrowse={() => void browse()}
          />
        ) : desk === null || desk.turns.length === 0 ? (
          <Welcome
            onUse={setDraft}
            project={desk?.name ?? null}
            onPickDocument={async () => {
              const answer = await bridge.chooseDocument(desk === null ? undefined : { project: desk.path });
              return answer.ok ? answer.value : null;
            }}
            onStartBuild={(source) => {
              // The document is stored under the project, then the build brief
              // goes into the conversation so the agent reads it against the
              // code and plans the work in view, task by task.
              // The brief only goes in once there is a plan behind it. Sent
              // regardless, a start that failed left the agent building against
              // a tracker that never appeared, and nothing said why.
              void bridge
                .buildStart(source, desk === null ? undefined : { project: desk.path })
                .then((answer) => {
                  if (!answer.ok) {
                    troubleAt(desk === null ? {} : { project: desk.path }, answer.trouble);
                    return;
                  }
                  if (desk !== null) void refreshBuildPlan(desk.path);
                  void send(asBuildRequest(source.text, source.instruction));
                })
                .catch(() => {
                  if (desk !== null) void refreshBuildPlan(desk.path);
                });
            }}
          />
        ) : (
          <>
            {/* The top of the page. A sibling of the thread rather than its
                first row, so it stays on the window's first band while the
                conversation collects at the bottom by the composer. */}
            <header className="workhead">
              <h1 className="workhead__name">{desk.name}</h1>
            </header>

            <div className="thread">
            {(() => {
              // A step that took a picture stays on its own line: a picture
              // folded into a collapsed run is a picture nobody sees.
              const showing = new Set(pictures.under.keys());
              for (const turn of desk.turns) {
                if (turn.kind === 'did' && turn.shown !== undefined) showing.add(turn.id);
              }
              const all = rows(desk.turns, showing);
              const lastGrapheIdx = [...all].reverse().findIndex((r) => r.kind !== 'steps' && r.turn.kind === 'said' && r.turn.from === 'graphe');
              const lastIdx = lastGrapheIdx === -1 ? -1 : all.length - 1 - lastGrapheIdx;
              return all.map((row, idx) =>
              row.kind === "steps" ? (
                <Steps key={row.id} steps={row.steps} showMe={preferences.showMe} />
              ) : (
                <Fragment key={row.turn.id}>
                  <Turnstile
                    turn={row.turn}
                    onRespond={respond}
                    onAnswerAsked={answerAsked}
                    onDismiss={dismiss}
                    onAnswerEstimate={answerEstimate}
                    onAnswerPlan={answerPlan}
                    onFixReview={fixReview}
                    onPostReview={postReview}
                    showMe={preferences.showMe}
                    isLast={idx === lastIdx}
                  />
                  {(pictures.under.get(row.turn.id) ?? []).map((one) => (
                    <Picture key={one.change.id} change={one.change} />
                  ))}
                </Fragment>
              ),
            ); })()}
              {frontBusy && !runningNow ? <WorkingMark /> : null}
              {pictures.last.map((one) => (
                <Picture key={one.change.id} change={one.change} />
              ))}
              {/* The run sits at the end of the conversation, next to the box,
                  because it is the newest thing anybody has to say about the
                  page and the next message is usually about it. */}
              {recorded !== null && recorded.project === desk.path ? (
                <EvidenceReel recording={recorded.recording} />
              ) : null}
              {finishedRun !== null && desk !== null &&
              finishedRun.owner === `${desk.path}\u0000${desk.address ?? ''}` ? (
                <p className="threadnote">
                  Worked for {durationInWords(finishedRun.seconds)}
                </p>
              ) : null}
            </div>
          </>
        )}

        {pickerTrouble === null ? null : (
          <ErrorCard
            what={pickerTrouble.trouble.what}
            because={pickerTrouble.trouble.because}
            actionLabel={pickerTrouble.trouble.actionLabel}
            onAction={() => {
              const gone = pickerTrouble.path;
              setPickerTrouble(null);
              if (gone !== "") void forget({ path: gone });
            }}
            technicalDetails={pickerTrouble.trouble.details}
          />
        )}

        {picking ? null : (
          <div className="app__composer">
            {/* Only once somebody has scrolled away from the end, and quiet even
                then: it is an offer, not an alert. It stays in the document while
                it is hidden so the transition works in both directions, and goes
                inert so the keyboard cannot land on something invisible. */}
            <button
              type="button"
              className={`jump ${empty || isAtBottom ? "" : "jump--shown"}`}
              onClick={jumpToLatest}
              inert={empty || isAtBottom}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 3v10M8 13l-4.5-4.5M8 13l4.5-4.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Jump to latest
            </button>

            {/* A document-to-build keeps its progress above the box, one quiet
                line collapsed, the checklist behind it. It is the same fold the
                steps have, and nothing about the build is lost if the window
                closes — the plan is written down and reopened. */}
            {buildPlan !== null && buildPlan.path === desk?.path && buildPlan.plan.total > 0 ? (
              <BuildProgress plan={buildPlan.plan} running={frontBusy} project={buildPlan.path} />
            ) : null}

            {/* Both bands sit above the composer rather than in the panel on
                the right: that panel is a reading of what has happened, and
                these two are what is happening. */}
            <HelperRail
              helpers={angles}
              onOpen={(at) => {
                goToScreen("helpers");
                setHelpersAt({ at });
              }}
            />
            <InLine waiting={waitingHere} onTake={takeBack} />

            {/* Servers and watchers outlive the sentence that started them, so
                they sit above the composer rather than inside the conversation. */}
            <Running
              pieces={running}
              onOpen={(address) => {
                setPageAt(address);
                movePane('split');
              }}
              onStop={(id) => {
                const here = currentDesk(desksNow.current);
                void bridge.stopRunning(id, {
                  ...(here === null ? {} : { project: here.path }),
                  ...(here?.address == null ? {} : { conversation: here.address }),
                }).then((answer) => {
                  if (answer.ok) setRunning(answer.value);
                });
              }}
            />

            <Composer
              onSend={hand}
              onQueue={hand}
              onStop={halt}
              autoFocus
              // Busy is this conversation's own live stream, not a background
              // turn in another tab — a tab working beside you must not turn
              // your Send into Stop or its own work into a wait.
              busy={frontBusy}
              waiting={desk !== null && holding[`${desk.path}\u0000${desk.address ?? ''}`] === true}
              onWait={waitForMe}
              draft={draft}
              attachments={attachments}
              connection={connection}
              room={room}
              turns={desk?.turns ?? []}
              tidying={tidying}
              onTidy={tidyNow}
              howFar={howFar}
              onHowFar={setHowFar}
              onComposerPopoverOpenChange={setComposerPopoverOpen}
              plans={plans}
              onPlans={setPlans}
              onSelectModel={selectModel}
              onConnect={openConnect}
              onThinking={changeThinking}
              skills={skills}
              workflows={workflows}
              onAttachmentsChange={(next) => {
                if (desks.current === null) setLoose(next);
                else {
                  setDesks((current) =>
                    changeCurrent(current, (one) => ({
                      ...one,
                      attachments: next,
                    })),
                  );
                }
              }}
            />
          </div>
        )}
      </div>

      {overviewed && desk !== null ? (
        <Overview
          key={`${desk.path}\u0000${desk.address ?? ''}`}
          view={{
            now: nowThere,
            git: desk.overview?.git ?? null,
            repos: desk.overview?.repos ?? [],
            repoVersions: desk.repoVersions,
            research,
            references: desk.references,
            versions: desk.versions,
            pictures: versionPictures[desk.path] ?? {},
            kept: preferences.kept[desk.path] ?? [],
            putBack: desk.putBack,
            spent: desk.spent,
            onAPlan,
            ceiling,
            busy,
            showMe: preferences.showMe,
            artifacts: desk.overview?.artifacts ?? [],
            swatches: desk.overview?.swatches ?? [],
            styles: designStyles,
            reading: design,
            inStep,
            landing,
            gate,
            howMuch: howMuchBy(preferences.howMuch).id,
            going,
            landed,
            decided,
            away: awayHere,
            elsewhere: awayElsewhere,
            project: desks.current === null ? "" : folderCalled(desks.current),
            clock: now,
          }}
          onPutBack={(versionId, repo) => void putBack(versionId, repo)}
          onName={(versionId, name, repo) => void nameVersion(versionId, name, repo)}
          onKeep={keepVersion}
          onDismissPutBack={dismissPutBack}
          onShowSplit={() => void showSplit()}
          onLimit={setLimit}
          onOpenDesign={(part) => {
            goToScreen("design");
            setDesignAt(part);
          }}
          onOpenGraph={(repo) => {
            goToScreen("graph");
            setGraphRepo(repo ?? null);
            setGraphOpen(true);
          }}
          onSwitchBranch={switchBranch}
          onCreateBranch={createBranch}
          onSeeProject={(repo) => void seeIt(undefined, undefined, repo)}
          onShare={(repo) => void bridge.shareReview(repo === undefined ? undefined : { repo })}
          onDecide={decideOnWork}
          onHowMuch={changeHowMuch}
          onHandOver={handToDeveloper}
          onOpenLink={(address) => void bridge.openLink(address)}
          onWhose={(name) => {
            panelRepoNow.current = name;
            setPanelRepo((was) => (was === name ? was : name));
            refreshLanding(desks.current);
          }}
          onOpenFile={(file) => void bridge.openInEditor(file)}
          onKeepGoing={keepGoing}
          onStartAfter={startAfter}
          onKeepAway={keepAway}
          onDropAway={dropAway}
          onAnswerAway={answerAway}
          onSayToAway={sayToAway}
          onCompareWays={compareWays}
          onStopWaiting={stopWaiting}
          onTakeAll={takeAll}
          onAddRepeat={addRepeat}
          onSwitchRepeat={switchRepeat}
          onForgetRepeat={forgetRepeat}
          onSave={(repo?: string) => {
            const here = currentDesk(desksNow.current);
            if (here === null) return;
            const path = here.path;
            void bridge
              .saveVersion(undefined, { project: path, ...(repo === undefined ? {} : { repo }) })
              .then((answer) => {
                if (!answer.ok) {
                  troubleHere(answer.trouble);
                  return;
                }
                setDesks((current) =>
                  changeDesk(current, path, (one) => ({
                    ...one,
                    ...(repo === undefined
                      ? { versions: answer.value }
                      : { repoVersions: { ...one.repoVersions, [repo]: answer.value } }),
                  })),
                );
              });
          }}
        />
      ) : null}

      {/* Everything about how the project looks, and everywhere it has been.
          Both take the room between the shelf and the panel, because both were
          unreadable in a 328px column. */}
      {designAt !== null && desk !== null ? (
        <DesignView
          at={designAt}
          data={{
            styles: designStyles,
            motion: design.motion,
            drifted: design.drifted,
            unreadable: design.unreadable,
            fixing,
            looks: looks.looks,
            looksSay: looks.says,
            checkingWidths,
            workingAt,
            inStep,
            lookingAtFigma,
            busy,
            showMe: preferences.showMe,
          }}
          dirty={designDirty()}
          onSave={commitDesign}
          onDiscard={discardDesign}
          onClose={() => setDesignAt(null)}
          onNudge={nudge}
          onNudgeMotion={nudgeMotion}
          onUseYours={(finding) => {
            // Through the agent rather than straight to disk: the edit is then
            // snapshotted, photographed and undoable like any other change.
            const text = saysUseYours(finding, designStyles?.file ?? "");
            setDesignAt(null);
            void deliver(text, sizeUp(text), { lookFirst: true });
          }}
          onFixColour={(finding) => {
            const token = design.repairs.get(finding.id);
            if (token === undefined || finding.fix === null) return;
            setFixing(finding.id);
            nudge(token, finding.fix.colour);
          }}
          onCheckWidths={() => {
            setCheckingWidths(true);
            void bridge
              .checkWidths(
                panelRepoNow.current === null ? undefined : { repo: panelRepoNow.current },
              )
              .then((answer) => {
                if (answer.ok) setLooks(answer.value);
              })
              .finally(() => setCheckingWidths(false));
          }}
          onWorkAt={(look) => setWorkingAt((was) => (was === look.id ? null : look.id))}
          onFollowDesign={(address) => askFigma(() => bridge.followDesign(address))}
          onLookAgain={() => askFigma(() => bridge.lookAgain())}
          onCaughtUp={() => askFigma(() => bridge.caughtUp())}
          onStopFollowing={() => askFigma(() => bridge.stopFollowing())}
          /* The one thing here that is a request rather than a reading: what
             moved goes to the conversation as the sentence that would bring the
             work back in step. */
          onBuildIn={(move: Move) => {
            setDesignAt(null);
            void send(move.asks);
          }}
        />
      ) : null}

      {graphOpen && desk !== null ? (
        <HistoryView
          versions={historyRepo === null ? desk.versions : (desk.repoVersions[historyRepo] ?? [])}
          pictures={versionPictures[desk.path] ?? {}}
          git={
            historyRepo === null
              ? (desk.overview?.git ?? null)
              : (desk.overview?.repos?.find((one) => one.name === historyRepo)?.git ?? null)
          }
          busy={busy}
          onClose={() => setGraphOpen(false)}
          onPutBack={(versionId) => void putBack(versionId, historyRepo ?? undefined)}
          onOpenFile={(file) => void bridge.openInEditor(file)}
          repos={desk.overview?.repos ?? []}
          repo={historyRepo}
          onRepo={(name) => setGraphRepo(name)}
        />
      ) : null}

      {reviewsOpen && desk !== null ? (
        <ReviewsView
          repo={repo}
          busy={reviewsBusy}
          onRefresh={refreshRepo}
          onClose={() => setReviewsOpen(false)}
          onReview={startReview}
          repos={desk.overview?.repos ?? []}
          which={
            (desk.overview?.repos ?? []).find((one) => one.name === reviewsRepo)?.name ??
            (desk.overview?.repos ?? [])[0]?.name ??
            null
          }
          onWhich={(name) => {
            setReviewsRepo(name);
            reviewsRepoNow.current = name;
            refreshRepo();
          }}
        />
      ) : null}

      <BrowserPane
        room={pane}
        address={pageAt ?? previewUrl}
        onAddress={(address) => {
          setPageAt(address);
          void bridge.pageAt(address, null, true);
        }}
        onElsewhere={(address) => void bridge.openLink(address)}
        onRoom={movePane}
        onClose={() => movePane('off')}
        variations={
          variations === null
            ? undefined
            : variations.members.map((one) => ({ id: one.id, name: one.name }))
        }
        recording={recording}
        onRecord={record}
        watched={watched}
        watching={watchAt !== null}
        onWatch={watchTheBrowser}
        variation={variations?.inFront ?? null}
        onVariation={variations === null ? undefined : (id) => {
          const chosen = variations.members.find((one) => one.id === id);
          if (chosen === undefined) return;
          setVariations((current) => (current === null ? current : { ...current, inFront: id }));
          setPageAt(chosen.address);
          movePane('split');
        }}
        onBounds={movedPage}
      />

      {/* Mode three keeps a way back that is one key and always the same key. */}
      {pane === 'whole' ? (
        <button type="button" className="chatpill" onClick={() => movePane('split')}>
          <span className="chatpill__last">{lastSaidIn(desk) ?? 'Back to the conversation'}</span>
          <kbd className="chatpill__key">⌘J</kbd>
        </button>
      ) : null}

      {helpersAt !== null ? (
        <HelpersView helpers={helpers} at={helpersAt.at} onClose={() => setHelpersAt(null)} />
      ) : null}

      {!overviewed && desk !== null && desk.spent !== null ? (
        <CostMeter
          spent={desk.spent.total}
          corner
          onAPlan={onAPlan}
          {...(ceiling === null ? {} : { limit: ceiling })}
          onDetails={() => void showSplit()}
          onLimit={setLimit}
        />
      ) : null}

      <AddMore
        open={addMore}
        packs={packs}
        vouchedFor={Object.fromEntries(
          packs.filter((one) => one.curated).map((one) => [one.id, one.summary]),
        )}
        busy={packBusy}
        warning={SOMEBODY_ELSES}
        explaining={explaining}
        explanations={explanations}
        onClose={() => setAddMore(false)}
        /* The vouched-for tools — a real browser among them — with whichever
           this project already has marked as connected. Without these the
           whole shelf never drew, so the one-press way to give the agent a
           browser was invisible. */
        reaches={alreadyReached((connected?.tools ?? []).map((one) => one.name))}
        onConnect={(id) => {
          const wanted = REACHABLE.find((one) => one.id === id);
          if (wanted === undefined) return;
          setPackBusy(id);
          const now = connected?.tools ?? [];
          void bridge
            .connectedSave([...now.filter((one) => one.name !== id), asServer(wanted)])
            .then((answer) => {
              if (answer.ok) setConnected(answer.value);
              else troubleHere(answer.trouble);
            })
            .finally(() => setPackBusy(null));
        }}
        onDisconnect={(id) => {
          setPackBusy(id);
          const now = connected?.tools ?? [];
          void bridge
            .connectedSave(now.filter((one) => one.name !== id))
            .then((answer) => {
              if (answer.ok) setConnected(answer.value);
              else troubleHere(answer.trouble);
            })
            .finally(() => setPackBusy(null));
        }}
        onSearch={(term) => {
          void bridge.packages(term).then((answer) => {
            if (answer.ok) setPacks(answer.value);
          });
        }}
        onAdd={(id) => {
          setPackBusy(id);
          void bridge
            .addPackage(id)
            .then((answer) => {
              if (answer.ok) setPacks(answer.value);
              else troubleHere(answer.trouble);
            })
            .finally(() => setPackBusy(null));
        }}
        onRemove={(id) => {
          setPackBusy(id);
          void bridge
            .removePackage(id)
            .then((answer) => {
              if (answer.ok) setPacks(answer.value);
            })
            .finally(() => setPackBusy(null));
        }}
        carried={carried}
        onTrustCarried={trustCarried}
        onExplain={(id) => {
          setExplaining(id);
          void bridge
            .explainPackage(id)
            .then((answer) => {
              if (answer.ok) setExplanations((was) => ({ ...was, [id]: answer.value }));
            })
            .finally(() => setExplaining(null));
        }}
      />

      <ConnectModal
        open={connectOpen}
        state={connection}
        step={connectStep}
        busy={connectBusy}
        failure={connectFailure}
        discovered={discovered}
        importing={importing}
        onClose={closeConnect}
        onConnect={(providerId, method) => startConnect(providerId, method)}
        onAnswer={answerConnect}
        onCancel={cancelConnect}
        onImport={importAccount}
        onSelect={selectModel}
        onDisconnect={disconnect}
        onRefresh={() => refreshConnection(true)}
      />
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* One before-and-after, drawn                                                 */
/* -------------------------------------------------------------------------- */

/** The strip in the conversation. The full-size pair is asked for the moment
 *  somebody opens it and never before — see `VisualChange` in src/lib/ipc.ts. */
function Picture({ change }: { change: VisualChange }) {
  return (
    <VisualDiff
      headline={change.headline}
      inDesignWords={change.inDesignWords}
      where={change.where}
      areas={change.areas}
      beforeThumb={change.beforeThumb}
      afterThumb={change.afterThumb}
      width={change.width}
      height={change.height}
      onOpen={async () => {
        const answer = await bridge.visualFrames(change.id);
        // A pair we no longer have is not worth a card. The small pictures are
        // already on screen and stay there, which is a slightly soft comparison
        // rather than none at all.
        return answer.ok ? answer.value : null;
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* One turn, drawn                                                             */
/* -------------------------------------------------------------------------- */

function Turnstile({
  turn,
  onRespond,
  onAnswerAsked,
  onDismiss,
  onAnswerEstimate,
  onAnswerPlan,
  onFixReview,
  onPostReview,
  showMe,
  isLast,
}: {
  turn: Turn;
  onRespond: (turnId: string, callId: string, decision: Decision) => void;
  onAnswerAsked: (turnId: string, answers: Answers | null) => void;
  onDismiss: (turnId: string) => void;
  onAnswerEstimate: (turn: EstimateTurn, go: boolean) => void;
  onAnswerPlan: (
    turnId: string,
    go: boolean,
    chosen?: {
      kept: readonly string[];
      dropped: readonly string[];
      decision?: PlanDecision;
    },
  ) => void;
  onFixReview: (turnId: string) => void;
  onPostReview: (verdict: ReviewVerdict) => Promise<boolean>;
  /** Name the real command, path or operation under each step (BACKLOG D1).
   *  The words themselves were recorded when the step happened, so turning this
   *  on explains the conversation you already had. */
  showMe: boolean;
  isLast?: boolean;
}) {
  switch (turn.kind) {
    case "said":
      return (
        <Message from={turn.from} streaming={turn.streaming} isLast={isLast}>
          {turn.text}
        </Message>
      );

    case "did":
      return (
        <>
          <ActivityLine
            state={turn.state}
            label={turn.label}
            detail={
              turn.progress === undefined ? turn.detail : lastSaid(turn.progress)
            }
            real={showMe ? turn.real : undefined}
          />
          {turn.shown === undefined ? null : (
            <Shown picture={turn.shown} label={turn.label} />
          )}
        </>
      );

    case "asked":
      // Once it is answered the question stops being a control and becomes part
      // of the record — a live pair of buttons for a decision already taken is
      // how people learn to click without reading.
      return turn.answered === null ? (
        <ConfirmChange
          question={turn.question}
          detail={turn.detail}
          consequence={turn.consequence}
          technical={showMe ? turn.real : undefined}
          confirmLabel="Yes, go ahead"
          cancelLabel="No, leave it"
          onConfirm={() => onRespond(turn.id, turn.callId, "yes")}
          onCancel={() => onRespond(turn.id, turn.callId, "no")}
        />
      ) : (
        <ActivityLine
          state={turn.answered === "yes" ? "done" : "failed"}
          label={turn.question}
          detail={
            turn.answered === "yes"
              ? "You said yes."
              : "You said no, so I left it alone."
          }
          real={showMe ? turn.real : undefined}
        />
      );

    // Asked before a single file is touched, so that everything after it can
    // happen with nobody watching. The card holds the picking; the turn only
    // hears the answer.
    case "asked-first":
      return (
        <AskFirst
          questions={turn.questions}
          answers={turn.answers}
          answered={turn.answered}
          onAnswer={(answers) => onAnswerAsked(turn.id, answers)}
        />
      );

    case "plan":
      return (
        <PlanCard
          steps={turn.steps}
          caveats={turn.caveats}
          answered={turn.answered}
          questions={turn.questions}
          onGo={(kept, dropped, decision) =>
            onAnswerPlan(turn.id, true, { kept, dropped, decision })
          }
          onChange={() => onAnswerPlan(turn.id, false)}
        />
      );

    case "review":
      return (
        <ReviewCard
          verdict={turn.verdict}
          asked={turn.asked}
          onFix={() => onFixReview(turn.id)}
          onPost={() => onPostReview(turn.verdict)}
        />
      );

    case "estimate":
      // Same shape as any other question, and the same grammar: the option that
      // spends less carries the visual weight. Every word of it is written by
      // src/cost/phrasing.ts and none of it by this file.
      return turn.answered === null ? (
        <ConfirmChange
          question={turn.prompt.title}
          detail={turn.prompt.body}
          consequence={turn.prompt.note}
          confirmLabel={turn.prompt.confirm}
          cancelLabel={turn.prompt.alternative}
          onConfirm={() => onAnswerEstimate(turn, true)}
          onCancel={() => onAnswerEstimate(turn, false)}
        />
      ) : (
        // Answered, it stops being a control and becomes part of the record —
        // the same shape the Guard's own questions take once they have been
        // answered, for the same reason: a live pair of buttons for a decision
        // already taken is how people learn to click without reading.
        <ActivityLine
          state="done"
          label={turn.prompt.title}
          detail={
            turn.answered === "went-ahead"
              ? "You said go ahead."
              : "You said you would rather start smaller."
          }
        />
      );

    case "tidying":
      // Behind this is Pi's own tidying of a long conversation. In front of it
      // is one plain sentence, from src/cost/phrasing.ts — and, for anyone who
      // asked, its real name underneath.
      return (
        <ActivityLine
          state={turn.state}
          label={turn.state === 'failed' ? longConversation.stayedAsIs : longConversation.tidying}
          real={showMe ? behind.tidying : undefined}
        />
      );

    case "holding":
      // A service that could not answer, and the wait before asking again.
      // Nothing to look at for up to half an hour, so the line says how long.
      return (
        <ActivityLine
          state={turn.state}
          label={
            turn.state === 'failed'
              ? busyService.gaveUp
              : turn.state === 'done'
                ? busyService.carriedOn
                : busyService.waiting(turn.seconds)
          }
        />
      );

    case "trouble":
      return (
        <ErrorCard
          what={turn.trouble.what}
          because={turn.trouble.because}
          actionLabel={turn.trouble.actionLabel}
          onAction={() => onDismiss(turn.id)}
          technicalDetails={turn.trouble.details}
        />
      );
  }
}
