import { useCallback, useEffect, useState } from 'react';
import { useStickToBottom } from 'use-stick-to-bottom';
import ActivityLine from './components/ActivityLine';
import type { Attachment } from './components/Attachments';
import Composer from './components/Composer';
import ConfirmChange from './components/ConfirmChange';
import CostMeter from './components/CostMeter';
import ErrorCard from './components/ErrorCard';
import Message from './components/Message';
import ProjectPicker from './components/ProjectPicker';
import Versions from './components/Versions';
import Gallery from './gallery/Gallery';
import { retryHonesty, sessionSummary } from './cost/phrasing';
import { bridge } from './lib/bridge';
import {
  showWords,
  type Decision,
  type OpenedProject,
  type RecentProject,
  type ShowProgress,
  type Trouble,
} from './lib/ipc';
import { usePrefersReducedMotion } from './lib/motion';
import {
  changeCurrent,
  changeDesk,
  closeDesk,
  currentDesk,
  noDesks,
  openDesk,
  receive,
  type Desks,
} from './lib/projects';
import { said, withTrouble, STOPPED_PART_WAY, type Turn } from './lib/thread';
import './App.css';

/** /?gallery renders every component on one page instead of the app, so the UI
 *  can be screenshotted and reviewed in both themes. Read once, at module load. */
const showGallery = new URLSearchParams(window.location.search).has('gallery');

/** /?open=<name> opens one of the preview's own projects on load, so the states
 *  that only exist once a folder is open — the version rail, the strip with the
 *  project's name in it — can be screenshotted without a desktop shell under the
 *  page. Ignored by the app: a window loaded by the shell has no query string. */
const openOnLoad = new URLSearchParams(window.location.search).get('open');

export default function App() {
  return showGallery ? <Gallery /> : <Conversation />;
}

/* -------------------------------------------------------------------------- */
/* What is said when there is no folder yet                                    */
/* -------------------------------------------------------------------------- */

const NO_FOLDER_YET =
  'Before I can start I need to know which folder your project lives in. Send that again when you have picked one.';

function workingIn(project: OpenedProject): string {
  return `Working in ${project.name}.`;
}

