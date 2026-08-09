import { useCallback, useEffect, useRef, useState } from 'react';
import ActivityLine, { type ActivityState } from './components/ActivityLine';
import Composer from './components/Composer';
import ConfirmChange from './components/ConfirmChange';
import CostMeter from './components/CostMeter';
import ErrorCard from './components/ErrorCard';
import Message, { type MessageAuthor } from './components/Message';
import Gallery from './gallery/Gallery';
import type { AgentEvent, Money } from './agent/types';
import { bridge } from './lib/bridge';
import { describeCall } from './lib/describe';
import type { Decision, OpenedProject, Trouble } from './lib/ipc';
import './App.css';

/** /?gallery renders every component on one page instead of the app, so the UI
 *  can be screenshotted and reviewed in both themes. Read once, at module load. */
const showGallery = new URLSearchParams(window.location.search).has('gallery');

export default function App() {
  return showGallery ? <Gallery /> : <Conversation />;
}

/* -------------------------------------------------------------------------- */
/* The thread                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One thing in the conversation, whoever caused it.
 *
 * A single ordered list rather than a message list with side channels, because
 * the order is the meaning: "I am about to change your header" only makes sense
 * above the change, and "you said no" only makes sense below the question.
 * Splitting activity out into its own pane would lose that, and it is the whole
 * reason the feed reads as one conversation instead of a log next to a chat.
 */
type Turn =
  | { kind: 'said'; id: string; from: MessageAuthor; text: string; streaming: boolean }
  | { kind: 'did'; id: string; callId: string; state: ActivityState; label: string; detail?: string }
  | {
      kind: 'asked';
      id: string;
      callId: string;
      question: string;
      detail?: string;
      consequence?: string;
      /** Null while the question is still open. */
      answered: Decision | null;
    }
  | { kind: 'trouble'; id: string; trouble: Trouble };

let counter = 0;
function newId(): string {
  counter += 1;
  return `turn-${counter}`;
}

/** Close off the most recent activity for a call. Returns the same array when
 *  there was nothing to close, which is how `blocked` tells the difference
 *  between "stopped something that had started" and "stopped it before it
 *  started" — the Guard does the latter, and there is no line to update. */
function closeActivity(
  turns: readonly Turn[],
  callId: string,
  state: ActivityState,
  detail?: string,
): readonly Turn[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    if (turn.kind !== 'did' || turn.callId !== callId || turn.state !== 'running') continue;
    const next = [...turns];
    next[index] = { ...turn, state, detail: detail ?? turn.detail };
    return next;
  }
  return turns;
}

/**
 * Add a problem, unless it is the one already on screen.
 *
 * `prompt` can report the same failure twice: the adapter relays it as an
 * `error` event on the way out, and the call itself then comes back as a
 * failure. Both are correct and neither is redundant to the code — but two
 * identical cards stacked on top of each other reads as two things having gone
 * wrong, which is exactly the impression the error copy is written to avoid.
 */
function withTrouble(turns: readonly Turn[], trouble: Trouble): readonly Turn[] {
  const from = Math.max(0, turns.length - 3);
  for (let index = turns.length - 1; index >= from; index -= 1) {
    const turn = turns[index];
    if (turn === undefined || turn.kind !== 'trouble') continue;
    if (turn.trouble.because !== trouble.because) continue;
    // Same failure. The two tellings of it can differ in one way that matters:
    // only one carries the raw text for whoever wants to read it. Keep that one.
    if (turn.trouble.details !== undefined || trouble.details === undefined) return turns;
    const next = [...turns];
    next[index] = { ...turn, trouble };
    return next;
  }
  return [...turns, { kind: 'trouble', id: newId(), trouble }];
}

const STOPPED_PART_WAY = 'I stopped part way through.';

export function applyEvent(turns: readonly Turn[], event: AgentEvent): readonly Turn[] {
  switch (event.type) {
    case 'message-delta': {
      const last = turns[turns.length - 1];
      if (last !== undefined && last.kind === 'said' && last.from === 'graphe' && last.streaming) {
        return [...turns.slice(0, -1), { ...last, text: last.text + event.text }];
      }
      return [
        ...turns,
        { kind: 'said', id: newId(), from: 'graphe', text: event.text, streaming: true },
      ];
    }

    case 'message-end':
      return turns.map((turn) =>
        turn.kind === 'said' && turn.streaming ? { ...turn, streaming: false } : turn,
      );

    case 'tool-start': {
      const described = describeCall(event.call);
      return [
        ...turns,
        {
          kind: 'did',
          id: newId(),
          callId: event.call.id,
          state: 'running',
          label: described.label,
          detail: described.detail,
        },
      ];
    }

    case 'tool-end':
      return closeActivity(turns, event.id, event.ok ? 'done' : 'failed');

    case 'blocked': {
      const closed = closeActivity(turns, event.call.id, 'failed', event.reason);
      if (closed !== turns) return closed;
      return [
        ...turns,
        {
          kind: 'did',
          id: newId(),
          callId: event.call.id,
          state: 'failed',
          label: describeCall(event.call).label,
          detail: event.reason,
        },
      ];
    }

    case 'needs-confirmation':
      return [
        ...turns,
        {
          kind: 'asked',
          id: newId(),
          callId: event.call.id,
          question: event.verdict.question,
          detail: event.verdict.detail,
          consequence: event.verdict.consequence,
          answered: null,
        },
      ];

    case 'error':
      return withTrouble(turns, {
        what: STOPPED_PART_WAY,
        because: event.message,
        actionLabel: 'Got it',
      });
  }
}

