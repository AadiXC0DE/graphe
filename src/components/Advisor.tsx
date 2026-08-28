import { useEffect, useMemo, useRef, useState } from 'react';
import { advisorWords, worthHaving } from '../agent/advisor';
import type { ConnectionState, ModelChoice } from '../lib/ipc';
import { byTier, tierNames } from '../lib/modeltiers';
import './Advisor.css';

type Props = {
  /** The whole state of "who can think for me", or null while the first answer
   *  is on its way. The same source the model chip beside this one reads. */
  state: ConnectionState | null;
  /** The model asked about the hard parts, or null for one model doing all of
   *  it. */
  advisor: ModelChoice | null;
  onAdvisor: (choice: ModelChoice | null) => void;
  /** Whether the advisor addition is already here. False draws the row that
   *  adds it; left off, nothing is claimed either way. */
  installed?: boolean;
  /** Open the shelf, at the addition this needs. */
  onAdd?: () => void;
  /** Lets a native page step aside while this popover is open. */
  onOpenChange?: (open: boolean) => void;
};

/** One row of the list, flattened out of the provider tree. */
type Offer = {
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  rates: { input: number; output: number } | null;
};

/**
 * Who thinks, and who does.
 *
 * One model doing everything is one model's judgement at one model's price all
 * day. This puts the work on whatever is answering now and asks a stronger one
 * about the few moments that decide how the rest goes — before a plan, after
 * the same thing has failed twice, before "done". It sits beside the model chip
 * because it is the other half of the same question.
 */
export default function Advisor({
  state,
  advisor,
  onAdvisor,
  installed,
  onAdd,
  onOpenChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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
        });
      }
    }
    return all;
  }, [state]);

  const doing = useMemo(() => {
    const chosen = state?.chosen ?? null;
    if (chosen === null) return offers[0] ?? null;
    return (
      offers.find(
        (one) => one.providerId === chosen.providerId && one.modelId === chosen.modelId,
      ) ?? null
    );
  }, [offers, state]);

  /* The one doing the work is never also the one advising: that is the same
     answer twice at twice the price. */
  const advisable = useMemo(
    () =>
      offers.filter(
        (one) => doing === null || one.providerId !== doing.providerId || one.modelId !== doing.modelId,
      ),
    [offers, doing],
  );

  const current = useMemo(
    () =>
      advisor === null
        ? null
        : (offers.find(
            (one) => one.providerId === advisor.providerId && one.modelId === advisor.modelId,
          ) ?? null),
    [offers, advisor],
  );

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

  useEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);

  /* A single band of models is a choice between equals, and a chip over one of
     those is a chip in the way. */
  if (advisor === null && !worthHaving(advisable)) return null;

  /* Without the addition nothing is advising, whatever was chosen before it was
     removed — so the chip says so and the list of who could is not offered. */
  const working = installed !== false;
  const label =
    current === null || !working ? advisorWords.chip : `${advisorWords.chipOn}: ${current.label}`;

  return (
    <div className="advises" ref={root}>
      <button
        type="button"
        className={`advises__chip ${advisor === null || !working ? '' : 'advises__chip--on'}`}
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          current === null
            ? advisorWords.note
            : `${advisorWords.advises}: ${current.providerName} · ${current.modelId}`
        }
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 4.2v2.4M6 8.2v.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="advises__label">{label}</span>
      </button>

      {open ? (
        <div className="advises__menu">
          <div className="advises__head">
            <span className="advises__title">{advisorWords.name}</span>
          </div>

          {/* Who does the work is chosen with the chip next door, so it is said
              here rather than offered again. */}
          {doing === null ? null : (
            <p className="advises__doing">
              <span className="advises__doingrole">{advisorWords.does}</span>
              <span className="advises__doingname">{doing.label}</span>
            </p>
          )}

          {installed === false ? (
            <button type="button" className="advises__add" onClick={() => { onAdd?.(); setOpen(false); }}>
              <span className="advises__name">{advisorWords.missing}</span>
              <span className="advises__note">{advisorWords.missingNote}</span>
            </button>
          ) : null}

          {/* Only the choices are in the list. The heading, who is doing the
              work and the way to add the addition are not options, and a
              listbox holding anything else drops it from what is read out. */}
          <div className="advises__list" role="listbox" aria-label={advisorWords.name}>
            {/* First, so turning it off is one press and never a hunt. */}
            <button
              type="button"
              role="option"
              aria-selected={advisor === null}
              className={`advises__option ${advisor === null ? 'advises__option--chosen' : ''}`}
              onClick={() => {
                onAdvisor(null);
                setOpen(false);
              }}
            >
              <Tick on={advisor === null} />
              <span className="advises__text">
                <span className="advises__name">{advisorWords.off}</span>
                <span className="advises__note">{advisorWords.offNote}</span>
              </span>
            </button>

            {working ? (
              <h4 className="advises__groupname" aria-hidden="true">
                {advisorWords.advises}
                <span className="advises__groupnote">{advisorWords.advisesNote}</span>
              </h4>
            ) : null}

            {(working ? sections(advisable) : []).map((section) => (
              <section className="advises__group" role="group" aria-label={section.name} key={section.key}>
                <h5 className="advises__bandname" aria-hidden="true">
                  {section.name}
                  {section.note === undefined ? null : (
                    <span className="advises__groupnote">{section.note}</span>
                  )}
                </h5>
                {section.models.map((one) => {
                  const chosen =
                    advisor !== null &&
                    advisor.providerId === one.providerId &&
                    advisor.modelId === one.modelId;
                  return (
                    <button
                      key={`${one.providerId}/${one.modelId}`}
                      type="button"
                      role="option"
                      aria-selected={chosen}
                      className={`advises__option ${chosen ? 'advises__option--chosen' : ''}`}
                      onClick={() => {
                        onAdvisor({ providerId: one.providerId, modelId: one.modelId });
                        setOpen(false);
                      }}
                    >
                      <Tick on={chosen} />
                      <span className="advises__text">
                        <span className="advises__name">{one.label}</span>
                        <span className="advises__id">
                          {one.providerName} · {one.modelId}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span className="advises__tick" aria-hidden="true">
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

type Section = { key: string; name: string; note?: string; models: readonly Offer[] };

/** Grouped by what a model costs rather than by who made it, and never by a
 *  list of names — see the header of `lib/modeltiers.ts` for why. */
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
