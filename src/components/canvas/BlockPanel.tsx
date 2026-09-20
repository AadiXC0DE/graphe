/** What the block you pressed is set to, beside the block you pressed: a panel
 *  down the side of the window cost the canvas 300px it needed. */

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ASK_STARTING, canvasWords, canWaitFor, specOf, type Block, type Flow } from '../../work/canvas';
import { modelKey, type ConnectionState, type ThinkingLevel } from '../../lib/ipc';
import { byTier, tierNames } from '../../lib/modeltiers';
import { thinkingLevels } from '../../lib/thinking';
import { readDropped } from '../../lib/attachments';
import { Mark, modelWord } from './BlockCard';

/** The composer's own picker, and as many as one turn can carry. */
const ACCEPT = 'image/*,application/pdf';
const MOST = 12;

/** One thing a block carries into its turn: the shell's content id, not bytes. */
export type BlockAttachment = {
  id: string; name: string; kind: 'image' | 'document'; mimeType: string; thumb: string | null;
};

export type PanelView = 'block' | 'model' | 'after' | 'thinking';

/** One key `provider/model`, and back again. The model view's rows are keyed by
 *  the pair, so the value never has to be carried in a second state. */
const keyOf = (one: { providerId: string; modelId: string }): string => `${one.providerId}/${one.modelId}`;
function modelFrom(key: string): { providerId: string; modelId: string } {
  const cut = key.indexOf('/');
  return { providerId: key.slice(0, cut), modelId: key.slice(cut + 1) };
}

type Offer = {
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  rates: { input: number; output: number } | null;
  thinking: readonly ThinkingLevel[];
};

/** Everything connected and usable, flattened out of the provider tree. */
function offersIn(connection: ConnectionState | null): readonly Offer[] {
  const all: Offer[] = [];
  for (const provider of connection?.providers ?? []) {
    if (!provider.connected) continue;
    for (const model of provider.models) {
      if (!model.available) continue;
      all.push({
        providerId: provider.providerId,
        providerName: provider.name,
        modelId: model.id,
        label: model.label,
        rates: model.rates,
        thinking: model.thinking ?? [],
      });
    }
  }
  return all;
}

/** One list of choices: all three of the panel's sub-views are this. */
function Choices({
  label,
  options,
  onPick,
}: {
  label: string;
  options: readonly { key: string; name: string; note: string; on: boolean; title?: string }[];
  onPick: (key: string) => void;
}) {
  return (
    <div className="canvas__imodels" role="listbox" aria-label={label}>
      {options.map((one) => (
        <button
          key={one.key}
          type="button"
          role="option"
          aria-selected={one.on}
          className={`canvas__imodel ${one.on ? 'canvas__imodel--on' : ''}`}
          {...(one.title === undefined ? {} : { title: one.title })}
          onClick={() => onPick(one.key)}
        >
          {one.name}
          {one.note === '' ? null : <span className="canvas__isays2">{one.note}</span>}
        </button>
      ))}
    </div>
  );
}

