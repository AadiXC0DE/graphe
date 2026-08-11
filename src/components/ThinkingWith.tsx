import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionState, ModelChoice } from '../lib/ipc';
import './ThinkingWith.css';

type Props = {
  /** The whole state of "who can think for me", or null while the first answer
   *  is on its way. */
  state: ConnectionState | null;
  onSelect: (choice: ModelChoice) => void;
  /** Open the full connect screen — the way to add an account, as opposed to
   *  picking between the ones already here. */
  onConnect: () => void;
};

/** What one row of the list needs, flattened out of the provider tree. */
type Offer = {
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
};

/**
 * Which model is answering, said out loud and always.
 *
 * It lives in the composer's own row because a model is the thing people change
 * most often, and behind a modal it was invisible — invisible enough that you
 * could pick one, watch nothing change, and have nothing on screen to tell you.
 * The list holds only models that can be used right now; a menu of things that
 * will fail is not a menu.
 */
export default function ThinkingWith({ state, onSelect, onConnect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);

  /* Flat, because the provider is a heading in the list rather than a level to
     navigate into. */
  const offers = useMemo<readonly Offer[]>(() => {
    const all: Offer[] = [];
    for (const provider of state?.providers ?? []) {
      if (!provider.connected) continue;
      for (const model of provider.models) {
        if (!model.available) continue;
        all.push({
          providerId: provider.providerId,
          providerName: provider.name,
          modelId: model.id,
          label: model.label,
        });
      }
    }
    return all;
  }, [state]);

  const chosen = state?.chosen ?? null;
  const current = useMemo(
    () =>
      chosen === null
        ? null
        : (offers.find(
            (one) => one.providerId === chosen.providerId && one.modelId === chosen.modelId,
          ) ?? null),
    [offers, chosen],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return offers;
    return offers.filter(
      (one) =>
        one.label.toLowerCase().includes(needle) ||
        one.providerName.toLowerCase().includes(needle),
    );
  }, [offers, query]);

  /* Click away and escape both close it — people reach for both. */
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  /* Nothing connected goes straight to the connect screen — an empty list is a
     dead end standing where the one useful action should be. */
  const nothingConnected = offers.length === 0;

  const label = nothingConnected
    ? 'Connect a model'
    : current !== null
      ? current.label
      : 'Any available model';

  return (
    <div className="thinking" ref={root}>
      <button
        type="button"
        className={`thinking__chip ${nothingConnected ? 'thinking__chip--none' : ''}`}
        onClick={() => (nothingConnected ? onConnect() : setOpen((was) => !was))}
        aria-haspopup={nothingConnected ? undefined : 'listbox'}
        aria-expanded={nothingConnected ? undefined : open}
        title={
          nothingConnected
            ? 'No account is connected yet'
            : current === null
              ? 'No particular model chosen — whichever the account offers'
              : `${current.providerName} · ${current.label}`
        }
      >
        <span className="thinking__dot" aria-hidden="true" />
        <span className="thinking__label">{label}</span>
        {nothingConnected ? null : (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {open && !nothingConnected ? (
        <div className="thinking__menu" role="listbox" aria-label="Which model should answer">
          {/* Skipped on a short list: a field above a list you can already see
              is a field in the way. */}
          {offers.length > 8 ? (
            <input
              className="thinking__search"
              type="text"
              value={query}
              autoFocus
              placeholder="Search models"
              aria-label="Search models"
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}

          <div className="thinking__list">
            {shown.length === 0 ? (
              <p className="thinking__empty">Nothing here matches that.</p>
            ) : (
              group(shown).map(([providerName, models]) => (
                <section className="thinking__group" key={providerName}>
                  <h4 className="thinking__groupname">{providerName}</h4>
                  {models.map((one) => {
                    const isChosen =
                      chosen !== null &&
                      chosen.providerId === one.providerId &&
                      chosen.modelId === one.modelId;
                    return (
                      <button
                        key={`${one.providerId}/${one.modelId}`}
                        type="button"
                        role="option"
                        aria-selected={isChosen}
                        className={`thinking__option ${isChosen ? 'thinking__option--chosen' : ''}`}
                        onClick={() => {
                          onSelect({ providerId: one.providerId, modelId: one.modelId });
                          setOpen(false);
                        }}
                      >
                        <span className="thinking__tick" aria-hidden="true">
                          {isChosen ? (
                            <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                              <path
                                d="M2 6l3 3 5-5.5"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          ) : null}
                        </span>
                        <span className="thinking__optionlabel">{one.label}</span>
                      </button>
                    );
                  })}
                </section>
              ))
            )}
          </div>

          <button
            type="button"
            className="thinking__more"
            onClick={() => {
              setOpen(false);
              onConnect();
            }}
          >
            Connect another account…
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Back into provider order for drawing, keeping the shell's ordering so this
 *  list and the connect screen agree. */
function group(offers: readonly Offer[]): [string, Offer[]][] {
  const byProvider = new Map<string, Offer[]>();
  for (const one of offers) {
    const already = byProvider.get(one.providerName);
    if (already === undefined) byProvider.set(one.providerName, [one]);
    else already.push(one);
  }
  return [...byProvider.entries()];
}
