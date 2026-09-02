import { describe, it } from 'vitest';
import { surfacesFrom, contrastRatio, oklchOf, rgbFrom, hexOf, rgbOf } from '../src/design/palette-oklch';

describe('probe', () => {
  it('prints', () => {
    console.log('white/black', contrastRatio('#ffffff', '#000000'));
    console.log('grey/white', contrastRatio('#808080', '#ffffff'));
    console.log('grey/black', contrastRatio('#808080', '#000000'));
    console.log('roundtrip b8492c', hexOf(rgbOf(oklchOf(rgbFrom('#b8492c')!))));
    for (const base of ['light', 'dark'] as const) {
      for (const contrast of ['normal', 'high'] as const) {
        for (const tone of ['warm', 'neutral', 'cool'] as const) {
          for (const accent of ['#b8492c', '#38bdf8', '#f59e0b', '#00ff00', '#111111', '#ffffff']) {
            const s = surfacesFrom(accent, tone, contrast, base);
            const need = contrast === 'high' ? 7 : 4.5;
            const grounds = [s.bg, s.bgRaised, s.bgSunken];
            for (const ink of ['text', 'textMuted', 'textFaint', 'accent', 'accentInk', 'danger'] as const) {
              for (const g of grounds) {
                const r = contrastRatio(s[ink], g);
                if (r < need) console.log('FAIL', base, contrast, tone, accent, ink, g, s[ink], r.toFixed(2));
              }
              const r2 = contrastRatio(s[ink], s.accentSoft);
              if ((ink === 'accentInk' || ink === 'text') && r2 < need) console.log('FAILSOFT', base, contrast, tone, accent, ink, r2.toFixed(2));
            }
            for (const g of grounds) {
              const r = contrastRatio(s.borderControl, g);
              if (r < (contrast === 'high' ? 4.5 : 3)) console.log('FAILCTRL', base, contrast, tone, accent, r.toFixed(2));
            }
            const at = contrastRatio(s.accentText, s.accent);
            if (at < need) console.log('FAILACCENTTEXT', base, contrast, tone, accent, at.toFixed(2));
          }
        }
      }
    }
    console.log(JSON.stringify(surfacesFrom('#b8492c', 'warm', 'normal', 'light'), null, 1));
    console.log(JSON.stringify(surfacesFrom('#e0714d', 'warm', 'normal', 'dark'), null, 1));
  });
});
