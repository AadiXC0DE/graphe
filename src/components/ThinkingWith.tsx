import { useEffect, useMemo, useRef, useState } from 'react';
import { advisorWords, worthHaving } from '../agent/advisor';
import type { ConnectionState, ModelChoice, ThinkingLevel } from '../lib/ipc';
import { byTier, tierNames } from '../lib/modeltiers';
import { thinkingLevels } from '../lib/thinking';
import './ThinkingWith.css';

type Props = {
  /** The whole state of "who can think for me", or null while the first answer
   *  is on its way. */
  state: ConnectionState | null;
  onSelect: (choice: ModelChoice) => void;
  /** How long the chosen model should take before answering. Left off, only
   *  the picker is shown — which is how the pieces can be looked at alone. */
  onThinking?: (choice: ModelChoice, level: ThinkingLevel) => void;
  /** Open the full connect screen — the way to add an account, as opposed to
   *  picking between the ones already here. */
  onConnect: () => void;
  /** The model asked about the hard parts, or null for one model doing all of
   *  it. Without `onAdvisor` no second opinion is offered at all. */
  advisor?: ModelChoice | null;
  onAdvisor?: (choice: ModelChoice | null) => void;
  /** Lets a native page step aside while this renderer popover is open. */
  onOpenChange?: (open: boolean) => void;
  /** Quieter, for the strip along the top where it sits beside the project's
   *  name rather than inside the composer. */
  bare?: boolean;
};

/** What one row of the list needs, flattened out of the provider tree. */
type Offer = {
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  rates: { input: number; output: number } | null;
  thinking: readonly ThinkingLevel[];
  /** Null when its catalogue entry does not say — not knowing and knowing it
   *  cannot are different claims. */
  takesImages: boolean | null;
};

export const SWAP_WORDS = {
  losesPictures: 'Reads no pictures',
  losesDepth: 'Answers straight away',
  losesBoth: 'No pictures, and answers straight away',
} as const;

/**
 * What this one would give up against the one answering now.
 *
 * Said in the list rather than after the press: switching used to flatten how
 * hard it thinks without a word, and you found out by watching it answer
 * differently. Only a loss is named — a row that is the same or better says
 * nothing, or the list becomes a wall of labels nobody reads.
 */
export function whatItGivesUp(
  now: { thinking: readonly ThinkingLevel[]; takesImages: boolean | null } | null,
  offer: { thinking: readonly ThinkingLevel[]; takesImages: boolean | null },
): string | null {
  if (now === null) return null;
  const pictures = now.takesImages === true && offer.takesImages === false;
  const depth = now.thinking.length > 1 && offer.thinking.length <= 1;
  if (pictures && depth) return SWAP_WORDS.losesBoth;
  if (pictures) return SWAP_WORDS.losesPictures;
  if (depth) return SWAP_WORDS.losesDepth;
  return null;
}

/**
 * Which model is answering, said out loud and always.
 *
 * It lives in the composer's own row because a model is the thing people change
 * most often, and behind a modal it was invisible — invisible enough that you
 * could pick one, watch nothing change, and have nothing on screen to tell you.
 * The list holds only models that can be used right now; a menu of things that
 * will fail is not a menu.
 *
 * Who advises is the same question asked twice, so it is behind this chip too
 * rather than beside it: one control in the row, and the second model chosen
 * from inside the place the first one was chosen.
 */
