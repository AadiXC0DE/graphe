import { useState } from 'react';
import { type Advice, advice } from '../lib/describe';
import './ActivityLine.css';

export type ActivityState = 'running' | 'done' | 'failed' | 'interrupted';

/** Past this many characters a step's detail is more than the two lines it
 *  draws at rest, so the row offers the rest. The advisor's row measures the
 *  same way, for the same reason. */
const A_GLANCE_AND_NO_MORE = 180;

type Props = {
  state: ActivityState;
  /** Plain language, in the user's terms: "Reading your Figma file". Never a
   *  tool name, never "Working…" on its own. */
  label: string;
  /** Optional second half of the same thought: "12 frames, 3 with variants". */
  detail?: string;
  /** How long it took, said the way a person would say it: "4s", "under a minute". */
  meta?: string;
  /**
   * The real thing behind this step — the command, the path, the operation —
   * shown only when "Show me" is on (BACKLOG D1, src/lib/showme.ts).
   *
   * Deliberately the last thing in the line and the quietest: it hangs under a
   * sentence that already said what happened, and it never replaces it. The
   * moment the machinery becomes the primary surface, this stops being an
   * escape hatch and starts being the product.
   */
  real?: string;
  /**
   * Lead with the machinery rather than with the plain sentence.
   *
   * Both audiences get the same row shape; which of the two texts is on it is
   * the difference. With "Show me" on, the command is what somebody is reading
   * for and the sentence becomes the tooltip, rather than the command hanging
   * as a third line under a sentence that already said it.
   */
  lead?: boolean;
};

/** One thing the agent did, as a read-only feed item.
 *
 * Never a decision: no checkbox, no affordance suggesting the user is being
 * asked to approve anything. Confirmations are a different component with a
 * different shape, and blurring the two is how people learn to click without
 * reading. The one press here only shows the rest of what the advisor said.
 *
 * The running state pairs its spinner with a sentence, always — "Working…" is an
 * apology, "Reading your Figma file" is information (notes/strategy/UI-DESIGN.md). The
 * state is carried by icon shape as well as colour, so nothing here depends on
 * colour alone. */
export default function ActivityLine({ state, label, detail, meta, real, lead = false }: Props) {
  const [open, setOpen] = useState(false);
  const machinery = lead && real !== undefined && real !== '';
  /* The one line in the feed a second model wrote. It is drawn as what it is
     rather than as another grey particular, because nobody asked for it. */
  const said = advice(label, detail);
  /* What is cut off at two lines: a long output replayed from a saved
     conversation, a helper's paragraph. The size of it is said beside the
     press rather than left to be discovered. */
  const clipped = detail !== undefined && (detail.length > A_GLANCE_AND_NO_MORE || detail.includes('\n'));
  const far = detail === undefined ? 0 : detail.length - A_GLANCE_AND_NO_MORE;

  return (
    <div className={`activity activity--${state}`} title={machinery ? label : undefined}>
      {/* 1.4 on a 14-unit box, which renders as a 1.4px stroke — the same
          rendered weight as the mark on an error card, and one step above the
          1.2 the 11–13px glyphs carry. These two were at 1.6, the heaviest
          stroke anywhere in the app, on the icons it repeats most often. The
          rule the rest of the kit follows is that the drawn weight scales with
          the glyph: the number in the file is the same, the rendered line
          differs because the box does. */}
      <span className="activity__icon" aria-hidden="true">
        {state === 'running' ? <span className="activity__spinner" /> : null}
        {state === 'done' ? (
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
            <path
              d="M3 7.4 5.7 10 11 4.4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {state === 'failed' ? (
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
            <path
              d="M3.9 3.9l6.2 6.2M10.1 3.9l-6.2 6.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
        {/* A bar, not a cross: a step the record never saw finish did not fail,
            it stopped where it was. */}
        {state === 'interrupted' ? (
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
            <path d="M3.5 7h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ) : null}
      </span>

      <span className="activity__text">
        {machinery ? (
          <code className="activity__lead">{real}</code>
        ) : (
          <span className="activity__label">{label}</span>
        )}
        {said !== null ? (
          <Said said={said} />
        ) : detail ? (
          <>
            <span className={`activity__detail ${open ? 'activity__detail--open' : ''}`}>
              {detail}
            </span>
            {clipped ? (
              <button
                type="button"
                className="activity__expand"
                aria-expanded={open}
                onClick={() => setOpen((was) => !was)}
              >
                {open ? 'Show less' : 'Show more'}
                {open || far <= 0 ? null : (
                  <span className="activity__count">{`${String(far)} more characters`}</span>
                )}
              </button>
            ) : null}
          </>
        ) : null}
        {real !== undefined && real !== '' && !machinery ? (
          <code className="activity__real">{real}</code>
        ) : null}
      </span>

      {/* A word, not a card. A step that failed is a step that failed; painting
          the conversation for it is the app blaming the work. A step that was
          interrupted is neither: the record simply stops before the result. */}
      {state === 'failed' ? <span className="activity__failed">Did not work</span> : null}
      {state === 'interrupted' ? <span className="activity__interrupted">Never finished</span> : null}
      {meta ? <span className="activity__meta">{meta}</span> : null}

      <span className="activity__sr">
        {state === 'running'
          ? 'in progress'
          : state === 'done'
            ? 'done'
            : state === 'interrupted'
              ? 'never finished'
              : 'did not work'}
      </span>
    </div>
  );
}

/** What the advisor said, at reading weight, with the model that said it.
 *
 * The only press on an activity line, and it decides nothing: three lines is
 * enough to know whether the rest is worth reading, and a second opinion cut at
 * a hundred characters was a line nobody could act on. */
function Said({ said }: { said: Advice }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="activity__advice">
      {said.model === null ? null : <span className="activity__advisor">{said.model}</span>}
      <span className={`activity__answer ${open || !said.long ? '' : 'activity__answer--cut'}`}>
        {said.answer}
      </span>
      {said.long ? (
        <button
          type="button"
          className="activity__expand"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </span>
  );
}
