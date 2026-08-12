import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";
import ActivityLine from "./components/ActivityLine";
import type { Attachment } from "./components/Attachments";
import Composer from "./components/Composer";
import ConfirmChange from "./components/ConfirmChange";
import ConnectModal from "./components/ConnectModal";
import CostMeter from "./components/CostMeter";
import ErrorCard from "./components/ErrorCard";
import Files from "./components/Files";
import FileView from "./components/FileView";
import Message from "./components/Message";
import type { Outcome } from "./components/Landing";
import Overview from "./components/Overview";
import PlanCard from "./components/PlanCard";
import AddMore from "./components/AddMore";
import ProjectMenu from "./components/ProjectMenu";
import ProjectPicker from "./components/ProjectPicker";
import Sidebar from "./components/Sidebar";
import ThinkingWith from "./components/ThinkingWith";
import VisualDiff from "./components/VisualDiff";
import Welcome from "./components/Welcome";
import Gallery from "./gallery/Gallery";
import AskAnything from "./components/AskAnything";
import type { Found, Things } from "./lib/anything";
import type { ShelfPage } from "./lib/shelf";
import type { Task } from "./cost/estimate";
import {
  longConversation,
  retryHonesty,
  sessionSummary,
} from "./cost/phrasing";
import { sizeUp } from "./cost/sizing";
import { worthPlanning } from "./agent/plan";
import { bridge } from "./lib/bridge";
import { quote, smallerFirst } from "./lib/estimating";
import {
  showWords,
  swapWords,
  type ConnectStep,
  type ConnectionState,
  type Decision,
  type FileEntry,
  type FoundAccount,
  type ModelChoice,
  type Conversation,
  type Landing as LandingState,
  type Look,
  type Pack,
  type Page,
  type Preferences,
  type PromptAttachment,
  type ProviderMethod,
  type RecentProject,
  type ShowProgress,
  type Trouble,
  type VisualChange,
} from "./lib/ipc";
import { usePrefersReducedMotion } from "./lib/motion";
import { keeping } from "./projects/kept";
import { behind } from "./lib/showme";
import {
  changeCurrent,
  changeDesk,
  closeDesk,
  currentDesk,
  noDesks,
  nowDoing,
  openDesk,
  receive,
  researchLog,
  type Desk,
  type Desks,
  type Reference,
} from "./lib/projects";
import {
  applyEvent,
  estimated,
  said,
  withTrouble,
  STOPPED_PART_WAY,
  type EstimateTurn,
  type Turn,
} from "./lib/thread";
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

/** The one line under the project's name: where the work stands, and what has
 *  moved since. Both are already known — this only says them in one place. */
