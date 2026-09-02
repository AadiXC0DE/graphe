import { useState } from 'react';
import type { InStep as InStepView, Move } from '../lib/ipc';
import { agoInSentence } from '../lib/when';
import './InStep.css';

type Props = {
  state: InStepView;
  /** True while the file is being read. */
  busy?: boolean;
  /** "Show me" is on: the exact values sit under each sentence. */
  detail?: boolean;
  /** Start keeping this project in step with a pasted Figma address. */
  onFollow: (address: string) => void;
  /** Read the file again. */
  onLookAgain: () => void;
  /** Bring the work into step with one thing that moved. */
  onBuildIn: (move: Move) => void;
  /** The work matches Figma now; take this reading as what it was built from. */
  onCaughtUp: () => void;
  onStop: () => void;
};

/** Every word this component can put on screen, in one place. */
export const SAYS = {
  heading: 'In step with Figma',
  /** What it needs, and what it does with it. The empty state is the one most
   *  people meet, and "I will tell you when it moves" said nothing about the
   *  reading it takes or the press it puts under each difference. */
  invitation:
    'Paste a Figma file or frame. I read its colour, spacing and type as they stand now and keep that reading as what this work was built from. After that, every look tells you what has moved, and offers to build each change in.',
  /** The way in for somebody who has to make the reading work at all. */
  needs: 'Reading a file needs a Figma access token in FIGMA_TOKEN.',
  placeholder: 'Paste a Figma address',
  follow: 'Follow it',
  lookAgain: 'Look again',
  looking: 'Looking…',
  buildIn: 'Build this in',
  caughtUp: 'It matches now',
  stop: 'Stop following',
  open: 'Open in Figma',
  /** Where it stands, in two words, beside the heading. */
  state: {
    none: 'Not following',
    level: 'In step',
    drifted: 'Drifted',
  },
  looked: (when: string): string => `Looked ${when}`,
} as const;

/** Two colours touching, so the eye does the comparing — the same argument the
 *  near-miss rows make, for the same reason. */
function Pair({ move }: { move: Move }) {
  if (move.kind !== 'colour' || move.was === null || move.now === null) return null;
  return (
    <span className="instep__pair" aria-hidden="true">
      <span className="instep__well" style={{ background: move.was }} />
      <span className="instep__well" style={{ background: move.now }} />
    </span>
  );
}

/**
 * What has moved on in Figma since the work was built from it.
 *
 * Presentational and nothing else: everything it knows arrives as props and
 * everything it can do leaves as a callback. Where it stands is said in two
 * words beside the heading — not following, in step, drifted — because a band
 * that only ever shows an invitation looks the same whether nothing is followed
 * or the last look failed.
 */
export default function InStep({
  state,
  busy = false,
  detail = false,
  onFollow,
  onLookAgain,
  onBuildIn,
  onCaughtUp,
  onStop,
}: Props) {
  const [address, setAddress] = useState('');
  const { following, moved } = state;

  if (following === null) {
    return (
      <section className="instep" aria-label={SAYS.heading}>
        <header className="instep__head">
          <h2 className="instep__heading">{SAYS.heading}</h2>
          <span className="instep__state">{SAYS.state.none}</span>
        </header>
        <p className="instep__invite">{SAYS.invitation}</p>
        <form
          className="instep__ask"
          onSubmit={(event) => {
            event.preventDefault();
            const typed = address.trim();
            if (typed === '' || busy) return;
            onFollow(typed);
            setAddress('');
          }}
        >
          <input
            className="instep__field"
            type="text"
            value={address}
            placeholder={SAYS.placeholder}
            aria-label={SAYS.placeholder}
            onChange={(event) => setAddress(event.target.value)}
            disabled={busy}
          />
          <button
            type="submit"
            className="instep__do"
            disabled={busy || address.trim() === ''}
          >
            {busy ? SAYS.looking : SAYS.follow}
          </button>
        </form>
        {state.trouble === null ? null : <p className="instep__trouble">{state.trouble}</p>}
        <p className="instep__needs">{SAYS.needs}</p>
      </section>
    );
  }

  const drifted = moved.length > 0;

  return (
    <section className="instep" aria-label={SAYS.heading}>
      <header className="instep__head">
        <h2 className="instep__heading">{SAYS.heading}</h2>
        <span className={`instep__state${drifted ? ' instep__state--drifted' : ''}`}>
          {drifted ? SAYS.state.drifted : SAYS.state.level}
        </span>
        <button type="button" className="instep__quiet" onClick={onStop} disabled={busy}>
          {SAYS.stop}
        </button>
      </header>

      {/* Which file, when it was last read, and the way back to it. All three
          were in the reading already and none of them reached the screen. */}
      <p className="instep__file">
        <span className="instep__name">{following.name}</span>
        <span className="instep__looked">{SAYS.looked(agoInSentence(following.readAt))}</span>
        <a className="instep__open" href={following.url} target="_blank" rel="noreferrer">
          {SAYS.open}
        </a>
      </p>

      <p className="instep__says">{state.says}</p>

      {state.trouble === null ? null : <p className="instep__trouble">{state.trouble}</p>}

      {moved.length === 0 ? null : (
        <ul className="instep__list">
          {moved.map((move) => (
            <li key={move.id} className={`instep__row instep__row--${move.what}`}>
              <Pair move={move} />
              <span className="instep__text">
                <span className="instep__moved" id={`instep-${move.id}`}>
                  {move.says}
                </span>
                {detail ? <span className="instep__detail">{move.detail}</span> : null}
              </span>
              <button
                type="button"
                className="instep__use"
                onClick={() => onBuildIn(move)}
                disabled={busy}
                aria-describedby={`instep-${move.id}`}
              >
                {SAYS.buildIn}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="instep__foot">
        <button type="button" className="instep__do" onClick={onLookAgain} disabled={busy}>
          {busy ? SAYS.looking : SAYS.lookAgain}
        </button>
        {moved.length === 0 ? null : (
          <button type="button" className="instep__quiet" onClick={onCaughtUp} disabled={busy}>
            {SAYS.caughtUp}
          </button>
        )}
      </div>
    </section>
  );
}
