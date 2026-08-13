/** The camera pointed at work that is waiting to be let in.
 *
 * Everything about it that needs a browser is here, so `holdshot.ts` — the part
 * that decides what somebody is shown at the moment they say yes — stays
 * runnable without one. A folder that will not build comes back as no pictures
 * and the sentence saying why, never as a throw.
 */

import { nativeImage } from 'electron';
import type { Look, Width } from '../design/widths';
import { makeAndServe, ShowError, showSays } from '../preview/show';
import { lookAtEveryWidth } from './capture';
import type { Looking, Photographer } from './holdshot';

/** How wide a picture is kept. Two of these per width cross to the window at
 *  once, and a full-size pair of every width is several megabytes of decision. */
const KEPT_WIDTH = 900;

/** A photograph rather than a pixel comparison, so it compresses like one. */
function smaller(shot: string): string {
  try {
    const image = nativeImage.createFromDataURL(shot);
    if (image.isEmpty()) return shot;
    const size = image.getSize();
    const fitted =
      size.width > KEPT_WIDTH ? image.resize({ width: KEPT_WIDTH, quality: 'good' }) : image;
    return `data:image/jpeg;base64,${fitted.toJPEG(74).toString('base64')}`;
  } catch {
    return shot;
  }
}

function lighter(look: Look): Look {
  return look.shot === null ? look : { ...look, shot: smaller(look.shot) };
}

async function photograph(folder: string, sizes?: readonly Width[]): Promise<Looking> {
  let ready;
  try {
    ready = await makeAndServe({ folder, says: () => undefined });
  } catch (cause) {
    return {
      looks: [],
      trouble: cause instanceof ShowError ? cause.message : showSays.didNotFinish,
    };
  }
  if (ready.kind !== 'showing') return { looks: [], trouble: ready.question };

  try {
    return { looks: (await lookAtEveryWidth(ready.serving.address, sizes)).map(lighter) };
  } catch {
    return { looks: [], trouble: showSays.didNotFinish };
  } finally {
    await ready.serving.stop().catch(() => undefined);
  }
}

/** `sizes` are the ones the project designs at, where the shell has read them
 *  out of its stylesheets; the three defaults otherwise. */
export function holdCamera(sizes?: readonly Width[]): Photographer {
  return { look: (folder) => photograph(folder, sizes) };
}
