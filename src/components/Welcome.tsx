import './Welcome.css';

/** Three sentences somebody would actually type.
 *
 * Not "try asking me to make a button". They are the size and shape of a real
 * first request — a frame to build, a section to fix, a page to check — because
 * the job of an example is to show the register you can talk in, and an example
 * pitched below the reader is the visual form of condescension.
 *
 * Exported so the gallery shows the same three the app does. */
export const firstMoves: readonly string[] = [
  'Build this Figma frame as a real page, keeping our spacing scale',
  'Make the pricing section work properly on a phone',
  'Find everything on the homepage that sits off the grid',
];

type Props = {
  /** Put one of the examples in the box, ready to be edited and sent. It is
   *  never sent on the user's behalf: an example is a starting point, and a
   *  click that spends money on a sentence somebody did not write is the kind
   *  of surprise this product exists to not have. */
  onUse?: (text: string) => void;
  /** Overridable so the gallery can show a long one and a short one. */
  examples?: readonly string[];
};

/**
 * The first screen anybody sees.
 *
 * The rule from notes/strategy/UI-DESIGN.md is one sentence and one control, not
 * an illustration of a rocket — and this stays inside it: the control is the
 * composer under this block, and everything here is one sentence plus three
 * examples of what that sentence could be.
 *
 * ## Why examples and not a tour
 *
 * A designer opening this has one real question — *what can I say to it?* — and
 * the honest answer is a few things somebody else said. Three rows of real
 * sentences answer it in the time it takes to read them, teach the register
 * without a word of instruction, and are gone the moment the conversation
 * starts. A tour would answer the same question in four modal steps and be
 * remembered as an obstacle.
 *
 * ## What is deliberately not here
 *
 * No cards — a three-card feature grid is template grammar and this is not a
 * marketing page. No dashed drop zone: the composer under this block already
 * turns into the target when something is dragged over it, and drawing a second
 * dashed rectangle to announce a rectangle is how an interface says it does not
 * trust its own affordances. And no motion at all. This is the screen every
 * launch begins on, which by the frequency rule is exactly the screen that
 * should be still.
 */
export default function Welcome({ onUse, examples = firstMoves }: Props) {
  return (
    <div className="welcome">
      <h1 className="welcome__title">What do you want to make?</h1>
      <p className="welcome__sub">
        Describe it in a sentence. If you already have the design, bring that instead.
      </p>

      {examples.length === 0 ? null : (
        <ul className="welcome__list" aria-label="Some ways to start">
          {examples.map((example) => (
            <li key={example}>
              <button
                type="button"
                className="welcome__example"
                onClick={() => onUse?.(example)}
                title="Put this in the box"
              >
                <span className="welcome__exampletext">{example}</span>
                <svg
                  className="welcome__chevron"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4.5 2.5 8 6l-3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="welcome__drop">
        Or drop a Figma file, a screenshot or a photo of a sketch straight onto the box below.
      </p>
    </div>
  );
}
