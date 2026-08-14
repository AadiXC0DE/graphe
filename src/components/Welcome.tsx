import { STARTERS, type Recipe } from '../lib/recipes';
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
  'Build this Figma frame with the components we already have',
  'Make this page feel more like the reference, then show me what changed',
  'Send a helper into every page, tell me what breaks, then fix the worst three',
  'Find everywhere we rebuilt something this project already has',
];

type Props = {
  /** Put one of the examples in the box, ready to be edited and sent. It is
   *  never sent on the user's behalf: an example is a starting point, and a
   *  click that spends money on a sentence somebody did not write is the kind
   *  of surprise this product exists to not have. */
  onUse?: (text: string) => void;
  /** Overridable so the gallery can show a long one and a short one. */
  examples?: readonly string[];
  /** The saved starting points, ours and theirs. Left out, ours are shown. */
  recipes?: readonly Recipe[];
  /** The project this chat is starting in, so the first sentence names the
   *  folder somebody is about to work in. Null on the very first launch. */
  project?: string | null;
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
export default function Welcome({ onUse, examples = firstMoves, recipes = STARTERS, project }: Props) {
  /* Four is enough to show the range without turning the first screen into a
     catalogue. The rest remain one click away in the composer. */
  const shown = recipes.slice(0, 4);

  return (
    <div className="welcome">
      <h1 className="welcome__title">
        {project === null || project === undefined
          ? 'What do you want to make?'
          : `What do you want to make in ${project}?`}
      </h1>
      {/* The second sentence is the only instruction on the screen, and it is
          there because nothing else says what pressing a row does. Without it
          the examples are decoration and somebody has to click one to find out
          whether it costs money. */}
      <p className="welcome__sub">
        {examples.length === 0
          ? 'Describe it in a sentence.'
          : 'Describe it, start from one of these, or bring in something you are looking at.'}
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

      <div className="welcome__more">
        {/* The things people ask for again and again, as buttons. Pressing one
            fills the box rather than sending it — the same rule the examples
            above follow, for the same reason. */}
        {shown.length === 0 ? null : (
          <div className="welcome__recipes">
            <span className="welcome__recipesname">Useful starting points</span>
            <ul className="welcome__chips" aria-label="Things to ask for">
              {shown.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    className={`welcome__chip ${recipe.from === 'yours' ? 'welcome__chip--yours' : ''}`}
                    onClick={() => onUse?.(recipe.prompt)}
                    title={recipe.prompt}
                  >
                    {recipe.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="welcome__drop">
          <svg
            className="welcome__clip"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9.6 4.2 5.2 8.6a1.9 1.9 0 0 0 2.7 2.7l4.7-4.7a3.2 3.2 0 0 0-4.5-4.5L3.3 6.9a4.5 4.5 0 0 0 6.4 6.4l3.6-3.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Drop a Figma file, screenshot or sketch onto the box below.</span>
        </p>
      </div>
    </div>
  );
}
