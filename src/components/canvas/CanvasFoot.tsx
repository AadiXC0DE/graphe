/** How the run is going, and how it went.
 *
 * A flow that just stops leaves you reading cards to work out what it did. This
 * says it in one line — what it is doing now, or whole or cut short, how much of
 * it ran, what the last thing said was — and puts the conversation one press
 * away.
 *
 * The live region is here because this is the only part of the canvas that
 * changes without anybody pressing anything, and it announces exactly the
 * sentence the band draws. Two expressions for one state is how a screen reader
 * ends up being told something the screen does not say.
 */

import { useState } from 'react';
import { canvasWords, endedAs, laneFor, type Ending, type Flow, type Run } from '../../work/canvas';
import { formatMoney } from '../../cost/money';
import { ago } from '../../lib/when';

/** The band's own words, shared with the Runs menu: one name per ending. */
const words = canvasWords.ending;

export type FootProps = {
  flow: Flow;
  run: Run | null;
  /** What the turn in flight is doing this second, and whether it has stopped
   *  to ask. Without it a block that ran for twenty minutes said "Working…". */
  learning: { step: string | null; asking: boolean } | null;
  /** Where the block being worked on sits, so its lane is the one to open. */
  busy: string | null;
  onWatch: (conversation: string) => void;
  /** A worktree lane's branch, into the Review queue. */
  onReview: (branch: string) => void;
  onResume: () => void;
  onAgain: () => void;
};

/** One line each: four branches is four lines. */
function Branches({ run, onReview }: { run: Run; onReview: (branch: string) => void }) {
  const branched = run.lanes.filter((one) => one.branch !== null);
  if (branched.length === 0) return null;
  return (
    <ul className="canvas__branches">
      {branched.map((one) => (
        <li className="canvas__branch" key={one.id}>
          <span className="canvas__branchname">{one.branch}</span>
          <button type="button" className="canvas__branchopen" onClick={() => onReview(one.branch ?? '')}>
            {canvasWords.ending.review}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Earlier runs, by date, with how each ended.
 *
 * Kept rather than thrown away, because the question a second attempt answers
 * is always "what happened last time".
 */
export function Runs({
  flow,
  onWatch,
}: {
  flow: Flow;
  onWatch: ((conversation: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (flow.runs.length === 0) return null;
  return (
    <div className="canvas__runs">
      <button
        type="button" className="canvas__quietbtn" aria-expanded={open} aria-haspopup="menu"
        onClick={() => setOpen((was) => !was)}
      >
        {canvasWords.runs}
      </button>
      {!open ? null : (
        <ul className="canvas__runlist" role="menu" aria-label={canvasWords.runs}>
          {flow.runs.map((one) => {
            const settled = endedAs(flow, one);
            const word =
              settled === null
                ? canvasWords.states.running
                : one.state === 'interrupted'
                  ? words.interrupted
                  : one.state === 'failed'
                    ? words.failed
                    : settled.whole
                      ? words.finished
                      : words.stopped;
            const conversation = one.lanes.find((lane) => lane.conversationId !== null)?.conversationId ?? null;
            return (
              <li key={one.id}>
                <button
                  type="button" role="menuitem" className="canvas__runrow"
                  disabled={conversation === null || onWatch === undefined}
                  onClick={() => {
                    if (conversation !== null) onWatch?.(conversation);
                    setOpen(false);
                  }}
                >
                  <span className="canvas__runwhen">{ago(one.startedAt)}</span>
                  <span className="canvas__runword">{word}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function CanvasFoot({
  flow,
  run,
  learning,
  busy,
  onWatch,
  onReview,
  onResume,
  onAgain,
}: FootProps) {
  /* The lane the work is in, then that lane's conversation. A run in turn has
     one; the first lane with one is the fallback for a block since removed. */
  const block = flow.blocks.find((one) => one.id === busy);
  const conversation =
    run === null
      ? null
      : (run.lanes.find((one) => one.id === (block === undefined ? 'lane-0' : laneFor(flow, block)))
          ?.conversationId ??
        run.lanes.find((one) => one.conversationId !== null)?.conversationId ??
        null);
  const ending: Ending | null =
    run === null || run.state === 'running' || run.state === 'needs-you' ? null : endedAs(flow, run);
  const biding = run !== null && (run.state === 'running' || run.state === 'needs-you');
  const asking = biding && (run.state === 'needs-you' || learning?.asking === true);

  /* What the band says, once. The same value is the screen and the live region:
     a state announced differently from how it is drawn is two states. */
  const said =
    run === null
      ? canvasWords.note
      : biding
        ? asking
          ? canvasWords.asksYou
          : (learning?.step ?? canvasWords.working)
        : run.state === 'interrupted'
          ? words.interrupted
          : run.state === 'failed'
            ? words.failed
            : (ending?.whole ?? false)
              ? words.finished
              : words.stopped;

  return (
    <div className="canvas__foot">
      <div className="canvas__said">
        {run === null || !biding ? null : (
          <div className={`canvas__going ${asking ? 'canvas__going--asking' : ''}`}>
            <span
              className={`canvas__goingmark ${asking ? '' : 'canvas__goingmark--turning'}`}
              aria-hidden="true"
            />
            <span className="canvas__goingsaid">{said}</span>
            {conversation === null ? null : (
              <button type="button" className="canvas__endopen" onClick={() => onWatch(conversation)}>
                {asking ? canvasWords.answerIt : canvasWords.watch}
              </button>
            )}
          </div>
        )}

        {biding || run === null ? null : run.state === 'interrupted' ? (
          <div className="canvas__ended">
            <span className="canvas__endtext">
              <span className="canvas__endhead">
                <strong className="canvas__endword">{words.interrupted}</strong>
              </span>
            </span>
            <button type="button" className="canvas__endopen" onClick={onResume}>{words.resume}</button>
            <button type="button" className="canvas__endopen" onClick={onAgain}>{words.again}</button>
          </div>
        ) : ending === null ? null : (
          <div className={`canvas__ended ${ending.whole ? 'canvas__ended--whole' : ''}`}>
            <span className="canvas__endmark" aria-hidden="true">
              {ending.whole ? (
                <svg viewBox="0 0 14 14" width="12" height="12" fill="none">
                  <path
                    d="m3 7.4 2.8 2.8L11 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 14 14" width="12" height="12" fill="none">
                  <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              )}
            </span>

            <span className="canvas__endtext">
              <span className="canvas__endhead">
                <strong className="canvas__endword">{said}</strong>
                <span className="canvas__endcount">
                  {words.ranTo(ending.ran, ending.turns)}
                  {ending.cost === null ? '' : ` · ${formatMoney(ending.cost)}`}
                </span>
                {ending.left.length === 0 ? null : (
                  <span className="canvas__endleft">{words.left(ending.left.length)}</span>)}</span>
              {ending.last === null || ending.last.said.trim() === '' ? null : (
                <span className="canvas__endsaid">
                  <span className="canvas__endfrom">{ending.last.block.name}</span>{ending.last.said}</span>
              )}
            </span>

            {conversation === null ? null : (
              <button type="button" className="canvas__endopen" onClick={() => onWatch(conversation)}>
                {words.openThread}
              </button>
            )}
            {run === null ? null : <Branches run={run} onReview={onReview} />}
          </div>
        )}
      </div>

      {/* Always in the document, empty most of the time. A live region added at
          the same moment as its first sentence is one a screen reader has no
          reason to be listening to yet. */}
      <p className="canvas__live" role="status">{said}</p>
    </div>
  );
}
