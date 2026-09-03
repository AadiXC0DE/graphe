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
import './DesignView.css';

/** Which band somebody came here for. */
export type DesignPart = 'styles' | 'motion' | 'drift' | 'legible' | 'widths' | 'figma';

export const SAYS = {
  heading: 'Design',
  save: 'Save',
  saveMany: (count: number): string =>
    count === 1 ? 'Save 1 change' : `Save ${String(count)} changes`,
  discard: 'Discard',
  close: 'Close',
  openFile: 'Open in editor',
  fromNothing: 'This project has no stylesheet I can read yet.',
  noFigma: 'Nothing is being followed here yet.',
  noDrift: 'Every value here is one of your own.',
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
  /** Which token each unreadable pairing is about, so a row can say where. */
  repairs?: ReadonlyMap<string, string>;
  /** Values moved but not yet saved, so each can be put back on its own. */
  nudged?: readonly string[];
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
  /** How many edits are waiting to be saved. Zero is clean. */
  changes: number;
  /** Saved by hand, once — the project is untouched until this. */
  onSave: () => void;
  /** Throw the held edits away without writing anything. */
  onDiscard: () => void;
  onClose: () => void;
  onNudge: (name: string, value: string) => void;
  onResetToken?: (name: string) => void;
  onNudgeMotion: (move: Movable, change: Change) => void;
  onFixColour: (finding: ReadFinding) => void;
  onUseYours?: (finding: DriftFinding) => void;
  onUseAll?: (findings: readonly DriftFinding[]) => void;
  onOpenFile?: (file: string) => void;
  onCheckWidths: () => void;
  onWorkAt: (look: Look) => void;
  onFollowDesign: (address: string) => void;
  onLookAgain: () => void;
  onBuildIn: (move: Move) => void;
  onCaughtUp: () => void;
  onStopFollowing: () => void;
};

/** How many of each band there are to see, for the rail. Null where a count
 *  would be a lie — "every width" is four pictures whether or not anybody has
 *  taken them. */
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
 * A rail down the left says what the six parts are and how much is in each, so
 * the whole of a project's visual language is one glance and any part of it is
 * one press or one number key. The parts themselves are tables and lists of
 * places, because that is what a design system and a list of faults are.
 *
 * It sits over the conversation rather than beside it: this is somewhere you go
 * for a minute and then leave, and Esc leaves.
 */
