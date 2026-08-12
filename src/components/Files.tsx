import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  buildTree,
  changedOnly,
  EVERYTHING,
  expandAll,
  expandTo,
  flatten,
  saySize,
  type FileEntry,
  type Row,
  type TreeNode,
} from '../files/tree';
import './Files.css';

type Props = {
  /** Everything the project holds, with its size and whether this version
   *  touched it. */
  files: readonly FileEntry[];
  /** Which file is open, by its own path. Left off, the panel remembers. */
  selected?: string | null;
  onSelect: (path: string) => void;
  /** A file to bring into view — the folders around it open. */
  reveal?: string | null;
  /** Left off, the panel decides: on while there is something changed to show. */
  onlyChanged?: boolean;
  onOnlyChanged?: (only: boolean) => void;
  /** Include the dotted names and lock files a project keeps for itself. The
   *  big folders are never walked at all, so they are not what this reveals. */
  everything?: boolean;
  onEverything?: (everything: boolean) => void;
};

/** A file and a folder can share a path, so neither is identified by path
 *  alone. */
function idOf(node: TreeNode): string {
  return `${node.kind}:${node.path}`;
}

/**
 * Everything in this project, when somebody asks for it.
 *
 * Every other tool of this kind opens on a file tree, which is precisely what
 * makes it unusable on the first morning: a designer is shown ten thousand rows
 * of somebody else's work before one of their own. So this is not the first
 * thing on screen. It is revealed on purpose, like "Show me", and once it is
 * open it stays open for that person.
 *
 * What it can do that a file tree cannot is know what a version is. It opens
 * showing only what moved, with the rest folded away, and the toggle that
 * changes that sits in the panel's own band rather than in a settings screen.
 * Beside it is the way back to the whole project, machinery and all, for the
 * person who wants to check our working.
 */