function workingNote(desk: Desk): string {
  const current = desk.versions.find((one) => one.current) ?? null;
  const changed =
    desk.overview?.git === null || desk.overview === null
      ? 0
      : desk.overview.git.unstaged + desk.overview.git.staged + desk.overview.git.untracked;
  const since =
    changed === 0 ? null : `${changed} ${changed === 1 ? 'file' : 'files'} changed since`;
  if (current === null) return since ?? 'Nothing saved yet.';
  return since === null ? `On screen: ${current.title}` : `${current.title} · ${since}`;
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

  /** What this computer remembers. Null until the shell has been asked — which
   *  is not the same as an empty list, and the two states look different: one is
   *  a first launch, the other is a launch we have not finished yet. */
  const [recent, setRecent] = useState<readonly RecentProject[] | null>(null);
  /** True while the picker is hanging under the project's name as a switcher. */
  const [switching, setSwitching] = useState(false);
  /** The screens of the project in front, for the rail. Asked for once when a
   *  folder opens — pages are a fact about the project, not about the sitting. */
  const [pages, setPages] = useState<readonly Page[]>([]);
  /** Which page the preview is currently showing, so the shelf can mark it. */
  const [showingPage, setShowingPage] = useState<string | null>(null);
  /** The one bar that reaches everything. Openable by hand as well as by key —
   *  a shortcut nobody is told about is a feature nobody has. */
  const [asking, setAsking] = useState(false);
  /** The conversations this project has had, and which one is on screen. */
  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [inConversation, setInConversation] = useState<string | null>(null);
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
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Readonly<Record<string, string>>>({});
  /** Whether a message gets a looking-around pass before anything is touched.
   *  `auto` decides from the sentence, which is what almost everybody wants;
   *  the other two are for somebody who has an opinion about this one. */
  const [plans, setPlans] = useState<'auto' | 'always' | 'never'>('auto');
  /** What was asked for while a plan is being made, so approving it can send
   *  the same sentence rather than a reconstruction of it. */
  const asked = useRef<string>("");
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
    kept: {},
    showFiles: false,
    holdBack: false,
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
  const refreshConnection = useCallback(() => {
    void bridge.connection().then((answer) => {
      if (answer.ok) setConnection(answer.value);
    });
  }, []);

  useEffect(() => {
    refreshConnection();
  }, [refreshConnection]);

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

  const selectModel = useCallback(
    (choice: ModelChoice) => {
      void bridge.selectModel(choice).then((answer) => {
        if (!answer.ok) return;
        setPreferences(answer.value);
        setConnection((current) =>
          current === null ? current : { ...current, chosen: answer.value.model },
        );
        resumeWaiting();
      });
    },
    [resumeWaiting],
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

  /** Whether the shelf is open. Deliberately not remembered across launches —
   *  it is a thing people flip all the time and it costs nothing to reset. */
  const [shelfOpen, setShelfOpen] = useState(true);

  const [busy, setBusy] = useState(false);
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

  /** An example from the welcome screen, put in the box ready to be edited.
   *  Never sent on anybody's behalf — a click that spends money on a sentence
   *  the user did not write is exactly the surprise this product exists to
   *  avoid. */
  const [draft, setDraft] = useState("");

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

  /* Somebody clicked something in their own browser. It arrives as the sentence
     the composer would have made them type. */
  useEffect(() => {
    return bridge.onPointed((said) => {
      setDraft((was) => (was.trim() === '' ? `${said} — ` : `${was} ${said}`));
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
    if (!answer.ok) return;
    setDesks((current) =>
      current.current === path
        ? changeDesk(current, path, (one) => ({
            ...one,
            versions: answer.value,
          }))
        : current,
    );
  }, []);

  /** Ask for the git state of the project in front, for the overview. Applied
   *  only if it is still the one in front by the time the answer comes back —
   *  the same guard `refreshVersions` stands on, for the same reason. */
  const refreshOverview = useCallback(async (path: string) => {
    const answer = await bridge.overview();
    if (!answer.ok) return;
    setDesks((current) =>
      current.current === path
        ? changeDesk(current, path, (one) => ({
            ...one,
            overview: answer.value,
          }))
        : current,
    );
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
      const opened = await bridge.openProject(path);
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
      // A file of the folder we were in is not a file of this one.
      setReading(null);
      // Which conversation this landed in. Without it nothing in the shelf is
      // marked, and pressing the row you are already in looks like a dead button.
      setInConversation(opened.value.conversation);
      setDesks((current) => {
        const next = openDesk(current, opened.value);
        const desk = next.byPath[opened.value.path];
        // Only the first time. A folder reopened in this sitting comes back
        // exactly as it was left; one with a conversation saved on disk gets
        // that conversation back, folded through the same reducer the live
        // stream runs. A folder where nothing was ever said stays empty, and
        // the first screen is the one that asks what you want to make.
        if (desk === undefined || desk.turns.length > 0) return next;
        const revived = opened.value.history.reduce(
          (turns, event) => applyEvent(turns, event),
          desk.turns,
        );
        if (revived.length === 0) return next;
        return changeDesk(next, opened.value.path, (one) => ({ ...one, turns: revived }));
      });

      void refreshVersions(opened.value.path);
      void refreshOverview(opened.value.path);
      void bridge.pages().then((answer) => {
        if (answer.ok) setPages(answer.value);
      });
      void bridge.conversations().then((answer) => {
        if (answer.ok) setConversations(answer.value);
      });
      void bridge.recentProjects().then((answer) => {
        if (answer.ok) setRecent(answer.value);
      });
    },
    [desks.current, refreshVersions, refreshOverview, troubleHere],
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
      // checking where they are, not asking for anything.
      if (path !== null && path === inConversation) return;
      // Mid-answer. Swapping disposes the session underneath, so the turn on its
      // way would be lost — said out loud rather than ignored.
      if (busy) {
        troubleHere(swapWords.busy);
        return;
      }
      const opened = await bridge.openConversation(path);
      if (!opened.ok) {
        troubleHere(opened.trouble);
        return;
      }
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
      setDesks((current) => changeDesk(current, opened.value.path, (one) => ({ ...one, turns })));
      void bridge.conversations().then((answer) => {
        if (answer.ok) setConversations(answer.value);
      });
    },
    [busy, inConversation, troubleHere],
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
    if (answer.ok) setRecent(answer.value);
  }, []);

  /* ------------------------------------------------------------ first paint */

  useEffect(() => {
    let stillHere = true;
    void bridge.preferences().then((answer) => {
      if (stillHere && answer.ok) setPreferences(answer.value);
    });
    void bridge.hatches().then((answer) => {
      if (stillHere && answer.ok) setEditor(answer.value.editor);
    });
    void bridge.recentProjects().then((answer) => {
      if (!stillHere) return;
      setRecent(answer.ok ? answer.value : []);
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
        setDesks((current) => receive(current, notice));
        // A sitting that has settled is a sitting that has been saved, so the
        // timeline and the overview have something new in them.
        if (notice.event.type === "settled" && notice.project !== null) {
          void refreshVersions(notice.project);
          void refreshOverview(notice.project);
          void refreshFiles(notice.project);
        }
      }),
    [refreshVersions, refreshOverview, refreshFiles],
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

  const halt = useCallback(() => {
    void bridge.stop();
  }, []);

  /* ------------------------------------------------- the way out, and the words */

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

  /* Esc cancels the current run, and closes the switcher — the keyboard rules in
     UI-DESIGN.md. ⌘O opens a folder; ⌘B folds the shelf; ⌘1–9 goes straight to
     one we remember. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (connectOpen) {
          if (connectBusy) cancelConnect();
          else closeConnect();
        } else if (switching) setSwitching(false);
        else if (busy) halt();
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === "o") {
        event.preventDefault();
        void browse();
        return;
      }
      if (event.key === "b" && desk !== null) {
        event.preventDefault();
        setShelfOpen((was) => !was);
        return;
      }
      const nth = Number.parseInt(event.key, 10);
      if (Number.isFinite(nth) && nth >= 1 && nth <= 9) {
        const wanted = (recent ?? []).filter((one) => !one.missing)[nth - 1];
        if (wanted === undefined) return;
        event.preventDefault();
        void open(wanted.path);
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
    recent,
    desk,
    connectOpen,
    connectBusy,
    cancelConnect,
    closeConnect,
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
    async (text: string, task: Task, ways?: { lookFirst?: boolean }) => {
      // What is in the box at the moment of sending — never a snapshot from
      // whenever this callback was last rebuilt (see `attachmentsNow`).
      const inTheBox = attachmentsNow.current;

      // The pictures go along for the ride: read into the base64 the shell
      // expects, and — the same moment — recorded in the overview as the
      // references this message worked from. The recording happens whether or
      // not the shell could read the bytes, so a reference that did not reach
      // the agent is still a reference somebody meant it to have.
      const reference: Reference[] = [];
      const pictures: PromptAttachment[] = [];
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
        if (attached.kind === "image" && attached.file !== undefined) {
          const bytes = await pictureBytes(attached.file);
          if (bytes !== null) {
            pictures.push({
              kind: "image",
              name: attached.name,
              mimeType: attached.file.type,
              bytes,
            });
          }
        }
      }

      setDesks((current) =>
        changeCurrent(current, (one) => ({
          ...one,
          doing: { task, startedAt: Date.now() },
          references: [...one.references, ...reference],
        })),
      );
      setBusy(true);
      try {
        const reply = await bridge.prompt(text, pictures, ways);
        if (!reply.ok) troubleHere(reply.trouble);
      } catch (cause) {
        // The bridge is not supposed to throw. If it ever does, the window says
        // something calm rather than turning white.
        troubleHere({
          what: STOPPED_PART_WAY,
          because: "Something went wrong on my side. Nothing has been changed.",
          actionLabel: "Got it",
          details:
            cause instanceof Error ? (cause.stack ?? cause.message) : undefined,
        });
      } finally {
        setBusy(false);
      }
    },
    [troubleHere],
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
        setBusy(true);
        const picked = await bridge
          .chooseFolder()
          .finally(() => setBusy(false));
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
      const asking = priced.prompt;
      if (asking !== null) {
        setDesks((current) =>
          changeCurrent(current, (one) => ({
            ...one,
            turns: [...one.turns, estimated(text, asking)],
          })),
        );
        return;
      }

      // A big-sounding request looks around before it touches anything, unless
      // somebody has said otherwise for this message. It is not a mode people
      // switch on: the failure designers fear most is forty files changed
      // without warning, and that is worth a round trip by default.
      const lookFirst = plans === 'always' || (plans === 'auto' && worthPlanning(text));
      if (lookFirst) asked.current = text;
      await deliver(text, priced.task, { lookFirst });
    },
    [deliver, desks, open, plans],
  );

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
    (turnId: string, go: boolean) => {
      const text = asked.current;
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
      if (go) void deliver(text, sizeUp(text), { lookFirst: false });
      else setDraft(text);
    },
    [deliver],
  );

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
      void bridge.answer(callId, decision);
    },
    [],
  );

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
    async (versionId: string) => {
      const path = desks.current;
      if (path === null) return;
      setBusy(true);
      try {
        const answer = await bridge.putBack(versionId);
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setDesks((current) =>
          changeDesk(current, path, (one) => ({
            ...one,
            versions: answer.value.versions,
            putBack: answer.value,
          })),
        );
      } finally {
        setBusy(false);
      }
    },
    [desks.current, troubleHere],
  );

  const nameVersion = useCallback(
    async (versionId: string, name: string) => {
      const path = desks.current;
      if (path === null) return;
      const answer = await bridge.nameVersion(versionId, name);
      if (!answer.ok) {
        troubleHere(answer.trouble);
        return;
      }
      setDesks((current) =>
        changeDesk(current, path, (one) => ({
          ...one,
          versions: answer.value,
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

  const refreshLanding = useCallback(() => {
    void bridge.landing().then((answer) => {
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
    refreshLanding();
  }, [desks.current, refreshLanding]);

  const changeHoldBack = useCallback(
    (on: boolean) => {
      setPreferences((was) => ({ ...was, holdBack: on }));
      setLanding((was) => (was === null ? was : { ...was, holdBack: on }));
      void bridge.setHoldBack(on).then((answer) => {
        if (answer.ok) setPreferences(answer.value);
        refreshLanding();
      });
    },
    [refreshLanding],
  );

  const decideOnWork = useCallback(
    (letIn: boolean) => {
      const path = desks.current;
      if (path === null) return;
      setBusy(true);
      void bridge
        .decideOnWork(letIn)
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
        .finally(() => setBusy(false));
    },
    [desks.current, refreshOverview, troubleHere],
  );

  /** The two that can send something off this computer. Both are only ever
   *  called from the band's own confirmation, which has already said what is
   *  about to happen — this is the press, not the offer. */
  const handToDeveloper = useCallback(() => {
    setGoing("developer");
    setLanded(null);
    void bridge
      .handToDeveloper(true)
      .then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setLanded({ kind: "handed", handed: answer.value });
      })
      .finally(() => {
        setGoing(null);
        refreshLanding();
      });
  }, [refreshLanding, troubleHere]);

  const putItOnline = useCallback(() => {
    setGoing("online");
    setLanded(null);
    void bridge
      .putOnline(true)
      .then((answer) => {
        if (!answer.ok) {
          troubleHere(answer.trouble);
          return;
        }
        setLanded({ kind: "online", went: answer.value });
      })
      .finally(() => {
        setGoing(null);
        refreshLanding();
      });
  }, [refreshLanding, troubleHere]);

  /** One value moved, from wherever the panel offered it: a slider, or a colour
   *  nobody could read against the one underneath it. */
  const nudge = useCallback((name: string, value: string) => {
    void bridge.nudgeToken(name, value).then((answer) => {
      const path = desks.current;
      if (!answer.ok || path === null) return;
      setDesks((current) =>
        changeDesk(current, path, (one) => ({ ...one, versions: answer.value })),
      );
      void refreshOverview(path);
    });
  }, [desks.current, refreshOverview]);

  /* ------------------------------------------------------------------ money */

  /**
   * "See where it went": the split between the work and our own retries.
   *
   * It is said in the conversation rather than shown in a panel, because it is
   * us telling somebody something, and because the sentence that admits what
   * our mistakes cost them should sit in the same thread as everything else we
   * said — not in a report they have to go and open.
   */
  const showSplit = useCallback(() => {
    const split = desk?.spent?.split;
    if (!split) return;
    say(`${sessionSummary(split).lines.join("\n")}\n\n${retryHonesty}`);
  }, [desk, say]);

  /* ----------------------------------------------------------------- see it */

  /**
   * Get the project ready and open it.
   *
   * Whatever the project makes, served from this machine and opened in their own
   * browser — never the thing a developer runs while they are working. That
   * decision belongs to notes/strategy/SHARING.md §1 and is not the window's to
   * revisit; all this does is press the button and put the answer in the thread.
   */
  const seeIt = useCallback(async (at?: string, point?: boolean) => {
    if (desks.current === null) return;
    // Said here as well as by the shell, so pressing the button has an answer
    // inside 100ms rather than after a folder has been read.
    setProgress({ says: showWords.puttingTogether, done: false });
    try {
      const answer = await bridge.show(at, point);
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
      // "Ready" gets a beat on screen. A browser window opening on its own is
      // startling without a sentence somewhere saying it was meant to.
      setProgress({ says: showWords.ready, done: true });
      // Which page is in front of them now, so the shelf can mark it.
      setShowingPage(at ?? null);
      window.setTimeout(() => setProgress(null), 1400);
      // The overview keeps the address of what was just served, so the pill can
      // take you back to it all evening.
      void refreshOverview(desks.current);
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
  }, [desks.current, say, troubleHere, refreshOverview]);

  /* The shelf's pages, with what is known about each one. Nothing here is asked
     for separately — it is all already on the desk. */
  const shelfPages: readonly ShelfPage[] = useMemo(
    () =>
      pages.map((page) => ({
        ...page,
        ...(showingPage === page.route ? { showing: true } : {}),
      })),
    [pages, showingPage],
  );

  /* Everything the bar can reach. Held still between renders so the search does
     not re-run on every keystroke elsewhere. */
  const reachable: Things = useMemo(
    () => ({
      projects: recent ?? [],
      conversations,
      pages,
      versions: desk?.versions ?? [],
    }),
    [recent, conversations, pages, desk?.versions],
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
          void seeIt(found.page.route);
          return;
        // Going back is snapshotted first and is itself undoable, which is what
        // makes it safe to reach from here rather than only from the rail.
        case "version":
          void putBack(found.version.id);
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
  const overviewed =
    desk !== null &&
    (desk.overview?.git !== null ||
      research.length > 0 ||
      desk.references.length > 0 ||
      desk.versions.length >= 2);

  // The pill that takes you back to the live preview. It earns its place the
  // moment there is an address to go to — nothing here is worth a button before
  // the work is actually being served.
  const previewUrl = desk?.overview?.preview ?? null;
  const pillShown = desk !== null && (previewUrl !== null || progress !== null);
  const pillLabel = progress !== null ? progress.says : PREVIEW;

  // The one region nobody is given: it is here because somebody went and asked
  // for it, and it stays until they say otherwise.
  const filesShown = desk !== null && preferences.showFiles;

  return (
    <main
      className={`app ${empty ? "app--empty" : ""} ${overviewed ? "app--overviewed" : ""} ${shelved ? "app--shelved" : ""} ${shelved && !shelfOpen ? "app--shelfclosed" : ""} ${filesShown ? "app--files" : ""}`}
      ref={scrollRef}
    >
      {bridge.desktop || desk !== null ? (
        <div className="topbar">
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

          {/* The way into the bar for anyone who was never told about ⌘K. */}
          {desk === null ? null : (
            <button
              type="button"
              className="topbar__ask"
              onClick={() => setAsking(true)}
              title="Find a project, a page, a saved moment — or just say something"
            >
              Ask for anything
            </button>
          )}

          {/* Only where the composer is not: with a project open the chip lives
              in the composer's own row, and two of them saying the same thing
              would be one too many. */}
          {picking ? (
            <div className="topbar__thinking">
              <ThinkingWith
                state={connection}
                onSelect={selectModel}
                onConnect={openConnect}
                bare
              />
            </div>
          ) : null}

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
                onPreview={() => void seeIt()}
                onAccount={openConnect}
                onAddMore={() => {
                  setSwitching(false);
                  setAddMore(true);
                  void bridge.packages().then((answer) => {
                    if (answer.ok) setPacks(answer.value);
                  });
                }}
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
            onClick={() => void seeIt()}
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
          pages={shelfPages}
          onOpenPage={(page) => void seeIt(page.route)}
          onAddPage={(name) => void send(`Add a page called ${name}.`)}
          pinned={desk?.references ?? []}
          conversations={conversations}
          openConversation={inConversation}
          onOpenConversation={(path) => void swapConversation(path)}
          onNewConversation={() => void swapConversation(null)}
          open={shelfOpen}
          onToggle={() => setShelfOpen((was) => !was)}
        />
      ) : null}

      {filesShown && desk !== null ? (
        <aside className="filespanel">
          <h2 className="filespanel__title">Everything in this project</h2>
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
        {filesShown && reading !== null ? (
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
          <Welcome onUse={setDraft} />
        ) : (
          <>
            {/* The top of the page. A sibling of the thread rather than its
                first row, so it stays on the window's first band while the
                conversation collects at the bottom by the composer. */}
            <header className="workhead">
              <h1 className="workhead__name">{desk.name}</h1>
              <p className="workhead__note">{workingNote(desk)}</p>
            </header>

            <div className="thread">
            {desk.turns.map((turn) => (
              <Fragment key={turn.id}>
                <Turnstile
                  turn={turn}
                  onRespond={respond}
                  onDismiss={dismiss}
                  onAnswerEstimate={answerEstimate}
                  onAnswerPlan={answerPlan}
                  showMe={preferences.showMe}
                />
                {(pictures.under.get(turn.id) ?? []).map((one) => (
                  <Picture key={one.change.id} change={one.change} />
                ))}
              </Fragment>
            ))}
              {pictures.last.map((one) => (
                <Picture key={one.change.id} change={one.change} />
              ))}
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

            <Composer
              onSend={(text) => void send(text)}
              onStop={halt}
              autoFocus
              busy={busy}
              draft={draft}
              attachments={attachments}
              connection={connection}
              plans={plans}
              onPlans={setPlans}
              onSelectModel={selectModel}
              onConnect={openConnect}
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
          view={{
            now: nowDoing(desk.turns),
            git: desk.overview?.git ?? null,
            research,
            references: desk.references,
            versions: desk.versions,
            pictures: versionPictures[desk.path] ?? {},
            kept: preferences.kept[desk.path] ?? [],
            putBack: desk.putBack,
            spent: desk.spent,
            busy,
            showMe: preferences.showMe,
            looks: looks.looks,
            looksSay: looks.says,
            checkingWidths,
            workingAt,
            artifacts: desk.overview?.artifacts ?? [],
            swatches: desk.overview?.swatches ?? [],
            styles: desk.overview?.styles ?? null,
            landing,
            going,
            landed,
            decided,
          }}
          onPutBack={(versionId) => void putBack(versionId)}
          onName={(versionId, name) => void nameVersion(versionId, name)}
          onKeep={keepVersion}
          onDismissPutBack={dismissPutBack}
          onShowSplit={showSplit}
          onOpenFile={(file) => void bridge.openInEditor(file)}
          onCheckWidths={() => {
            setCheckingWidths(true);
            void bridge
              .checkWidths()
              .then((answer) => {
                if (answer.ok) setLooks(answer.value);
              })
              .finally(() => setCheckingWidths(false));
          }}
          onWorkAt={(look) => setWorkingAt((was) => (was === look.id ? null : look.id))}
          onShare={() => void bridge.shareReview()}
          onHoldBack={changeHoldBack}
          onDecide={decideOnWork}
          onHandOver={handToDeveloper}
          onPutOnline={putItOnline}
          onOpenLink={(address) => void bridge.openLink(address)}
          onNudge={nudge}
          onFixColour={nudge}
          onSave={() => {
            void bridge.saveVersion().then((answer) => {
              if (!answer.ok) return;
              const path = desks.current;
              if (path === null) return;
              setDesks((current) =>
                changeDesk(current, path, (one) => ({ ...one, versions: answer.value })),
              );
            });
          }}
        />
      ) : null}

      {!overviewed && desk !== null && desk.spent !== null ? (
        <CostMeter
          spent={desk.spent.total}
          corner
          onDetails={desk.spent.split === null ? undefined : showSplit}
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
  onDismiss,
  onAnswerEstimate,
  onAnswerPlan,
  showMe,
}: {
  turn: Turn;
  onRespond: (turnId: string, callId: string, decision: Decision) => void;
  onDismiss: (turnId: string) => void;
  onAnswerEstimate: (turn: EstimateTurn, go: boolean) => void;
  onAnswerPlan: (turnId: string, go: boolean) => void;
  /** Name the real command, path or operation under each step (BACKLOG D1).
   *  The words themselves were recorded when the step happened, so turning this
   *  on explains the conversation you already had. */
  showMe: boolean;
}) {
  switch (turn.kind) {
    case "said":
      return (
        <Message from={turn.from} streaming={turn.streaming}>
          {turn.text}
        </Message>
      );

    case "did":
      return (
        <ActivityLine
          state={turn.state}
          label={turn.label}
          detail={turn.detail}
          real={showMe ? turn.real : undefined}
        />
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

    case "plan":
      return (
        <PlanCard
          steps={turn.steps}
          caveats={turn.caveats}
          answered={turn.answered}
          onGo={() => onAnswerPlan(turn.id, true)}
          onChange={() => onAnswerPlan(turn.id, false)}
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
          label={longConversation.tidying}
          real={showMe ? behind.tidying : undefined}
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
