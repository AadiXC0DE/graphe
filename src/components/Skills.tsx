import { useEffect, useMemo, useRef, useState } from 'react';
import type { Skill, Workflow } from '../lib/ipc';
import Markdown from './Markdown';
import './Sheet.css';
import './Skills.css';

type Props = {
  open: boolean;
  skills: readonly Skill[];
  /** The `/word` ways of working the project can ask for. */
  workflows?: readonly Workflow[];
  onClose: () => void;
  onRefresh: () => void;
  onOpen: (skill: Skill) => Promise<string | null>;
  /** Put `@handle ` or `/command ` in the composer, where the hand already is. */
  onUse?: (insert: string) => void;
  /** Open the skill's own instructions in the editor. */
  onOpenFile?: (skill: Skill) => void;
  /** Where somebody with no skills at all goes to get some. */
  onAddMore?: () => void;
};

export const SAYS = {
  heading: 'Skills',
  refresh: 'Refresh',
  under: 'Type @ in the conversation to use one.',
  find: 'Find a skill',
  groups: { project: 'This project', global: 'Your computer', workflows: 'Workflows' },
  use: 'Use in chat',
  run: 'Run',
  openFile: 'Open file',
  copy: 'Copy',
  copied: 'Copied',
  nothing: 'Nothing selected',
  noneFound: 'Nothing called that.',
  none: 'No skills yet.',
  noneHow:
    'Put a folder with a SKILL.md under .pi/skills in the project, or ~/.pi/skills for every project.',
  addMore: 'Add more',
} as const;

/** What one row in the library stands for. */
type Picked =
  | { kind: 'skill'; skill: Skill }
  | { kind: 'workflow'; workflow: Workflow };

function keyOf(one: Picked): string {
  return one.kind === 'skill' ? `skill:${one.skill.id}` : `workflow:${one.workflow.command}`;
}

/** The tail of a skill's path a person recognises: everything from the skills
 *  folder down. The whole path is still what Copy hands over. */
export function shortPath(path: string): string {
  const at = path.lastIndexOf('/skills/');
  return at < 0 ? path : path.slice(at + 1);
}

/**
 * A library with one action.
 *
 * Reading a skill is the smaller half of what somebody came here for; the
 * other half is using it, and that means the composer. So every row ends in
 * one press that closes this and puts the handle where the cursor was.
 */
