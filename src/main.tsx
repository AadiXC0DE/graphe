import { StrictMode } from 'react';
import { mark } from './lib/marks';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Zed-like: show scrollbar while scrolling, then fade out.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target as Element | null;
      if (target === null || !(target instanceof Element)) return;
      if (
        !target.matches(
          '.scroll--auto, .app, .files__tree, .overview, .rail, .sheet__body, .sheet__chips, .palette__list, .shelf__band--scroll, .fileview__code, .pane__stage, .settings, .changes__lines, .widths__shots, .codeblock__code pre, .md__tablewrap, .helperrail, .tabs__list, .tabs__strip, .pane__variations, .composer__input',
        )
      )
        return;
      target.classList.add('is-scrolling');
      const prev = timers.get(target);
      if (prev !== undefined) window.clearTimeout(prev);
      const id = window.setTimeout(() => target.classList.remove('is-scrolling'), 700);
      timers.set(target, id);
    },
    true,
  );
}

// The first moment the window has any say in.
mark('launch');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
