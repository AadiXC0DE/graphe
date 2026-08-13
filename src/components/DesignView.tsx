import { useEffect, useMemo, useRef, useState } from 'react';
import Drift from './Drift';
import InStep from './InStep';
import Legible from './Legible';
import Motion, { SAYS as MOTION } from './Motion';
import Responsive from './Responsive';
import Styles from './Styles';
import type { Finding as DriftFinding } from '../design/drift';
import type { Finding as ReadFinding } from '../design/legibility';
import type { InStep as InStepState, Look, Move, StyleToken } from '../lib/ipc';
import type { Change, Motion as Movement, Move as Movable } from '../motion/read';
import './Sheet.css';

/** Which band somebody came here for. */
export type DesignPart = 'styles' | 'motion' | 'drift' | 'legible' | 'widths' | 'figma';

export const SAYS = {
  heading: 'Design',
  save: 'Save changes',
  discard: 'Throw away',
  dirty: 'You have changes waiting to be saved.',
  clean: 'Nothing changed yet.',
  close: 'Close',
  /** Said under the title: what this reads, so nobody wonders what they are
   *  editing. */
  from: (file: string): string => `Reading ${file}`,
  fromNothing: 'This project has no stylesheet I can read yet.',
  noFigma: 'Nothing is being followed here yet.',
  parts: {
    styles: 'Styles',
    motion: 'Motion',
    drift: 'Not from your styles',
    legible: 'Hard to read',
    widths: 'Every width',
    figma: 'Figma',
  },
} as const;

const MOTION_NONE = MOTION.none;

const ORDER: readonly DesignPart[] = ['styles', 'motion', 'drift', 'legible', 'widths', 'figma'];

export type DesignData = {
  styles: { file: string; tokens: readonly StyleToken[]; text: string } | null;
  motion: Movement | null;
  drifted: readonly DriftFinding[];
  unreadable: readonly ReadFinding[];
  /** The one whose colour is on its way to being changed. */
  fixing: string | null;
  looks: readonly Look[];
  looksSay: string;
  checkingWidths: boolean;
  workingAt: string | null;
  inStep: InStepState | null;
  lookingAtFigma: boolean;
  busy: boolean;
  showMe: boolean;
};

type Props = {
  data: DesignData;
  /** The band to land on. */
  at: DesignPart;
  /** Whether there are edits waiting to be saved. */
  dirty: boolean;
  /** Saved by hand, once — the project is untouched until this. */
  onSave: () => void;
  /** Throw the held edits away without writing anything. */
  onDiscard: () => void;
  onClose: () => void;
  onNudge: (name: string, value: string) => void;
  onNudgeMotion: (move: Movable, change: Change) => void;
  onFixColour: (finding: ReadFinding) => void;
  onUseYours?: (finding: DriftFinding) => void;
  onCheckWidths: () => void;
  onWorkAt: (look: Look) => void;
  onFollowDesign: (address: string) => void;
  onLookAgain: () => void;
  onBuildIn: (move: Move) => void;
  onCaughtUp: () => void;
  onStopFollowing: () => void;
};

/** How many of each band there are to see, for the row of chips. Null where a
 *  count would be a lie — "every width" is four pictures whether or not
 *  anybody has taken them. */
function countOf(part: DesignPart, data: DesignData): number | null {
  switch (part) {
    case 'styles':
      return data.styles?.tokens.length ?? 0;
    case 'motion':
      return data.motion?.moves.length ?? 0;
    case 'drift':
      return data.drifted.length;
    case 'legible':
      return data.unreadable.length;
    case 'widths':
      return data.looks.length === 0 ? null : data.looks.length;
    case 'figma':
      return data.inStep === null ? null : data.inStep.moved.length;
  }
}

/**
 * Everything about how the project looks, with the room to look at it.
 *
 * These bands lived in a 328px column where a palette wrapped four to a row and
 * a hundred movements were a scroll nobody reached the end of. They are the same
 * bands; this is the whole width of the work instead, laid out so a project with
 * hundreds of values is still one screen you can find something in.
 *
 * It sits over the conversation rather than beside it: this is somewhere you go
 * for a minute and then leave, and Esc leaves.
 */