export default function ThinkingWith({
  state,
  onSelect,
  onThinking,
  onConnect,
  onOpenChange,
  bare,
  advisor = null,
  onAdvisor,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'models' | 'thinking' | 'advisor'>('models');
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
          rates: model.rates,
          // Absent on older shell data: a model whose capability was never
          // declared is treated as one that only answers straight away.
          thinking: model.thinking ?? ['off'],
          takesImages: model.takesImages ?? null,
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

  /* Whoever will answer, chosen or not: the second opinion is defined against
     the model actually doing the work. */
  const doing = current ?? offers[0] ?? null;

  /* The one doing the work is never also the one advising: that is the same
     answer twice at twice the price. */
  const advisable = useMemo(
    () =>
      offers.filter(
        (one) =>
          doing === null || one.providerId !== doing.providerId || one.modelId !== doing.modelId,
      ),
    [offers, doing],
  );

  const advising = useMemo(
    () =>
      advisor === null
        ? null
        : (offers.find(
            (one) => one.providerId === advisor.providerId && one.modelId === advisor.modelId,
          ) ?? null),
    [offers, advisor],
  );

  /* Without the addition nothing is advising, whatever was chosen before it was
     removed. */
  /* The list is always offered. The addition it needs is Pi's, and a control
     that lives permanently in this menu cannot send somebody off to a package
     shelf to make it work — choosing a model is what adds it. */
  const advisingNow = advising !== null;

  /* A single band of models is a choice between equals, so the section stays out
     of the way until the account has a step up in it. */
  const offerAdvisor = onAdvisor !== undefined && (advisor !== null || worthHaving(advisable));

  /* Click away and escape both close it — people reach for both. */
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Closes this and only this. Left to travel on, the same press reaches
      // the window and stops the run behind it.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  /* A WebContentsView is drawn over all renderer layers. The parent hides it
     for the brief lifetime of this picker, so the picker remains usable next
     to an open page rather than merely having a larger CSS z-index. */
  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setView('models');
    }
  }, [open]);

  /* Nothing connected goes straight to the connect screen — an empty list is a
     dead end standing where the one useful action should be. */
  const nothingConnected = offers.length === 0;

  /* Nothing chosen names the one that will actually answer rather than
     shrugging: connecting picks a model, so there is always a real answer to
     give, and "Any available model" was a label for a state that used to break
     sending. */
  const label = nothingConnected
    ? 'Connect a model'
    : (current?.label ?? offers[0]?.label ?? 'Choose a model');

  return (
    <div className={`thinking ${bare === true ? 'thinking--bare' : ''}`} ref={root}>
      <button
        type="button"
        className={`thinking__chip ${nothingConnected ? 'thinking__chip--none' : ''}`}
        onClick={() => {
          if (nothingConnected) {
            onConnect();
            return;
          }
          setView('models');
          setOpen((was) => !was);
        }}
        aria-haspopup={nothingConnected ? undefined : 'dialog'}
        aria-expanded={nothingConnected ? undefined : open}
        title={
          nothingConnected
            ? 'No account is connected yet'
            : `${
                current === null
                  ? 'Nothing chosen yet. This is the one that will answer'
                  : `${current.providerName} · ${current.label}`
              }${advisingNow ? ` — ${advisorWords.advises}: ${advising.label}` : ''}`
        }
      >
        <span className="thinking__dot" aria-hidden="true" />
        {/* Two dots, two models. The label still names only the one answering:
            a second model is worth noticing, not worth another sentence. */}
        {advisingNow ? <span className="thinking__dot thinking__dot--second" aria-hidden="true" /> : null}
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
        <div
          className="thinking__menu"
          role="dialog"
          aria-label="Choose a model, how long it thinks, and who advises"
        >
          {view === 'models' ? (
            <>
              <div className="thinking__menuhead">
                <span className="thinking__menutitle">Choose a model</span>
                <span className="thinking__menucount">{offers.length} available</span>
              </div>

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

              <div className="thinking__list" role="listbox" aria-label="Which model should answer">
                {shown.length === 0 ? (
                  <p className="thinking__empty">Nothing here matches that.</p>
                ) : (
                  sections(shown).map((section) => (
                    <section className="thinking__group" key={section.key}>
                      <h4 className="thinking__groupname">
                        {section.name}
                        {section.note === undefined ? null : (
                          <span className="thinking__groupnote">{section.note}</span>
                        )}
                      </h4>
                      {section.models.map((one) => {
                        const isChosen =
                          chosen !== null &&
                          chosen.providerId === one.providerId &&
                          chosen.modelId === one.modelId;
                        const givesUp = isChosen ? null : whatItGivesUp(current, one);
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
                            <Tick on={isChosen} />
                            <span className="thinking__optiontext">
                              <span className="thinking__optionlabel">{one.label}</span>
                              <span className="thinking__optionid">
                                {one.providerName} · {one.modelId}
                              </span>
                              {givesUp === null ? null : (
                                <span className="thinking__optionloses">{givesUp}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  ))
                )}
              </div>

              {chosen !== null && current !== null && onThinking !== undefined && current.thinking.length > 1 ? (
                <button
                  type="button"
                  className="thinking__tune"
                  onClick={() => setView('thinking')}
                  aria-label="Change how long the selected model thinks"
                >
                  <span>Thinking time</span>
                  <span>
                    {thinkingLevels[state?.chosenThinking ?? 'off'].name}
                    <span aria-hidden="true">›</span>
                  </span>
                </button>
              ) : null}

              {/* Behind the control it belongs to: the second model is the same
                  question as the first, and a row here is found by the hand
                  that is already on it. */}
              {offerAdvisor ? (
                <button
                  type="button"
                  className="thinking__tune thinking__tune--words"
                  onClick={() => setView('advisor')}
                  aria-label={`${advisorWords.name}: ${advisingNow ? advising.label : advisorWords.none}`}
                >
                  <span>{advisorWords.name}</span>
                  <span>
                    <span className="thinking__tunevalue">
                      {advisingNow ? advising.label : advisorWords.none}
                    </span>
                    <span aria-hidden="true">›</span>
                  </span>
                </button>
              ) : null}

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
            </>
          ) : view === 'advisor' && onAdvisor !== undefined ? (
            <>
              <header className="thinking__menuhead thinking__menuhead--back">
                <button type="button" className="thinking__back" onClick={() => setView('models')}>
                  <span aria-hidden="true">‹</span> Models
                </button>
                <span className="thinking__menutitle">{advisorWords.name}</span>
              </header>

              <p className="thinking__said">{advisorWords.note}</p>


                <>
                  {/* Who does the work was chosen in the view behind this one, so
                      it is said here rather than offered again. */}
                  {doing === null ? null : (
                    <p className="thinking__doing">
                      <span>{advisorWords.does}</span>
                      <span className="thinking__doingname">{doing.label}</span>
                    </p>
                  )}

                  <div className="thinking__list" role="listbox" aria-label={advisorWords.advises}>
                    {/* First, so turning it off is one press and never a hunt. */}
                    <button
                      type="button"
                      role="option"
                      aria-selected={advisor === null}
                      className={`thinking__option ${advisor === null ? 'thinking__option--chosen' : ''}`}
                      onClick={() => {
                        onAdvisor(null);
                        setOpen(false);
                      }}
                    >
                      <Tick on={advisor === null} />
                      <span className="thinking__optiontext">
                        <span className="thinking__optionlabel">{advisorWords.off}</span>
                        <span className="thinking__optionnote">{advisorWords.offNote}</span>
                      </span>
                    </button>

                    {sections(advisable).map((section) => (
                      <section className="thinking__group" key={section.key}>
                        <h4 className="thinking__groupname">
                          {section.name}
                          {section.note === undefined ? null : (
                            <span className="thinking__groupnote">{section.note}</span>
                          )}
                        </h4>
                        {section.models.map((one) => {
                          const picked =
                            advisor !== null &&
                            advisor.providerId === one.providerId &&
                            advisor.modelId === one.modelId;
                          return (
                            <button
                              key={`${one.providerId}/${one.modelId}`}
                              type="button"
                              role="option"
                              aria-selected={picked}
                              className={`thinking__option ${picked ? 'thinking__option--chosen' : ''}`}
                              onClick={() => {
                                onAdvisor({ providerId: one.providerId, modelId: one.modelId });
                                setOpen(false);
                              }}
                            >
                              <Tick on={picked} />
                              <span className="thinking__optiontext">
                                <span className="thinking__optionlabel">{one.label}</span>
                                <span className="thinking__optionid">
                                  {one.providerName} · {one.modelId}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </section>
                    ))}
                  </div>

                  <p className="thinking__said thinking__said--foot">{advisorWords.advisesNote}</p>
                </>
            </>
          ) : chosen !== null && current !== null ? (
            <>
              <header className="thinking__menuhead thinking__menuhead--back">
                <button type="button" className="thinking__back" onClick={() => setView('models')}>
                  <span aria-hidden="true">‹</span> Models
                </button>
                <span className="thinking__menutitle">Thinking time</span>
              </header>
              <p className="thinking__selectedmodel" title={`${chosen.providerId}/${chosen.modelId}`}>
                {current.label}
              </p>
              <Pace
                levels={current.thinking}
                chosen={state?.chosenThinking ?? 'off'}
                onPick={(level) => {
                  onThinking?.(chosen, level);
                  setOpen(false);
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Reserved whether or not it is on, so choosing does not shuffle every label
 *  sideways. */
function Tick({ on }: { on: boolean }) {
  return (
    <span className="thinking__tick" aria-hidden="true">
      {on ? (
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
  );
}

type Section = { key: string; name: string; note?: string; models: Offer[] };

/**
 * How the list is broken up: by what a model is *for* when the prices say
 * something useful, and by provider when they do not.
 */
function sections(offers: readonly Offer[]): Section[] {
  const tiers = byTier(offers);
  if (tiers !== null) {
    return tiers.map(([tier, models]) => ({
      key: tier,
      name: tierNames[tier].name,
      note: tierNames[tier].note,
      models,
    }));
  }
  const byProvider = new Map<string, Offer[]>();
  for (const one of offers) {
    const already = byProvider.get(one.providerName);
    if (already === undefined) byProvider.set(one.providerName, [one]);
    else already.push(one);
  }
  return [...byProvider.entries()].map(([name, models]) => ({ key: name, name, models }));
}

/** How long the chosen model thinks before it answers (A0 in BACKLOG-4).
 *  Only the levels this model can actually use are drawn, in the words a
 *  person reads — the raw Pi name stays on the element's title for whoever
 *  knows it. A model that only answers straight away draws nothing and is
 *  already a complete answer. */
function Pace({
  levels,
  chosen,
  onPick,
}: {
  levels: readonly ThinkingLevel[];
  chosen: ThinkingLevel;
  onPick: (level: ThinkingLevel) => void;
}) {
  if (onPick === undefined) return null;
  return (
    <section className="thinking__pace" aria-label="How long it thinks first">
      <div className="thinking__paces" role="radiogroup" aria-label="How long it should think">
        {/* `levels` comes from the model's own capability map, so an offset
            selection (a map that skips `medium`) is a real thing and is drawn
            truthfully rather than filled in. */}
        {levels.map((level) => {
          const said = thinkingLevels[level];
          const active = level === chosen;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={active}
              className={`thinking__pace-level ${active ? 'thinking__pace-level--on' : ''}`}
              title={said.note}
              aria-label={`${said.name}, ${said.plain}`}
              onClick={() => onPick(level)}
            >
              <span className="thinking__pace-dot" aria-hidden="true" />
              <span className="thinking__pace-name">{said.name}</span>
              <span className="thinking__pace-plain">({said.plain})</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
