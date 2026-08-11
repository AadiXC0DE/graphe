import { useEffect, useRef, useState } from 'react';
import VersionRow from './VersionRow';
import type { PutBack, SavedVersion } from '../lib/ipc';
import { behind } from '../lib/showme';
import { ago, agoInSentence } from '../lib/when';
import './Versions.css';

type Props = {
  versions: readonly SavedVersion[];
  /** The last thing put back, while the offer to undo it is still standing. */
  putBack: PutBack | null;
  onPutBack: (versionId: string) => void;
  onName: (versionId: string, name: string) => void;
  /** Stop offering the undo. The version is still there either way. */
  onDismissPutBack: () => void;
  /** True while the shell is doing one of the above. */
  busy?: boolean;
  /** Name what a version really is, when somebody has asked to be told
   *  (BACKLOG D1). One sentence at the foot of the rail rather than a line per
   *  row: the answer is the same for every row, and repeating it forty times
   *  would turn the timeline into a log. */
  showMe?: boolean;
};

/**
 * The version timeline, at last on screen.
 *
 * `Timeline` has worked and taken snapshots since the first week; nothing
 * rendered them, so the feature DIFFERENTIATORS §1 calls the thing that makes
 * everything else safe to try was invisible. This is the rail that shows it.
 *
 * ## Why it is not here at the start
 *
 * A rail listing one version is a control that teaches you nothing and takes up
 * a quarter of the window doing it. It appears the moment there is a second
 * version — the first moment "go back" means anything — and then it stays, which
 * is the progressive-disclosure rule from notes/strategy/UI-DESIGN.md applied
 * literally.
 *
 * ## Nothing here is allowed to feel heavy
 *
 * Scrubbing must feel like Figma's version history: immediate, weightless,
 * consequence-free. Any hesitation makes people afraid to explore, which defeats
 * the entire feature. So hovering a row changes one background colour over 120ms
 * and moves nothing — that is `VersionRow`'s own discipline and this file does
 * not add to it. The rail itself fades in once, and after that the only thing
 * that ever animates is the undo strip arriving.
 *
 * ## Going back is not the end of the story
 *
 * Putting a project back is itself a version, so it can be undone like anything
 * else (FEATURES.md 1.4). The strip at the top says which moment you are now
 * looking at and offers to take it back — one sentence, one control, and it goes
 * away when it stops being true.
 */
export default function Versions({
  versions,
  putBack,
  onPutBack,
  onName,
  onDismissPutBack,
  busy,
  showMe,
}: Props) {
  /** The row whose name is being written. `VersionRow`'s own "open" is what
   *  selects it — there is no preview to show yet, so a click on the row means
   *  "this one", and naming is the one thing there is to do with that. */
  const [naming, setNaming] = useState<string | null>(null);
  const beingNamed = naming === null ? null : (versions.find((one) => one.id === naming) ?? null);

  return (
    <aside className="rail" aria-label="Versions of your project">
      <h2 className="rail__title">Versions</h2>

      {putBack === null ? null : (
        <div className="rail__putback" role="status">
          <p className="rail__putbacksaid">Put back to {agoInSentence(putBack.at)}</p>
          <div className="rail__putbackrow">
            <span className="rail__putbackwhat">{putBack.title}</span>
            <button
              type="button"
              className="rail__undo"
              onClick={() => {
                onDismissPutBack();
                onPutBack(putBack.undoTo);
              }}
              disabled={busy}
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {versions.length === 0 ? (
        <p className="rail__none">
          Nothing saved yet. The first time I change something I will save where
          you were, so you can always come back to it.
        </p>
      ) : null}

      <ul className="version-list rail__list">
        {versions.map((version) => (
          <VersionRow
            key={version.id}
            title={version.title}
            time={ago(version.at)}
            current={version.current}
            onOpen={() => setNaming(naming === version.id ? null : version.id)}
            onRestore={busy ? undefined : () => onPutBack(version.id)}
          />
        ))}
        {beingNamed === null ? null : (
          <li className="rail__naming">
            <NameField
              /* A name they already chose comes back for editing; a title we
                 wrote does not, because it is ours and they are replacing it. */
              startingWith={beingNamed.named ? beingNamed.title : ''}
              onDone={(name) => {
                if (name.trim() !== '') onName(beingNamed.id, name);
                setNaming(null);
              }}
              onCancel={() => setNaming(null)}
            />
          </li>
        )}
      </ul>

      {/* Folded away. Two paragraphs of explanation left open under an empty
          timeline were the loudest thing in the panel, which is the opposite of
          what a footnote is for. */}
      {showMe ? (
        <details className="rail__real">
          <summary>How versions work</summary>
          <p>{behind.versions}</p>
          <p>{behind.putBack}</p>
        </details>
      ) : null}
    </aside>
  );
}

/**
 * "before I broke the nav" — FEATURES.md 1.6.
 *
 * One field and no buttons but the one that saves. Enter keeps it, Escape drops
 * it, and moving away keeps whatever was typed rather than throwing it out —
 * losing somebody's sentence because they clicked the wrong pixel is the small
 * rudeness that stops people naming anything ever again.
 */
function NameField({
  startingWith,
  onDone,
  onCancel,
}: {
  startingWith: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(startingWith);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  return (
    <form
      className="naming"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(name);
      }}
    >
      <label className="naming__label" htmlFor="version-name">
        Call this something
      </label>
      <div className="naming__row">
        <input
          id="version-name"
          ref={field}
          className="naming__field"
          value={name}
          placeholder="before I broke the nav"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <button type="submit" className="naming__save" disabled={name.trim() === ''}>
          Keep
        </button>
      </div>
    </form>
  );
}