export default function Files({
  files,
  selected,
  onSelect,
  reveal,
  onlyChanged,
  onOnlyChanged,
  everything,
  onEverything,
}: Props) {
  /** The row the keyboard is on, which is not the same as the file on screen. */
  const [active, setActive] = useState<string | null>(null);
  const [selectedHere, setSelectedHere] = useState<string | null>(null);
  /** Null until somebody presses it, so the panel can keep deciding for itself. */
  const [onlyHere, setOnlyHere] = useState<boolean | null>(null);
  const [everythingHere, setEverythingHere] = useState(false);

  const anythingChanged = useMemo(() => files.some((one) => one.changed === true), [files]);
  const only = onlyChanged ?? onlyHere ?? anythingChanged;
  const all = everything ?? everythingHere;
  const chosen = selected ?? selectedHere;

  const treeRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(files, all ? EVERYTHING : {}), [files, all]);
  const shown = useMemo(() => (only ? changedOnly(tree) : tree), [tree, only]);

  /* Open on the first paint rather than a frame later, so nothing that is about
     to be showing is briefly folded away. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
    only ? new Set(expandAll(shown)) : new Set<string>(),
  );

  const rows = useMemo(() => flatten(shown, expanded), [shown, expanded]);

  /* What changed is worth seeing without opening four folders to find it. */
  useEffect(() => {
    if (!only) return;
    setExpanded((was) => {
      const next = new Set(was);
      for (const path of expandAll(shown)) next.add(path);
      return next;
    });
  }, [only, shown]);

  useEffect(() => {
    if (reveal === null || reveal === undefined || reveal === '') return;
    setExpanded((was) => expandTo(was, reveal));
    setActive(`file:${reveal}`);
  }, [reveal]);

  /* Focus follows the keyboard, and only ever when the keyboard is already in
     here — revealing a file from elsewhere must not steal it. */
  useEffect(() => {
    if (active === null) return;
    const box = treeRef.current;
    if (box === null) return;
    const row = box.querySelector<HTMLElement>(`[data-row="${CSS.escape(active)}"]`);
    if (row === null) return;
    if (box.contains(document.activeElement)) row.focus();
    else row.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const activeId = rows.some((row) => idOf(row.node) === active)
    ? active
    : (rows[0] === undefined ? null : idOf(rows[0].node));

  function fold(path: string, open: boolean) {
    setExpanded((was) => {
      const next = new Set(was);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  function choose(row: Row) {
    setActive(idOf(row.node));
    if (row.node.kind === 'folder') {
      fold(row.node.path, !row.open);
      return;
    }
    setSelectedHere(row.node.path);
    onSelect(row.node.path);
  }

  function setOnly(next: boolean) {
    setOnlyHere(next);
    onOnlyChanged?.(next);
  }

  function setAll(next: boolean) {
    setEverythingHere(next);
    onEverything?.(next);
  }

  /* The tree keys, as everybody who has ever used one expects them: right opens
     and descends, left closes and climbs, up and down move. */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = rows.findIndex((row) => idOf(row.node) === activeId);
    const row = rows[at === -1 ? 0 : at];
    if (row === undefined) return;
    const here = at === -1 ? 0 : at;

    const goTo = (index: number) => {
      const next = rows[index];
      if (next === undefined) return;
      event.preventDefault();
      setActive(idOf(next.node));
    };

    switch (event.key) {
      case 'ArrowDown':
        goTo(here + 1);
        return;
      case 'ArrowUp':
        goTo(here - 1);
        return;
      case 'Home':
        goTo(0);
        return;
      case 'End':
        goTo(rows.length - 1);
        return;
      case 'ArrowRight':
        if (row.node.kind !== 'folder') return;
        event.preventDefault();
        if (row.open) goTo(here + 1);
        else fold(row.node.path, true);
        return;
      case 'ArrowLeft': {
        event.preventDefault();
        if (row.node.kind === 'folder' && row.open) {
          fold(row.node.path, false);
          return;
        }
        for (let i = here - 1; i >= 0; i -= 1) {
          const above = rows[i];
          if (above !== undefined && above.level === row.level - 1) {
            setActive(idOf(above.node));
            return;
          }
        }
        return;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(row);
        return;
      default:
    }
  }

  const nothing = files.length === 0;

  return (
    <section className="files" aria-label="Everything in this project">
      <div className="files__band">
        <button
          type="button"
          className="files__chip"
          aria-pressed={only}
          onClick={() => setOnly(!only)}
        >
          <span className="files__chipdot" aria-hidden="true" />
          Only what changed
        </button>
        <button
          type="button"
          className="files__chip"
          aria-pressed={all}
          onClick={() => setAll(!all)}
          title="Include the dotted names and lock files a project keeps for itself"
        >
          <span className="files__chipdot" aria-hidden="true" />
          Every file
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="files__none">
          {nothing || all
            ? 'Nothing here yet.'
            : only
              ? 'Nothing has changed in this one yet.'
              : 'Nothing here but the working files this project keeps for itself.'}
        </p>
      ) : (
        <div
          className="files__tree"
          role="tree"
          aria-label="Files and folders"
          ref={treeRef}
          onKeyDown={onKeyDown}
        >
          {rows.map((row) => {
            const node = row.node;
            const id = idOf(node);
            const folder = node.kind === 'folder';
            const open = row.open;

            return (
              <div
                key={id}
                data-row={id}
                role="treeitem"
                aria-level={row.level}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-expanded={folder ? open : undefined}
                aria-selected={!folder && node.path === chosen}
                tabIndex={id === activeId ? 0 : -1}
                className={`files__row ${!folder && node.path === chosen ? 'files__row--here' : ''}`}
                style={{ paddingInlineStart: `calc(var(--space-1) + ${node.depth} * 14px)` }}
                onClick={() => choose(row)}
                onFocus={() => setActive(id)}
                title={node.path}
              >
                <span className={`files__twist ${open ? 'files__twist--open' : ''}`} aria-hidden="true">
                  {folder ? (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path
                        d="m6 4 4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>

                <span className={`files__name ${folder ? 'files__name--folder' : ''}`}>
                  {node.name}
                </span>

                {node.changed ? (
                  <>
                    <span className="files__moved" aria-hidden="true" />
                    <span className="files__sr">changed</span>
                  </>
                ) : null}

                <span className="files__meta">
                  {node.kind === 'folder'
                    ? open || node.changedCount === 0
                      ? ''
                      : `${node.changedCount} changed`
                    : saySize(node.size)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
