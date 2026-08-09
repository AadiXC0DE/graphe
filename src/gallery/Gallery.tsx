import { useEffect, useState, type ReactNode } from 'react';
import ActivityLine from '../components/ActivityLine';
import ConfirmChange from '../components/ConfirmChange';
import CostMeter from '../components/CostMeter';
import ErrorCard from '../components/ErrorCard';
import Message from '../components/Message';
import VersionRow from '../components/VersionRow';
import { createLimit } from '../cost/limits';
import { money } from '../cost/money';
import { biggerJob, estimateNote } from '../cost/phrasing';
import type { Estimate } from '../cost/estimate';
import './Gallery.css';

/** Every presentational component on one page, in both themes, with the content
 *  this product would actually show. Reachable at /?gallery — it exists to be
 *  screenshotted and looked at, which is the only acceptance test that counts
 *  for an interface. */

const inr = (minor: number) => money(minor, 'INR');
const monthlyLimit = createLimit(inr(200_000), 'month');

/** A real estimate object, so the confirmation below is worded by the same code
 *  the product uses rather than by hand. */
const estimate: Estimate = {
  task: { kind: 'landing-page', size: 'feature' },
  expected: inr(3500),
  low: inr(2000),
  high: inr(6000),
  confidence: 'measured',
  sampleSize: 9,
  expectedDurationMs: 4 * 60_000,
};

const bigJob = biggerJob(estimate);
const bigJobNote = estimateNote(estimate);

type Theme = 'system' | 'light' | 'dark';

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="gsection">
      <div className="gsection__head">
        <h2 className="gsection__title">{title}</h2>
        <p className="gsection__note">{note}</p>
      </div>
      <div className="gsection__body">{children}</div>
    </section>
  );
}

function noop() {}

