/* The page's behaviour. Small on purpose: no framework, no build, four things.
   Everything here degrades to a readable page with scripting off. */

const quiet = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ── things arrive as you reach them ─────────────────────────────────── */

const arriving = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      arriving.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
);

for (const item of document.querySelectorAll('[data-reveal]')) arriving.observe(item);

/* ── the window: four real screens, one frame ────────────────────────── */

/** What the caption says under each screen, so the picture is never unlabelled. */
const CAPTIONS = {
  work: ['graphe', 'the files, the work, and what is running'],
  design: ['graphe — design', 'your own tokens, read as a spec'],
  history: ['graphe — history', '87 moments saved, drawn as lines'],
  skills: ['graphe — skills', 'craft you installed, ready to use'],
};

const tabs = [...document.querySelectorAll('.tab')];
const screens = [...document.querySelectorAll('.screen')];
const frameName = document.querySelector('[data-frame-name]');
const frameCap = document.querySelector('[data-frame-cap]');

function show(view) {
  for (const tab of tabs) {
    const on = tab.dataset.view === view;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  }
  for (const screen of screens) {
    screen.classList.toggle('is-on', screen.dataset.screen === view);
  }
  const said = CAPTIONS[view];
  if (said && frameName && frameCap) {
    frameName.textContent = said[0];
    frameCap.textContent = said[1];
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => show(tab.dataset.view));
}

// Left and right walk the tabs, which is what a tab list is expected to do.
document.querySelector('.stage__tabs')?.addEventListener('keydown', (event) => {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (step === 0) return;
  event.preventDefault();
  const at = tabs.findIndex((tab) => tab.classList.contains('is-on'));
  const next = tabs[(at + step + tabs.length) % tabs.length];
  next.focus();
  show(next.dataset.view);
});

/* ── the nav notices it is no longer at the top ──────────────────────── */

const nav = document.getElementById('nav');
let ticking = false;

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    nav?.classList.toggle('is-stuck', window.scrollY > 8);
    ticking = false;
  });
}

window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ── the step you are level with ─────────────────────────────────────── */

const steps = [...document.querySelectorAll('.step')];

if (steps.length > 0) {
  const here = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('is-here', entry.isIntersecting);
      }
    },
    { rootMargin: '-45% 0px -45% 0px' },
  );
  for (const step of steps) here.observe(step);
}

/* ── the window shows itself once, so the tabs read as tabs ──────────── */

if (!quiet.matches && tabs.length > 1) {
  const stage = document.querySelector('.stage');
  let shown = false;
  const teach = new IntersectionObserver((entries) => {
    if (shown || !entries[0]?.isIntersecting) return;
    shown = true;
    teach.disconnect();
    setTimeout(() => {
      // Only if nobody has touched it — a page that overrides a person's choice
      // to show off is worse than one that never showed off.
      if (tabs[0].classList.contains('is-on')) show('design');
      setTimeout(() => {
        if (tabs[1].classList.contains('is-on')) show('work');
      }, 1500);
    }, 2600);
  });
  if (stage) teach.observe(stage);
}