export default function Skills({
  open,
  skills,
  workflows,
  onClose,
  onRefresh,
  onOpen,
  onUse,
  onOpenFile,
  onAddMore,
}: Props) {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setPicked(null);
    setText(null);
    setCopied(false);
  }, [open]);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (needle === '') return skills;
    return skills.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.handle}`.toLowerCase().includes(needle),
    );
  }, [skills, term]);

  const shownWorkflows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const all = workflows ?? [];
    if (needle === '') return all;
    return all.filter((one) =>
      `${one.command} ${one.name} ${one.description}`.toLowerCase().includes(needle),
    );
  }, [workflows, term]);

  const project = useMemo(() => shown.filter((one) => one.source === 'project'), [shown]);
  const global = useMemo(() => shown.filter((one) => one.source === 'global'), [shown]);

  /* One flat list under the groups, because that is what the arrow keys move
     through. */
  const rows = useMemo<readonly Picked[]>(
    () => [
      ...project.map((skill): Picked => ({ kind: 'skill', skill })),
      ...global.map((skill): Picked => ({ kind: 'skill', skill })),
      ...shownWorkflows.map((workflow): Picked => ({ kind: 'workflow', workflow })),
    ],
    [project, global, shownWorkflows],
  );

  const choose = (one: Picked): void => {
    setPicked(one);
    setCopied(false);
    if (one.kind !== 'skill') {
      setText(null);
      return;
    }
    const skill = one.skill;
    setText(null);
    setLoading(true);
    void onOpen(skill).then((read) => {
      setText(read);
      setLoading(false);
    });
  };

  const putInBox = (one: Picked): void => {
    onUse?.(one.kind === 'skill' ? `@${one.skill.handle}` : one.workflow.command);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
        return;
      }
      // A press already has its own Enter; only the list's needs handling.
      const on = event.target;
      const inPress = on instanceof HTMLElement && on.closest('button') !== null;
      if (event.key === 'Enter') {
        if (picked === null || inPress) return;
        event.preventDefault();
        putInBox(picked);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (rows.length === 0) return;
      event.preventDefault();
      const here = picked === null ? -1 : rows.findIndex((one) => keyOf(one) === keyOf(picked));
      const next = event.key === 'ArrowDown' ? here + 1 : here - 1;
      const going = rows[next < 0 ? rows.length - 1 : next % rows.length];
      if (going !== undefined) choose(going);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // The list and the selection are what decide a key; the two helpers are
    // rebuilt every render and would only churn the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, rows, picked]);

  if (!open) return null;

  const nothingAtAll = skills.length === 0 && (workflows ?? []).length === 0;
  const nothingFound = rows.length === 0 && !nothingAtAll;

  const group = (label: string, items: readonly Picked[]) =>
    items.length === 0 ? null : (
      <section className="skills__group">
        <h2 className="skills__grouphead">{label}</h2>
        {items.map((one) => {
          const here = picked !== null && keyOf(picked) === keyOf(one);
          const name = one.kind === 'skill' ? one.skill.name : one.workflow.name;
          const handle = one.kind === 'skill' ? `@${one.skill.handle}` : one.workflow.command;
          const says = one.kind === 'skill' ? one.skill.description : one.workflow.description;
          return (
            <button
              key={keyOf(one)}
              type="button"
              className={`skills__row ${here ? 'skills__row--here' : ''}`}
              aria-current={here}
              onClick={() => choose(one)}
            >
              <span className="skills__rowtop">
                <strong>{name}</strong>
                <code>{handle}</code>
              </span>
              <span className="skills__rowsays">{says}</span>
            </button>
          );
        })}
      </section>
    );

  return (
    <section className="skills" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="sheet__from">{SAYS.under}</p>
        </div>
        <div className="sheet__chips" />
        <button
          type="button"
          className="skills__icon"
          title={SAYS.refresh}
          aria-label={SAYS.refresh}
          onClick={onRefresh}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button type="button" className="sheet__close" onClick={onClose}>
          Close
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="skills__body">
        <aside className="skills__library scroll--auto">
          <input
            ref={field}
            className="skills__find"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={SAYS.find}
            autoFocus
            aria-label={SAYS.find}
          />
          {nothingAtAll ? (
            <div className="skills__none">
              <p>{SAYS.none}</p>
              <p>{SAYS.noneHow}</p>
              {onAddMore === undefined ? null : (
                <button type="button" className="skills__addmore" onClick={onAddMore}>
                  {SAYS.addMore}
                </button>
              )}
            </div>
          ) : nothingFound ? (
            <p className="skills__none">{SAYS.noneFound}</p>
          ) : (
            <>
              {group(SAYS.groups.project, rows.filter((one) => one.kind === 'skill' && one.skill.source === 'project'))}
              {group(SAYS.groups.global, rows.filter((one) => one.kind === 'skill' && one.skill.source === 'global'))}
              {group(SAYS.groups.workflows, rows.filter((one) => one.kind === 'workflow'))}
            </>
          )}
        </aside>

        <article className="skills__detail scroll--auto">
          {picked === null ? (
            <p className="skills__blank">{SAYS.nothing}</p>
          ) : picked.kind === 'workflow' ? (
            <>
              <h2 className="skills__name">{picked.workflow.name}</h2>
              <p className="skills__path">
                <code>{picked.workflow.command}</code>
              </p>
              <div className="skills__presses">
                <button type="button" className="skills__use" onClick={() => putInBox(picked)}>
                  {SAYS.run}
                </button>
              </div>
              <div className="sheet__block skills__says">
                <p>{picked.workflow.description}</p>
              </div>
            </>
          ) : (
            <>
              <h2 className="skills__name">{picked.skill.name}</h2>
              <p className="skills__path">
                <span>
                  {picked.skill.source === 'project' ? SAYS.groups.project : SAYS.groups.global} ·{' '}
                </span>
                <code>{shortPath(picked.skill.path)}</code>
                <button
                  type="button"
                  className="skills__copy"
                  onClick={() => {
                    const path = picked.skill.path;
                    void navigator.clipboard.writeText(path).then(() => setCopied(true));
                  }}
                >
                  {copied ? SAYS.copied : SAYS.copy}
                </button>
              </p>
              <div className="skills__presses">
                <button type="button" className="skills__use" onClick={() => putInBox(picked)}>
                  {SAYS.use}
                </button>
                {onOpenFile === undefined ? null : (
                  <button
                    type="button"
                    className="skills__second"
                    onClick={() => onOpenFile(picked.skill)}
                  >
                    {SAYS.openFile}
                  </button>
                )}
              </div>
              {loading ? (
                <p className="skills__reading">Opening its instructions…</p>
              ) : text === null ? (
                <p className="skills__reading">This skill could not be read.</p>
              ) : (
                <div className="sheet__block skills__says">
                  <Markdown text={text} />
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