/** The label on the button that gets a project ready and opens it. */
const SEE_IT = 'See it';

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
  /** A project that would not open, said beside the picker rather than in a
   *  conversation that does not exist yet. */
  const [pickerTrouble, setPickerTrouble] = useState<{ path: string; trouble: Trouble } | null>(
    null,
  );

  const [busy, setBusy] = useState(false);
  /** What "See it" is up to, in its own words. Null when it is not up to
   *  anything. */
  const [progress, setProgress] = useState<ShowProgress | null>(null);

  /** Attachments before there is a project to attach them to. Once a folder is
   *  open they live on its desk, like everything else. */
  const [loose, setLoose] = useState<readonly Attachment[]>([]);
  const attachments = desk?.attachments ?? loose;

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
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    initial: 'instant',
    resize: 'instant',
  });
  const reducedMotion = usePrefersReducedMotion();

  /* The one scroll a person asks for by name, so it is allowed to be a movement
     rather than a jump — a spring, damped so it settles instead of bouncing,
     and instant for anyone who has asked for less of that. It is interruptible:
     touching the wheel on the way down stops it where it is. */
  const jumpToLatest = useCallback(() => {
    void scrollToBottom({
      animation: reducedMotion ? 'instant' : { damping: 0.9, stiffness: 0.1, mass: 1 },
    });
  }, [scrollToBottom, reducedMotion]);

  /** Say something on the desk in front. Nothing is said when there is none —
   *  a sentence with nowhere to go is a sentence nobody reads. */
  const say = useCallback((text: string) => {
    setDesks((current) =>
      changeCurrent(current, (one) => ({ ...one, turns: [...one.turns, said('graphe', text)] })),
    );
  }, []);

  const troubleHere = useCallback((trouble: Trouble) => {
    setDesks((current) =>
      changeCurrent(current, (one) => ({ ...one, turns: withTrouble(one.turns, trouble) })),
    );
  }, []);

  /* ---------------------------------------------------------------- versions */

  /** Ask for the timeline of the project in front, and put it on that desk.
   *  Applied only if it is still the one in front by the time the answer comes
   *  back — the shell answers about whatever is current, so a switch mid-flight
   *  would otherwise write one project's history onto another's desk. */
  const refreshVersions = useCallback(async (path: string) => {
    const answer = await bridge.versions();
    if (!answer.ok) return;
    setDesks((current) =>
      current.current === path
        ? changeDesk(current, path, (one) => ({ ...one, versions: answer.value }))
        : current,
    );
  }, []);

  /* ------------------------------------------------------------- the folder */

  const open = useCallback(
    async (path: string): Promise<void> => {
      const opened = await bridge.openProject(path);
      if (!opened.ok) {
        // Before there is a conversation the picker is the only place a sentence
        // can go, and the useful thing to offer there is taking the project off
        // the list rather than trying the same folder again.
        if (desks.current === null) setPickerTrouble({ path, trouble: opened.trouble });
        else troubleHere(opened.trouble);
        return;
      }

      setSwitching(false);
      setPickerTrouble(null);
      setDesks((current) => {
        const next = openDesk(current, opened.value);
        const desk = next.byPath[opened.value.path];
        // Only the first time. Coming back to a folder should feel like coming
        // back to a desk, not like being introduced to it again.
        return desk !== undefined && desk.turns.length === 0
          ? changeDesk(next, opened.value.path, (one) => ({
              ...one,
              turns: [said('graphe', workingIn(opened.value))],
            }))
          : next;
      });

      void refreshVersions(opened.value.path);
      void bridge.recentProjects().then((answer) => {
        if (answer.ok) setRecent(answer.value);
      });
    },
    [desks.current, refreshVersions, troubleHere],
  );

  const browse = useCallback(async () => {
    const picked = await bridge.chooseFolder();
    if (!picked.ok) {
      if (desks.current === null) setPickerTrouble({ path: '', trouble: picked.trouble });
      else troubleHere(picked.trouble);
      return;
    }
    if (picked.value === null) return;
    await open(picked.value);
  }, [desks.current, open, troubleHere]);

  const forget = useCallback(async (project: { path: string }) => {
    setPickerTrouble(null);
    setDesks((current) => closeDesk(current, project.path));
    const answer = await bridge.forgetProject(project.path);
    if (answer.ok) setRecent(answer.value);
  }, []);

  /* ------------------------------------------------------------ first paint */

  useEffect(() => {
    let stillHere = true;
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
        // timeline has something new in it.
        if (notice.event.type === 'settled' && notice.project !== null) {
          void refreshVersions(notice.project);
        }
      }),
    [refreshVersions],
  );

  useEffect(() => bridge.onShowProgress(setProgress), []);

  /* A dropdown closes when you look away from it. Pointer down rather than
     click, so it is gone by the time the finger lifts. */
  useEffect(() => {
    if (!switching) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.topbar') !== null) return;
      setSwitching(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [switching]);

  const halt = useCallback(() => {
    void bridge.stop();
  }, []);

  /* Esc cancels the current run, and closes the switcher — the keyboard rules in
     UI-DESIGN.md. ⌘O opens a folder; ⌘1–9 goes straight to one we remember. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (switching) setSwitching(false);
        else if (busy) halt();
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key === 'o') {
        event.preventDefault();
        void browse();
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, halt, switching, browse, open, recent]);

  /* ----------------------------------------------------------------- saying */

  /**
   * Send one message.
   *
   * The folder is still asked for here when there is not one, because a first
   * launch with nothing remembered is a conversation and nothing else — the
   * picker only exists once there is something to pick.
   */
  const send = useCallback(
    async (text: string) => {
      const before = desks.current;
      setDesks((current) =>
        current.current === null
          ? current
          : changeCurrent(current, (one) => ({ ...one, turns: [...one.turns, said('you', text)] })),
      );
      setBusy(true);

      try {
        if (before === null) {
          if (!bridge.desktop) return;
          const picked = await bridge.chooseFolder();
          if (!picked.ok) {
            setPickerTrouble({ path: '', trouble: picked.trouble });
            return;
          }
          if (picked.value === null) {
            setPickerTrouble({
              path: '',
              trouble: {
                what: 'I still do not have a folder to work in.',
                because: NO_FOLDER_YET,
                actionLabel: 'Got it',
              },
            });
            return;
          }
          await open(picked.value);
          // The sentence goes on the desk that has just been made, so it is not
          // lost with the screen it was typed on.
          setDesks((current) =>
            changeCurrent(current, (one) => ({ ...one, turns: [...one.turns, said('you', text)] })),
          );
        }

        const reply = await bridge.prompt(text);
        if (!reply.ok) troubleHere(reply.trouble);
      } catch (cause) {
        // The bridge is not supposed to throw. If it ever does, the window says
        // something calm rather than turning white.
        troubleHere({
          what: STOPPED_PART_WAY,
          because: 'Something went wrong on my side. Nothing has been changed.',
          actionLabel: 'Got it',
          details: cause instanceof Error ? (cause.stack ?? cause.message) : undefined,
        });
      } finally {
        setBusy(false);
      }
    },
    [desks.current, open, troubleHere],
  );

  const respond = useCallback((turnId: string, callId: string, decision: Decision) => {
    setDesks((current) =>
      changeCurrent(current, (one) => ({
        ...one,
        turns: one.turns.map((turn) =>
          turn.kind === 'asked' && turn.id === turnId ? { ...turn, answered: decision } : turn,
        ),
      })),
    );
    void bridge.answer(callId, decision);
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
        changeDesk(current, path, (one) => ({ ...one, versions: answer.value })),
      );
    },
    [desks.current, troubleHere],
  );

  const dismissPutBack = useCallback(() => {
    setDesks((current) => changeCurrent(current, (one) => ({ ...one, putBack: null })));
  }, []);

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
    say(`${sessionSummary(split).lines.join('\n')}\n\n${retryHonesty}`);
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
  const seeIt = useCallback(async () => {
    if (desks.current === null) return;
    // Said here as well as by the shell, so pressing the button has an answer
    // inside 100ms rather than after a folder has been read.
    setProgress({ says: showWords.puttingTogether, done: false });
    try {
      const answer = await bridge.show();
      if (!answer.ok) {
        setProgress(null);
        troubleHere(answer.trouble);
        return;
      }
      if (answer.value.kind === 'unsure') {
        setProgress(null);
        say(answer.value.question);
        return;
      }
      // "Ready" gets a beat on screen. A browser window opening on its own is
      // startling without a sentence somewhere saying it was meant to.
      setProgress({ says: showWords.ready, done: true });
      window.setTimeout(() => setProgress(null), 1400);
    } catch {
      setProgress(null);
    }
  }, [desks.current, say, troubleHere]);

  /* ------------------------------------------------------------------- draw */

  // The first screen is a single centred conversation. Nothing else.
  // Regions appear the first time they have something to say — see
  // notes/strategy/UI-DESIGN.md.
  const picking = desk === null && recent !== null && recent.length > 0;
  const empty = desk === null || desk.turns.length === 0;
  // A rail listing one version teaches nobody anything. It arrives with the
  // second one, and then it stays.
  const railed = desk !== null && desk.versions.length >= 2;

  return (
    <main
      className={`app ${empty ? 'app--empty' : ''} ${railed ? 'app--railed' : ''}`}
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
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
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

          {desk === null ? null : (
            <button type="button" className="topbar__see" onClick={() => void seeIt()}>
              {progress === null ? SEE_IT : progress.says}
            </button>
          )}

          {switching && recent !== null ? (
            <div className="topbar__switcher" role="menu">
              <ProjectPicker
                projects={recent}
                openPath={desks.current}
                onOpen={(project) => void open(project.path)}
                onForget={(project) => void forget(project)}
                onBrowse={() => void browse()}
                compact
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="app__column" ref={contentRef}>
        {picking ? (
          <ProjectPicker
            projects={recent ?? []}
            onOpen={(project) => void open(project.path)}
            onForget={(project) => void forget(project)}
            onBrowse={() => void browse()}
          />
        ) : desk === null || desk.turns.length === 0 ? (
          <div className="welcome">
            <h1 className="welcome__title">What do you want to make?</h1>
            <p className="welcome__sub">Start with a Figma file, a sketch, or just a sentence.</p>
          </div>
        ) : (
          <div className="thread">
            {desk.turns.map((turn) => (
              <Turnstile key={turn.id} turn={turn} onRespond={respond} onDismiss={dismiss} />
            ))}
          </div>
        )}

        {pickerTrouble === null ? null : (
          <ErrorCard
            what={pickerTrouble.trouble.what}
            because={pickerTrouble.trouble.because}
            actionLabel={pickerTrouble.trouble.actionLabel}
            onAction={() => {
              const gone = pickerTrouble.path;
              setPickerTrouble(null);
              if (gone !== '') void forget({ path: gone });
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
              className={`jump ${empty || isAtBottom ? '' : 'jump--shown'}`}
              onClick={jumpToLatest}
              inert={empty || isAtBottom}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
              autoFocus
              busy={busy}
              attachments={attachments}
              onAttachmentsChange={(next) => {
                if (desks.current === null) setLoose(next);
                else {
                  setDesks((current) =>
                    changeCurrent(current, (one) => ({ ...one, attachments: next })),
                  );
                }
              }}
            />
            {busy ? (
              <button type="button" className="app__stop" onClick={halt}>
                Stop
              </button>
            ) : null}
          </div>
        )}
      </div>

      {railed && desk !== null ? (
        <Versions
          versions={desk.versions}
          putBack={desk.putBack}
          onPutBack={(versionId) => void putBack(versionId)}
          onName={(versionId, name) => void nameVersion(versionId, name)}
          onDismissPutBack={dismissPutBack}
          busy={busy}
        />
      ) : null}

      {desk !== null && desk.spent !== null ? (
        <CostMeter
          spent={desk.spent.total}
          corner
          onDetails={desk.spent.split === null ? undefined : showSplit}
        />
      ) : null}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* One turn, drawn                                                             */
/* -------------------------------------------------------------------------- */

function Turnstile({
  turn,
  onRespond,
  onDismiss,
}: {
  turn: Turn;
  onRespond: (turnId: string, callId: string, decision: Decision) => void;
  onDismiss: (turnId: string) => void;
}) {
  switch (turn.kind) {
    case 'said':
      return (
        <Message from={turn.from} streaming={turn.streaming}>
          {turn.text}
        </Message>
      );

    case 'did':
      return <ActivityLine state={turn.state} label={turn.label} detail={turn.detail} />;

    case 'asked':
      // Once it is answered the question stops being a control and becomes part
      // of the record — a live pair of buttons for a decision already taken is
      // how people learn to click without reading.
      return turn.answered === null ? (
        <ConfirmChange
          question={turn.question}
          detail={turn.detail}
          consequence={turn.consequence}
          confirmLabel="Yes, go ahead"
          cancelLabel="No, leave it"
          onConfirm={() => onRespond(turn.id, turn.callId, 'yes')}
          onCancel={() => onRespond(turn.id, turn.callId, 'no')}
        />
      ) : (
        <ActivityLine
          state={turn.answered === 'yes' ? 'done' : 'failed'}
          label={turn.question}
          detail={turn.answered === 'yes' ? 'You said yes.' : 'You said no, so I left it alone.'}
        />
      );

    case 'trouble':
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