export default function DesignView({
  data,
  at,
  dirty,
  onSave,
  onDiscard,
  onClose,
  onNudge,
  onNudgeMotion,
  onFixColour,
  onUseYours,
  onCheckWidths,
  onWorkAt,
  onFollowDesign,
  onLookAgain,
  onBuildIn,
  onCaughtUp,
  onStopFollowing,
}: Props) {
  const body = useRef<HTMLDivElement>(null);
  const shut = useRef<HTMLButtonElement>(null);
  const [here, setHere] = useState<DesignPart>(at);

  /* Only the bands with something in them. A chip that scrolls to an empty
     heading is a chip that teaches you to stop pressing chips. */
  const parts = useMemo(
    () =>
      ORDER.filter((part) => {
        /* The two that are lists of things to put right have nothing to say
           when there is nothing wrong, so they stay away. Everything else
           carries its own empty state and is always here. */
        if (part === 'drift') return data.drifted.length > 0;
        if (part === 'legible') return data.unreadable.length > 0;
        return true;
      }),
    [data],
  );

  useEffect(() => {
    shut.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /* Landing on the band somebody asked for. Instant, because it is where the
     view opens rather than a journey across it. */
  useEffect(() => {
    if (at === 'styles') return;
    body.current?.querySelector(`#design-${at}`)?.scrollIntoView({ block: 'start' });
    setHere(at);
  }, [at]);

  const goTo = (part: DesignPart): void => {
    setHere(part);
    body.current
      ?.querySelector(`#design-${part}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <section className="sheet" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="sheet__from">
            {data.styles === null ? SAYS.fromNothing : SAYS.from(data.styles.file)}
          </p>
        </div>

        <nav className="sheet__chips" aria-label="What to look at">
          {parts.map((part) => {
            const count = countOf(part, data);
            return (
              <button
                key={part}
                type="button"
                className={`sheet__chip ${here === part ? 'sheet__chip--here' : ''}`}
                onClick={() => goTo(part)}
              >
                {SAYS.parts[part]}
                {count === null || count === 0 ? null : (
                  <span className="sheet__chipcount">{count}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sheet__save">
          <span
            className={`sheet__dirty${dirty ? ' sheet__dirty--on' : ''}`}
            title={dirty ? SAYS.dirty : SAYS.clean}
            aria-live="polite"
          >
            {dirty ? SAYS.dirty : SAYS.clean}
          </span>
          <button
            type="button"
            className="sheet__discard"
            onClick={onDiscard}
            disabled={!dirty}
          >
            {SAYS.discard}
          </button>
          <button
            type="button"
            className="sheet__savebtn"
            onClick={onSave}
            disabled={!dirty || data.busy}
          >
            {SAYS.save}
          </button>
        </div>

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body" ref={body}>
        <div className="sheet__grid">
          <section className="sheet__block sheet__block--wide sheet__block--bare" id="design-styles">
            <h2 className="sheet__blocktitle">{SAYS.parts.styles}</h2>
            {data.styles === null ? (
              <p className="sheet__nothing">{SAYS.fromNothing}</p>
            ) : (
              <Styles
                tokens={data.styles.tokens}
                file={data.styles.file}
                onNudge={onNudge}
                busy={data.busy}
              />
            )}
          </section>

          <section className="sheet__block sheet__block--wide" id="design-motion">
            <h2 className="sheet__blocktitle">{SAYS.parts.motion}</h2>
            {data.motion === null ? (
              <p className="sheet__nothing">{MOTION_NONE}</p>
            ) : (
              <Motion
                motion={data.motion}
                file={data.styles?.file ?? ''}
                onNudge={onNudgeMotion}
                busy={data.busy}
              />
            )}
          </section>

          {data.drifted.length === 0 ? null : (
            <section className="sheet__block" id="design-drift">
              <Drift
                findings={data.drifted}
                where={data.styles?.file ?? ''}
                detail={data.showMe}
                {...(onUseYours === undefined ? {} : { onUse: onUseYours })}
              />
            </section>
          )}

          {data.unreadable.length === 0 ? null : (
            <section className="sheet__block" id="design-legible">
              <Legible
                findings={data.unreadable}
                fixing={data.fixing}
                showMe={data.showMe}
                onFix={onFixColour}
              />
            </section>
          )}

          <section className="sheet__block sheet__block--wide" id="design-widths">
            <h2 className="sheet__blocktitle">{SAYS.parts.widths}</h2>
            <Responsive
              looks={data.looks}
              says={data.looksSay}
              busy={data.checkingWidths}
              onCheck={onCheckWidths}
              workingAt={data.workingAt}
              onWorkAt={onWorkAt}
            />
          </section>

          {data.inStep === null ? null : (
            <section className="sheet__block" id="design-figma">
              <InStep
                state={data.inStep}
                busy={data.lookingAtFigma}
                detail={data.showMe}
                onFollow={onFollowDesign}
                onLookAgain={onLookAgain}
                onBuildIn={onBuildIn}
                onCaughtUp={onCaughtUp}
                onStop={onStopFollowing}
              />
            </section>
          )}

          {data.inStep === null ? (
            <section className="sheet__block" id="design-figma">
              <h2 className="sheet__blocktitle">{SAYS.parts.figma}</h2>
              <p className="sheet__nothing">{SAYS.noFigma}</p>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