export default function Gallery() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <main className="gallery">
      <header className="gallery__head">
        <div>
          <h1 className="gallery__title">Graphe interface kit</h1>
          <p className="gallery__sub">
            The six presentational pieces of the conversation, with real copy. Motion follows
            notes/strategy/UI-DESIGN.md — most of what is on this page deliberately does not move.
          </p>
        </div>
        <div className="gallery__themes" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`gallery__theme ${theme === option ? 'is-on' : ''}`}
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
            >
              {option[0]!.toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div className="gallery__grid">
        <div className="gallery__col">
          <Section
            title="Conversation"
            note="Never animates — it is the thing people see a hundred times a day. Streaming text simply appears, with no fade and no typewriter."
          >
            <div className="thread-sample">
              <Message from="you">
                Build the hero from this file, keeping our spacing scale:
                figma.com/file/8Kx2/Landing-v4
              </Message>
              <Message from="graphe" aside="This one’s fiddly, so I took the Careful route.">
                It’s built. One thing worth knowing: the frame puts 68px above the headline, which
                isn’t on your spacing scale, so I used 72px — the nearest step you already use
                everywhere else. It reads identically and it won’t drift next time.
              </Message>
              <Message from="you">Good. What about the three cards under it?</Message>
              <Message from="graphe" streaming>
                They’re the only part that doesn’t fit your 12-column grid at 1024px. I can widen
                the container to 1200px, or drop the card
              </Message>
            </div>
          </Section>

          <Section
            title="Activity"
            note="Read-only, never an input. A spinner never appears without a sentence beside it, and the state is a shape as well as a colour."
          >
            <div className="activity-feed">
              <ActivityLine
                state="done"
                label="Read your Figma file"
                detail="12 frames, 3 with variants"
                meta="6s"
              />
              <ActivityLine state="done" label="Got your project ready" meta="3s" />
              <ActivityLine
                state="done"
                label="Matched the type scale to your tokens"
                detail="4 sizes"
                meta="11s"
              />
              <ActivityLine state="failed" label="Ran your build" detail="stopped on one file" />
              <ActivityLine state="running" label="Checking it against your design system" />
            </div>
          </Section>

          <Section
            title="Cost"
            note="Small, glanceable, corner-mounted, and it never animates — a number that moves turns awareness into anxiety."
          >
            <div className="gallery__meters">
              <CostMeter spent={inr(4000)} onDetails={noop} />
              <CostMeter spent={inr(120_000)} limit={monthlyLimit} onDetails={noop} />
              <CostMeter spent={inr(163_000)} limit={monthlyLimit} onDetails={noop} />
              <CostMeter spent={inr(200_000)} limit={monthlyLimit} onDetails={noop} />
            </div>
            <p className="gallery__caption">
              No ceiling set · well inside it · getting close · reached. Every word comes from
              src/cost/phrasing.ts, which is the one file the language audit sweeps.
            </p>
          </Section>

          <Section
            title="What moves, and when"
            note="Motion is spent on the rare moments and withheld from the frequent ones. Everything below has a prefers-reduced-motion counterpart; with motion reduced, this page is identical at rest."
          >
            <dl className="motion-table">
              {[
                ['A turn of conversation, streaming or not', 'Nothing. Ever.'],
                ['The cost meter changing', 'Nothing. Ever.'],
                ['A spinner beside a sentence', 'Rotation · the only linear'],
                ['A confirmation arriving', 'Up 12px + fade · 200ms'],
                ['Something going wrong', 'Up 6px + fade · 280ms'],
                ['Hovering a version', 'Colour only · 120ms'],
                ['Pressing any button', 'scale(0.97) · 120ms'],
              ].map(([what, how]) => (
                <div className="motion-table__row" key={what}>
                  <dt className="motion-table__what">{what}</dt>
                  <dd className="motion-table__how">{how}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>

        <div className="gallery__col">
          <Section
            title="Before something risky"
            note="Rises 12px with a fade over 200ms and then stays put, beside the work. Never a modal over the preview — a dimmed backdrop is the grammar of an error, and being asked a question is ordinary."
          >
            <ConfirmChange
              question="Replace the colour styles in your design system?"
              detail="The eleven styles in Brand / Core would point at the new tokens instead of the old hexes."
              consequence="I’ll save a version first, so putting it back is one click."
              cancelLabel="Leave them as they are"
              confirmLabel="Replace them"
              onCancel={noop}
              onConfirm={noop}
            />
            <ConfirmChange
              question={bigJob.title}
              detail={bigJobNote ? `${bigJob.body} ${bigJobNote}` : bigJob.body}
              consequence="You’ve spent ₹1,200 today, so this would put you at about ₹1,235."
              cancelLabel={bigJob.alternative}
              confirmLabel={bigJob.confirm}
              onCancel={noop}
              onConfirm={noop}
            />
            <p className="gallery__caption">
              The option that changes something is the quiet one. Safe comes first in the DOM, so it
              is also first for the keyboard.
            </p>
          </Section>

          <Section
            title="Version timeline"
            note="Hovering moves nothing. Scrubbing has to feel like Figma’s version history — immediate, weightless, consequence-free."
          >
            <ul className="version-list">
              <VersionRow
                title="Hero rebuilt from Figma"
                time="2 minutes ago"
                current
                onOpen={noop}
              />
              <VersionRow
                title="Spacing matched to your scale"
                time="18 minutes ago"
                onOpen={noop}
                onRestore={noop}
              />
              <VersionRow
                title="Cards moved onto the grid"
                time="1 hour ago"
                onOpen={noop}
                onRestore={noop}
              />
              <VersionRow
                title="First pass at the landing page"
                time="Yesterday, 6:12pm"
                onOpen={noop}
                onRestore={noop}
              />
            </ul>
            <p className="gallery__caption">
              “Put back”, not “restore to commit”. Every action is reversible from a picture.
            </p>
          </Section>

          <Section
            title="When it goes wrong"
            note="Slower than everything else: 280ms, no shake, no red flash. Colour carries the severity; motion stays gentle."
          >
            <ErrorCard
              what="The build stopped before it finished."
              because="It looks like the icon package didn’t install properly — everything else compiled."
              actionLabel="Install it again and retry"
              onAction={noop}
              technicalDetails={`npm ERR! code ERESOLVE
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^18.0.0" from lucide-react@0.263.1
npm ERR! Found: react@19.0.0

vite v6.0.5 building for production...
✗ Failed to resolve import "lucide-react" from "src/components/Toolbar.tsx"`}
            />
            <ErrorCard
              what="I couldn’t open that Figma file."
              because="The link is fine, but the file sits in a team the connected account can’t see — it probably needs sharing."
              actionLabel="Show me how to share it"
              onAction={noop}
            />
          </Section>
        </div>
      </div>
    </main>
  );
}