export default function DesignView({
  data,
  at,
  changes,
  onSave,
  onDiscard,
  onClose,
  onNudge,
  onResetToken,
  onNudgeMotion,
  onFixColour,
  onUseYours,
  onUseAll,
  onOpenFile,
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
  const dirty = changes > 0;
  const file = data.styles?.file ?? '';

  /* Where each unreadable pairing is written. The finding knows which value it
     is about; the value knows its line. */
  const places = useMemo(() => {
    const byName = new Map((data.styles?.tokens ?? []).map((token) => [token.name, token.line]));
    const found = new Map<string, string>();
    for (const [id, name] of data.repairs ?? []) {
      const line = byName.get(name);
      if (line === undefined) continue;
      found.set(id, file === '' ? `line ${String(line)}` : `${file}:${String(line)}`);
    }
    return found;
  }, [data.repairs, data.styles?.tokens, file]);

  const goTo = (part: DesignPart): void => {
    setHere(part);
    body.current
      ?.querySelector(`#design-${part}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  useEffect(() => {
    shut.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      /* The rail's numbers. Never while somebody is typing a value into it. */
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const nth = Number(event.key);
      if (!Number.isInteger(nth) || nth < 1 || nth > ORDER.length) return;
      const part = ORDER[nth - 1];
      if (part === undefined) return;
      event.preventDefault();
      goTo(part);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /* Landing on the part somebody asked for. Instant, because it is where the
     view opens rather than a journey across it. */
  useEffect(() => {
    if (at === 'styles') return;
    body.current?.querySelector(`#design-${at}`)?.scrollIntoView({ block: 'start' });
    setHere(at);
  }, [at]);

  return (
    <section className="sheet" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
        </div>

        <div className="design__actions">
          {dirty ? (
            <button type="button" className="sheet__discard" onClick={onDiscard}>
              {SAYS.discard}
            </button>
          ) : null}
          <button
            type="button"
            className={`sheet__savebtn${dirty ? '' : ' sheet__savebtn--quiet'}`}
            onClick={onSave}
            disabled={!dirty || data.busy}
          >
            {dirty ? SAYS.saveMany(changes) : SAYS.save}
          </button>
        </div>

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body scroll--auto" ref={body}>
        <div className="design">
          <nav className="design__rail" aria-label="What to look at">
            <ul className="design__parts">
              {ORDER.map((part, nth) => {
                const count = countOf(part, data);
                return (
                  <li key={part}>
                    <button
                      type="button"
                      className={`design__part${here === part ? ' design__part--here' : ''}`}
                      aria-current={here === part ? 'true' : undefined}
                      onClick={() => goTo(part)}
                    >
                      <span className="design__partname">{SAYS.parts[part]}</span>
                      <span className="design__partcount">{count === null ? '' : count}</span>
                      <kbd className="design__partkey">{nth + 1}</kbd>
                    </button>
                  </li>
                );
              })}
            </ul>

            {file === '' ? null : (
              <div className="design__source">
                <code className="design__path" title={file}>
                  {file}
                </code>
                {onOpenFile === undefined ? null : (
                  <button
                    type="button"
                    className="design__open"
                    onClick={() => onOpenFile(file)}
                  >
                    {SAYS.openFile}
                  </button>
                )}
              </div>
            )}
          </nav>

          <div className="design__bands">
            <section className="design__band" id="design-styles">
              <h2 className="sheet__blocktitle">{SAYS.parts.styles}</h2>
              {data.styles === null ? (
                <p className="sheet__nothing">{SAYS.fromNothing}</p>
              ) : (
                <Styles
                  tokens={data.styles.tokens}
                  file={data.styles.file}
                  text={data.styles.text}
                  onNudge={onNudge}
                  {...(onResetToken === undefined ? {} : { onReset: onResetToken })}
                  {...(data.nudged === undefined ? {} : { nudged: data.nudged })}
                  busy={data.busy}
                />
              )}
            </section>

            <section className="design__band" id="design-motion">
              <h2 className="sheet__blocktitle">{SAYS.parts.motion}</h2>
              {data.motion === null ? (
                <p className="sheet__nothing">{MOTION_NONE}</p>
              ) : (
                <Motion
                  motion={data.motion}
                  file={file}
                  onNudge={onNudgeMotion}
                  busy={data.busy}
                />
              )}
            </section>

            <section className="design__band" id="design-drift">
              {data.drifted.length === 0 ? (
                <>
                  <h2 className="sheet__blocktitle">{SAYS.parts.drift}</h2>
                  <p className="sheet__nothing">{SAYS.noDrift}</p>
                </>
              ) : (
                <Drift
                  findings={data.drifted}
                  where={file}
                  detail={data.showMe}
                  {...(onUseYours === undefined ? {} : { onUse: onUseYours })}
                  {...(onUseAll === undefined ? {} : { onUseAll })}
                />
              )}
            </section>

            <section className="design__band" id="design-legible">
              <Legible
                findings={data.unreadable}
                fixing={data.fixing}
                at={places}
                showMe={data.showMe}
                onFix={onFixColour}
                onFixAll={(findings) => {
                  for (const finding of findings) onFixColour(finding);
                }}
              />
            </section>

            <section className="design__band" id="design-widths">
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

            <section className="design__band" id="design-figma">
              {data.inStep === null ? (
                <>
                  <h2 className="sheet__blocktitle">{SAYS.parts.figma}</h2>
                  <p className="sheet__nothing">{SAYS.noFigma}</p>
                </>
              ) : (
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
              )}
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