type Props = {
  block: Block;
  flow: Flow;
  connection: ConnectionState | null;
  /** How long each model takes before answering, by `provider/model`. */
  thinking?: Readonly<Record<string, ThinkingLevel>> | undefined;
  /** Nothing is written while a run is going: the shape is what is running. */
  going: boolean;
  view: PanelView;
  onView: (view: PanelView) => void;
  spot: { x: number; y: number; side: 'left' | 'right' };
  attachments: readonly BlockAttachment[];
  onAttach: (files: readonly File[]) => void;
  onDetach: (id: string) => void;
  onChange: (over: Partial<Omit<Block, 'id'>>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onClose: () => void;
};

export default function BlockPanel({
  block, flow, connection, thinking, going, view, onView, spot, attachments,
  onAttach, onDetach, onChange, onRemove, onDuplicate, onClose,
}: Props) {
  const spec = specOf(block.kind);
  const box = useRef<HTMLTextAreaElement>(null);
  const [term, setTerm] = useState('');
  const [refused, setRefused] = useState<string | null>(null);

  const offers = useMemo(() => offersIn(connection), [connection]);
  const current = offers.find(
    (one) => block.model !== null && one.modelId === block.model.modelId && one.providerId === block.model.providerId,
  );
  const looked = term.trim().toLowerCase();
  const found =
    looked === ''
      ? offers
      : offers.filter((one) => `${one.label} ${one.modelId} ${one.providerName}`.toLowerCase().includes(looked));
  /* Grouped by tier where the prices say something useful, else left flat. */
  const bands = useMemo(() => {
    const tiered = byTier(found);
    if (tiered === null) return null;
    return new Map(
      tiered.flatMap(([tier, models]) => models.map((one) => [keyOf(one), tierNames[tier].name] as const)),
    );
  }, [found]);

  /* Itself, and anything that would close a ring: the board would refuse it. */
  const could = flow.blocks.filter((one) => one.id !== block.id && canWaitFor(flow, block.id, one.id).ok);
  const waits = flow.blocks.filter((one) => block.after.includes(one.id));
  const depths = current?.thinking ?? [];
  const depth: ThinkingLevel =
    block.thinking ?? (block.model === null ? 'off' : (thinking?.[modelKey(block.model)] ?? 'off'));

  return (
    <aside
      className={`canvas__panel canvas__panel--${spot.side}`} aria-label={`${spec.name}: ${block.name}`}
      style={{ left: spot.x, top: spot.y, width: 300 } as CSSProperties}
    >
      <header className="canvas__ihead">
        {view === 'block' ? (
          <>
            <span className="canvas__imark" aria-hidden="true"><Mark kind={block.kind} /></span>
            <h2 className="canvas__iname">{spec.name}</h2>
          </>
        ) : (
          // Back to the block, from wherever the list went: one step, named.
          <button type="button" className="canvas__iback" onClick={() => onView('block')}>
            <span aria-hidden="true">‹</span> {spec.name}
          </button>
        )}
        <button type="button" className="canvas__ishut" onClick={onClose} aria-label={canvasWords.close}>
          <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
            <path d="M4.2 4.2l5.6 5.6M9.8 4.2l-5.6 5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {view === 'model' ? (
        <div className="canvas__ibody scroll--auto">
          <input
            className="canvas__isearch" value={term}
            autoFocus
            placeholder={canvasWords.everyModel} aria-label={canvasWords.everyModel}
            onChange={(event) => setTerm(event.target.value)}
          />
          <Choices
            label={canvasWords.model}
            options={[
              {
                key: '',
                name: canvasWords.whichever,
                note: canvasWords.whicheverNote(modelWord(connection?.chosen ?? null, connection)),
                on: block.model === null,
              },
              ...found.map((one) => ({
                key: keyOf(one),
                name: one.label,
                note: bands?.get(keyOf(one)) ?? (bands === null ? `${one.providerName}` : ''),
                on: block.model !== null && keyOf(block.model) === keyOf(one),
                title: `${one.providerName} · ${one.modelId}`,
              })),
            ]}
            onPick={(key) => {
              onChange({ model: key === '' ? null : modelFrom(key) });
              onView('block');
            }}
          />
          {found.length === 0 ? <p className="canvas__inone">{canvasWords.nothingYet}</p> : null}
        </div>
      ) : view === 'thinking' ? (
        <div className="canvas__ibody scroll--auto">
          <span className="canvas__ilabel">{canvasWords.thinking}</span>
          <Choices
            label={canvasWords.thinking}
            options={depths.map((level) => ({
              key: level,
              name: thinkingLevels[level].name,
              note: thinkingLevels[level].note,
              on: level === depth,
            }))}
            onPick={(key) => {
              onChange({ thinking: key as ThinkingLevel });
              onView('block');
            }}
          />
        </div>
      ) : view === 'after' ? (
        <div className="canvas__ibody scroll--auto">
          {/* Several, not one: it begins when the last of them has finished. */}
          <span className="canvas__ilabel">{canvasWords.waitsFor}</span>
          <Choices
            label={canvasWords.waitsFor}
            options={[
              { key: '', name: canvasWords.nothing, note: '', on: block.after.length === 0 },
              ...could.map((one) => ({
                key: one.id,
                name: one.name,
                note: one.says.trim() === '' ? specOf(one.kind).note : (one.says.trim().split('\n')[0] ?? ''),
                on: block.after.includes(one.id),
              })),
            ]}
            onPick={(key) =>
              onChange({
                after:
                  key === ''
                    ? []
                    : block.after.includes(key)
                      ? block.after.filter((was) => was !== key)
                      : [...block.after, key],
              })
            }
          />
        </div>
      ) : (
        <div className="canvas__ibody scroll--auto">
          {/* Name and what it does are the two things a person edits, so they
              are the two that come first, each with its own label. */}
          <label className="canvas__ilabel" htmlFor="canvas-block-name">Name</label>
          <input
            id="canvas-block-name" className="canvas__inamefield" value={block.name} disabled={going}
            onChange={(event) => onChange({ name: event.target.value })}
          />

          <label className="canvas__ilabel" htmlFor="canvas-block-says">{canvasWords.what}</label>
          <textarea
            id="canvas-block-says" ref={box} className="canvas__isays" rows={4} value={block.says}
            disabled={going || block.kind === 'gate'} placeholder={spec.needsWords ? spec.note : spec.says}
            onChange={(event) => onChange({ says: event.target.value })}
          />

          {/* An ask's words are the whole block, so the three are one press. */}
          {block.kind === 'ask' ? (
            <>
              <span className="canvas__ilabel" id="canvas-start-from">{canvasWords.startFrom}</span>
              <div className="canvas__starts" role="group" aria-labelledby="canvas-start-from">
                {ASK_STARTING.map((one) => (
                  <button
                    key={one.name} type="button"
                    className={`canvas__start ${block.says === one.says ? 'canvas__start--on' : ''}`}
                    aria-pressed={block.says === one.says} disabled={going}
                    onClick={() => onChange({ says: one.says })}
                  >
                    {one.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="canvas__irows">
            <button type="button" className="canvas__irow" onClick={() => onView('model')} disabled={going}>
              <span className="canvas__irowname">{canvasWords.model}</span>
              <span className="canvas__irowvalue">{current?.label ?? canvasWords.whichever}</span>
              <span className="canvas__irowmore" aria-hidden="true">›</span>
            </button>

            {depths.length > 1 ? (
              <button type="button" className="canvas__irow" onClick={() => onView('thinking')} disabled={going}>
                <span className="canvas__irowname">{canvasWords.thinking}</span>
                <span className="canvas__irowvalue">{thinkingLevels[depth].name}</span>
                <span className="canvas__irowmore" aria-hidden="true">›</span>
              </button>
            ) : null}

            <button type="button" className="canvas__irow" onClick={() => onView('after')} disabled={going}>
              <span className="canvas__irowname">{canvasWords.waitsFor}</span>
              <span className="canvas__irowvalue">
                {waits.length === 0 ? canvasWords.nothing : waits.map((one) => one.name).join(', ')}
              </span>
              <span className="canvas__irowmore" aria-hidden="true">›</span>
            </button>

            <label className="canvas__irow canvas__irow--switch">
              <span className="canvas__irowname">{canvasWords.lookFirst}</span>
              <span className="canvas__irownote">{canvasWords.lookFirstNote}</span>
              <input
                type="checkbox" className="canvas__iswitch" checked={block.lookFirst} disabled={going}
                onChange={(event) => onChange({ lookFirst: event.target.checked })}
              />
              <span className="canvas__itrack" aria-hidden="true" />
            </label>

            {/* The two kinds that go round are the two with tries to spend. */}
            {block.kind === 'checks' || block.kind === 'goal' ? (
              <label className="canvas__irow">
                <span className="canvas__irowname">{canvasWords.retries}</span>
                <input
                  className="canvas__iretry" type="number" min={0} max={12} value={block.retries}
                  disabled={going} aria-label={canvasWords.retries}
                  onChange={(event) =>
                    onChange({ retries: Math.max(0, Math.min(12, Math.floor(Number(event.target.value) || 0))) })
                  }
                />
              </label>
            ) : null}
          </div>

          <span className="canvas__ilabel">{canvasWords.attachments}</span>
          <div className="canvas__ifiles">
            {attachments.map((file) => (
              <span className={`canvas__ifile canvas__ifile--${file.kind}`} key={file.id}>
                {/* The shell's own small copy, where it made one. A row with no
                    picture is a name and a mark: an empty frame would be worse. */}
                {file.thumb !== null ? <img className="canvas__ithumb" src={file.thumb} alt="" /> : null}
                <span className="canvas__ifiletext">
                  <span className="canvas__ifilename">{file.name}</span>
                  <span className="canvas__ifilesize">{file.mimeType}</span>
                </span>
                <button
                  type="button" className="canvas__ifileoff" disabled={going}
                  aria-label={canvasWords.takeOff(file.name)} onClick={() => onDetach(file.id)}
                >
                  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
            {attachments.length >= MOST ? null : (
              <label className={`canvas__iattach ${going ? 'canvas__iattach--off' : ''}`}>
                <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                  <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                {canvasWords.attach}
                <input
                  type="file" accept={ACCEPT} multiple disabled={going}
                  onChange={(event) => {
                    const picked = [...(event.target.files ?? [])];
                    event.target.value = '';
                    if (picked.length === 0) return;
                    const landed = readDropped({ files: picked });
                    setRefused(landed.because);
                    if (landed.taken.length > 0) onAttach(landed.taken.map((one) => one.file));
                  }}
                />
              </label>
            )}
          </div>
          {refused === null ? null : (
            <p className="canvas__inone" role="status">{refused}</p>
          )}
        </div>
      )}

      {/* Outside the body, which scrolls: Remove cannot be scrolled to. */}
      {view !== 'block' ? null : (
        <footer className="canvas__ifoot">
          <button type="button" className="canvas__iquiet" onClick={onDuplicate} disabled={going}>
            {canvasWords.duplicate}
          </button>
          <button type="button" className="canvas__iremove" onClick={onRemove} disabled={going}>
            <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
              <path
                d="M2.6 4.2h8.8M5.6 4.2V2.9h2.8v1.3M3.9 4.2l.5 7h5.2l.5-7M6 6.3v3M8 6.3v3"
                stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
            {canvasWords.delete}
            <kbd className="canvas__ikey">⌫</kbd>
          </button>
        </footer>
      )}
    </aside>
  );
}