/* -------------------------------------------------------------------------- */
/* What is said when there is no folder yet                                    */
/* -------------------------------------------------------------------------- */

const NO_FOLDER_YET =
  'Before I can start I need to know which folder your project lives in. Send that again when you have picked one.';

function workingIn(project: OpenedProject): string {
  return `Working in ${project.name}.`;
}

/* -------------------------------------------------------------------------- */
/* The app                                                                     */
/* -------------------------------------------------------------------------- */

function Conversation() {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState<OpenedProject | null>(null);
  /**
   * What has been spent. The meter is furniture that appears the first time
   * there is a number, and stays (notes/strategy/UI-DESIGN.md) — so it is gated
   * on this rather than always mounted.
   *
   * Nothing sets it yet: `AgentEvent` in src/agent/types.ts carries no money,
   * so the window has no honest figure to show and shows nothing rather than a
   * zero or an estimate dressed up as a total. When spend does start arriving,
   * this is the only line that changes.
   */
  const [spent] = useState<Money | null>(null);

  const foot = useRef<HTMLDivElement>(null);

  const say = useCallback((from: MessageAuthor, text: string) => {
    setTurns((current) => [...current, { kind: 'said', id: newId(), from, text, streaming: false }]);
  }, []);

  /* Everything the agent does, in order. Subscribed once for the life of the
     window: the bridge outlives any one prompt, and re-subscribing per send
     would drop events that arrive between them. */
  useEffect(() => bridge.onEvent((event) => setTurns((current) => applyEvent(current, event))), []);

  /* Keep the newest thing in view. No smooth scrolling — the thread grows while
     the reply streams, and animating that would mean the page is permanently
     gliding under the words somebody is trying to read. */
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  const halt = useCallback(() => {
    void bridge.stop();
  }, []);

  /* Esc cancels the current run — the keyboard rule in UI-DESIGN.md. */
  useEffect(() => {
    if (!busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') halt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, halt]);

  /**
   * Send one message.
   *
   * The folder is asked for here rather than on a setup screen. The first screen
   * is a conversation and nothing else, so the picker appears at the first
   * moment it means something — when there is finally a thing to do in a folder.
   */
  const send = useCallback(
    async (text: string) => {
      setTurns((current) => [
        ...current,
        { kind: 'said', id: newId(), from: 'you', text, streaming: false },
      ]);
      setBusy(true);

      try {
        let open = project;

        if (open === null && bridge.desktop) {
          const picked = await bridge.chooseFolder();
          if (!picked.ok) {
            setTurns((current) => withTrouble(current, picked.trouble));
            return;
          }
          if (picked.value === null) {
            say('graphe', NO_FOLDER_YET);
            return;
          }

          const opened = await bridge.openProject(picked.value);
          if (!opened.ok) {
            setTurns((current) => withTrouble(current, opened.trouble));
            return;
          }
          open = opened.value;
          setProject(open);
          say('graphe', workingIn(open));
        }

        const reply = await bridge.prompt(text);
        if (!reply.ok) setTurns((current) => withTrouble(current, reply.trouble));
      } catch (cause) {
        // The bridge is not supposed to throw. If it ever does, the window says
        // something calm rather than turning white.
        setTurns((current) =>
          withTrouble(current, {
            what: STOPPED_PART_WAY,
            because: 'Something went wrong on my side. Nothing has been changed.',
            actionLabel: 'Got it',
            details: cause instanceof Error ? (cause.stack ?? cause.message) : undefined,
          }),
        );
      } finally {
        setBusy(false);
      }
    },
    [project, say],
  );

  const respond = useCallback((turnId: string, callId: string, decision: Decision) => {
    setTurns((current) =>
      current.map((turn) =>
        turn.kind === 'asked' && turn.id === turnId ? { ...turn, answered: decision } : turn,
      ),
    );
    void bridge.answer(callId, decision);
  }, []);

  const dismiss = useCallback((turnId: string) => {
    setTurns((current) => current.filter((turn) => turn.id !== turnId));
  }, []);

  // The first screen is a single centred conversation. Nothing else.
  // Regions appear the first time they have something to say — see notes/strategy/UI-DESIGN.md.
  const empty = turns.length === 0;

  return (
    <main className={`app ${empty ? 'app--empty' : ''}`}>
      {bridge.desktop ? <div className="app__titlebar" /> : null}

      <div className="app__column">
        {empty ? (
          <div className="welcome">
            <h1 className="welcome__title">What do you want to make?</h1>
            <p className="welcome__sub">Start with a Figma file, a sketch, or just a sentence.</p>
          </div>
        ) : (
          <div className="thread">
            {turns.map((turn) => (
              <Turnstile key={turn.id} turn={turn} onRespond={respond} onDismiss={dismiss} />
            ))}
            <div ref={foot} className="thread__foot" />
          </div>
        )}

        <div className="app__composer">
          <Composer onSend={(text) => void send(text)} autoFocus busy={busy} />
          {busy ? (
            <button type="button" className="app__stop" onClick={halt}>
              Stop
            </button>
          ) : null}
        </div>
      </div>

      {spent !== null ? <CostMeter spent={spent} corner /> : null}
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
