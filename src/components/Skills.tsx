import { useEffect, useMemo, useState } from 'react';
import type { Skill, Workflow } from '../lib/ipc';
import Clipped, { howMuch } from './Clipped';
import './Skills.css';

type Props = {
  open: boolean;
  skills: readonly Skill[];
  /** The `/word` ways of working the project can ask for. */
  workflows?: readonly Workflow[];
  onClose: () => void;
  onRefresh: () => void;
  onOpen: (skill: Skill) => Promise<string | null>;
};

/** A small library, not a settings maze. Its job is to answer "what can I
 * ask for?" and to make the exact instruction file legible before use. */
export default function Skills({ open, skills, workflows, onClose, onRefresh, onOpen }: Props) {
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Skill | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTerm('');
    setSelected(null);
    setText(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (needle === '') return skills;
    return skills.filter((skill) => `${skill.name} ${skill.description} ${skill.handle}`.toLowerCase().includes(needle));
  }, [skills, term]);

  const shownWorkflows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (needle === '') return workflows ?? [];
    return (workflows ?? []).filter((one) =>
      `${one.command} ${one.name} ${one.description}`.toLowerCase().includes(needle),
    );
  }, [workflows, term]);


  const choose = async (skill: Skill) => {
    setSelected(skill);
    setText(null);
    setLoading(true);
    setText(await onOpen(skill));
    setLoading(false);
  };

  if (!open) return null;
  const global = shown.filter((skill) => skill.source === 'global');
  const project = shown.filter((skill) => skill.source === 'project');
  const rows = (items: readonly Skill[], label: string, note: string) => (
    <section className="skills__group">
      <div className="skills__grouphead"><span>{label}</span><small>{note}</small></div>
      {items.length === 0 ? <p className="skills__empty">None here yet.</p> : items.map((skill) => (
        <button key={skill.id} type="button" className={`skills__row ${selected?.id === skill.id ? 'skills__row--selected' : ''}`} onClick={() => void choose(skill)}>
          <span className="skills__rowtop"><strong>{skill.name}</strong><code>@{skill.handle}</code></span>
          <span>{skill.description}</span>
        </button>
      ))}
    </section>
  );

  return (
    <section className="skills" aria-label="Skills library">
      <header className="skills__top">
        <div><p className="skills__eyebrow">Graphe skills</p><h1>Bring the right craft to the work.</h1><p>Type <code>@</code> to pick a skill, or <code>/</code> to run a workflow.</p></div>
        <div className="skills__actions"><button type="button" onClick={onRefresh}>Refresh</button><button type="button" className="skills__close" onClick={onClose}>Close <kbd>Esc</kbd></button></div>
      </header>
      <div className="skills__body">
        <aside className="skills__library">
          <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Find a skill" autoFocus aria-label="Find a skill" />
          {rows(project, 'This project', 'Travels with this folder')}
          {rows(global, 'Your computer', 'Available in every project')}
          <section className="skills__group">
            <div className="skills__grouphead"><span>Workflows</span><small>Runs with /</small></div>
            {shownWorkflows.length === 0 ? <p className="skills__empty">None here yet — ask the agent to make you one.</p> : shownWorkflows.map((one) => (
              <div key={one.command} className="skills__row skills__row--workflow">
                <span className="skills__rowtop"><strong>{one.command}</strong></span>
                <span>{one.description}</span>
                {one.hint === null ? null : <span className="skills__usecode">{one.command} {one.hint}</span>}
              </div>
            ))}
          </section>
        </aside>
        <article className="skills__detail">
          {selected === null ? <div className="skills__blank"><span>@</span><h2>Choose a skill to read it.</h2><p>Its instructions stay local. Selecting it in chat makes it explicit for that one request.</p></div> : <>
            <div className="skills__detailhead"><div><p className="skills__eyebrow">{selected.source === 'project' ? 'This project' : 'Your computer'}</p><h2>{selected.name}</h2><p>{selected.description}</p></div><code>@{selected.handle}</code></div>
            {loading ? (
              <p className="skills__reading">Opening its instructions…</p>
            ) : text === null ? (
              <pre>This skill could not be read.</pre>
            ) : (
              <Clipped how={howMuch(text)} label="Show all of it" height={420}>
                <pre>{text}</pre>
              </Clipped>
            )}
          </>}
        </article>
      </div>
    </section>
  );
}
