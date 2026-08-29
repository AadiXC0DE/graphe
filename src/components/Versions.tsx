import { useEffect, useMemo, useRef, useState } from 'react';
import type { PutBack, SavedVersion } from '../lib/ipc';
import { FIRST_GLANCE, groupVersions, type VersionGroup } from '../history/grouping';
import { behind } from '../lib/showme';
import { ago, agoInSentence, clockTime } from '../lib/when';
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
  /** What each version looked like, by id. Data URIs — the window draws no
   *  file paths. Without them the rail still works; it just has fewer pictures
   *  and nothing to compare. */
  pictures?: Readonly<Record<string, string>>;
  /** The ones somebody chose to keep. Left off, the rail remembers them for as
   *  long as it is on screen. */
  kept?: readonly string[];
  onKeep?: (versionId: string, keep: boolean) => void;
  /** Somebody above is already saying what this is, so it does not say it
   *  again. */
  bare?: boolean;
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
 * the entire feature. So hovering a card changes one background colour over 120ms
 * and moves nothing. The rail itself fades in once, and after that the only thing
 * that ever animates is the undo strip arriving.
 *
 * ## Pictures, a day at a time
 *
 * A designer looking for the moment before it went wrong is looking for it by
 * eye, so the picture is the object and the words are the caption. They come in
 * day-sized groups — today open, older days folded — and each day shows a
 * handful before offering the rest, because a rail that draws two hundred cards
 * is a rail nobody reaches the bottom of.
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
  pictures,
  kept,
  onKeep,
  bare,
}: Props) {
  /** The card whose name is being written. Clicking a card means "this one",
   *  and naming is the one thing there is to do with that. */
  const [naming, setNaming] = useState<string | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  /** Groups somebody has folded or unfolded by hand, over the default. */
  const [folding, setFolding] = useState<Readonly<Record<string, boolean>>>({});
  /** Days showing everything rather than the first handful. */
  const [showingAll, setShowingAll] = useState<Readonly<Record<string, boolean>>>({});
  /** Where kept lives until somebody wires it up to the project itself. */
  const [keptHere, setKeptHere] = useState<readonly string[]>([]);

  const keptIds = kept ?? keptHere;
  const beingNamed = naming === null ? null : (versions.find((one) => one.id === naming) ?? null);
  const canCompare = versions.some((one) => Boolean(pictures?.[one.id]));

  const { groups, folded } = useMemo(
    () =>
      groupVersions(versions, {
        now: Date.now(),
        kept: keptIds,
        onlyChanged,
        pictureOf: (one) => pictures?.[one.id],
        // A moment somebody named, and the one on screen, are worth showing
        // whether or not a pixel moved.
        spare: (one) => one.current || one.named,
      }),
    [versions, keptIds, onlyChanged, pictures],
  );

  function keep(version: SavedVersion) {
    const already = keptIds.includes(version.id);
    setKeptHere((was) =>
      already ? was.filter((one) => one !== version.id) : [...was, version.id],
    );
    onKeep?.(version.id, !already);
  }

  return (
    <aside className="rail" aria-label="Versions of your project">
      {bare === true ? null : <h2 className="rail__title">Commits</h2>}

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

      <div className="rail__list">
        {/* Only offered once there are pictures to compare — a switch that can
            never change anything is worse than no switch. */}
        {canCompare ? (
          <div className="rail__band">
            <button
              type="button"
              className="rail__only"
              aria-pressed={onlyChanged}
              title="When on, moments where the picture did not change are hidden, usually a save with nothing visible to show."
              onClick={() => setOnlyChanged(!onlyChanged)}
            >
              <span className="rail__onlydot" aria-hidden="true" />
              Hide look-alikes
            </button>
            {onlyChanged && folded > 0 ? (
              <span className="rail__folded" title="Moments where the picture did not change, usually a save with no visible difference.">
                {folded} {folded === 1 ? 'looked the same' : 'looked the same'}
              </span>
            ) : null}
          </div>
        ) : null}

        {groups.map((group) => {
          const open = folding[group.key] ?? group.openByDefault;
          const all = showingAll[group.key] === true;
          const showing = all ? group.items : group.items.slice(0, FIRST_GLANCE);
          const rest = group.items.length - showing.length;

          return (
            <section
              key={group.key}
              className={`daygroup ${group.kind === 'kept' ? 'daygroup--kept' : ''}`}
            >
              <h3 className="daygroup__head">
                <button
                  type="button"
                  className="daygroup__fold"
                  aria-expanded={open}
                  onClick={() => setFolding({ ...folding, [group.key]: !open })}
                >
                  <span className="daygroup__chev" aria-hidden="true">
                    ›
                  </span>
                  <span className="daygroup__label">{group.label}</span>
                  <span className="daygroup__count">{group.items.length}</span>
                </button>
              </h3>

              {open ? (
                <>
                  <ul className="moments">
                    {showing.map((version) => (
                      <Moment
                        key={version.id}
                        version={version}
                        picture={pictures?.[version.id]}
                        /* Inside a day the header says which day, so the time
                           is enough. A kept version could be from any of them. */
                        when={
                          group.kind === 'kept'
                            ? ago(version.at)
                            : clockTime(new Date(version.at))
                        }
                        kept={keptIds.includes(version.id)}
                        busy={busy}
                        naming={naming === version.id}
                        onOpen={() => setNaming(naming === version.id ? null : version.id)}
                        onKeep={() => keep(version)}
                        onPutBack={() => onPutBack(version.id)}
                      />
                    ))}

                    {beingNamed !== null && showing.some((one) => one.id === beingNamed.id) ? (
                      <li className="moments__naming">
                        <NameField
                          /* A name they already chose comes back for editing; a
                             title we wrote does not, because it is ours and they
                             are replacing it. */
                          startingWith={beingNamed.named ? beingNamed.title : ''}
                          onDone={(name) => {
                            if (name.trim() !== '') onName(beingNamed.id, name);
                            setNaming(null);
                          }}
                          onCancel={() => setNaming(null)}
                        />
                      </li>
                    ) : null}
                  </ul>

                  {rest > 0 ? (
                    <button
                      type="button"
                      className="daygroup__more"
                      onClick={() => setShowingAll({ ...showingAll, [group.key]: true })}
                    >
                      {theRest(group, rest)}
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          );
        })}
      </div>

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

/** "Earlier today", said about whichever day this is. */
function theRest<T>(group: VersionGroup<T>, rest: number): string {
  if (group.kind === 'kept') return `${rest} more kept`;
  if (group.label === 'Today') return `Earlier today (${rest})`;
  if (group.label === 'Yesterday') return `Earlier yesterday (${rest})`;
  return `Earlier on ${group.label} (${rest})`;
}

/**
 * One moment, as a picture.
 *
 * The card is the picture: everything else is a caption under it. Keeping is a
 * mark in the corner of the picture rather than a menu item, because the thing
 * being kept is the thing you are looking at. It is small, but the target around
 * it is not — see the note in the stylesheet.
 */
function Moment({
  version,
  picture,
  when,
  kept,
  busy,
  naming,
  onOpen,
  onKeep,
  onPutBack,
}: {
  version: SavedVersion;
  picture?: string;
  when: string;
  kept: boolean;
  busy?: boolean;
  naming: boolean;
  onOpen: () => void;
  onKeep: () => void;
  onPutBack: () => void;
}) {
  const marks = [
    version.current ? 'moment--current' : '',
    kept ? 'moment--kept' : '',
    naming ? 'moment--naming' : '',
  ].join(' ');

  return (
    <li className={`moment ${marks}`}>
      <button
        type="button"
        className="moment__open"
        onClick={onOpen}
        aria-current={version.current ? 'true' : undefined}
      >
        <span className="moment__still">
          {picture ? (
            // No alt: the title sits right under it, and saying it twice makes
            // a screen reader read every card in the rail twice.
            <img className="moment__shot" src={picture} alt="" />
          ) : (
            <span className="moment__words">{version.title}</span>
          )}
        </span>

        <span className="moment__caption">
          {picture ? <span className="moment__title">{version.title}</span> : null}
          <span className="moment__when">
            <span className="moment__time">{when}</span>
            {version.current ? <span className="moment__badge">On screen</span> : null}
          </span>
        </span>
      </button>

      <button
        type="button"
        className="moment__keep"
        aria-pressed={kept}
        aria-label={kept ? `Stop keeping: ${version.title}` : `Keep: ${version.title}`}
        title={kept ? 'Kept. Click to let it go' : 'Keep this one at the top'}
        onClick={onKeep}
      >
        {/* A five-point star is top-heavy: its filled mass sits below its
            bounding-box centre, so a box-centred star reads low. The path is
            raised until its area-centroid lands on the viewBox centre. */}
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M8 1.8l1.56 4.06 4.34.22-3.38 2.74 1.12 4.2L8 10.65l-3.64 2.37 1.12-4.2-3.38-2.74 4.34-.22z"
            fill={kept ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {version.current ? null : (
        <button
          type="button"
          className="moment__back"
          onClick={onPutBack}
          disabled={busy}
          aria-label={`Put back: ${version.title}`}
        >
          Put back
        </button>
      )}
    </li>
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
        {/* "Save", not "Keep": keeping a version is now its own thing, and one
            word doing two jobs in one panel is one job too many. */}
        <button type="submit" className="naming__save" disabled={name.trim() === ''}>
          Save
        </button>
      </div>
    </form>
  );
}
