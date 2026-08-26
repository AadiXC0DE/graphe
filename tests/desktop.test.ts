/** Working this computer itself.
 *
 * The dangerous half. There is no outline of a native window to read, so the
 * method is a picture and a coordinate — which only works if the picture and
 * the coordinate agree, and if every move made from one is something a person
 * agreed to. Both are pinned here.
 */

import { writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { ToolCall, Verdict } from '../src/agent/types';
import { changesAnything, evaluate, type GuardFacts } from '../src/agent/guard/policy';
import {
  DESKTOP_WORDS,
  asMove,
  asScript,
  desktopHere,
  desktopTools,
  keyLine,
  quoted,
  readBounds,
  readLooksLike,
  readPixels,
  refusedPointing,
  type DesktopHost,
} from '../src/agent/pi/desktop';
import type { Ran } from '../src/share/run';

const ROOT = '/Users/mira/Projects/portfolio';
const ctx: GuardFacts = { projectRoot: ROOT };

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, input };
}
function kindOf(one: ToolCall): Verdict['kind'] {
  return evaluate(one, ctx).kind;
}
function ran(over: Partial<Ran> = {}): Ran {
  const out = over.out ?? '';
  return { code: 0, out, errors: '', said: out, ...over };
}

describe('where these tools exist at all', () => {
  it('is only where there is a screen we know how to read', () => {
    expect(desktopHere('darwin')).toBe(true);
    expect(desktopHere('linux')).toBe(false);
    expect(desktopHere('win32')).toBe(false);
  });
});

describe('saying it in the computer’s own language', () => {
  it('escapes anything that would end the sentence early', () => {
    expect(quoted('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoted('back\\slash')).toBe('"back\\\\slash"');
  });

  it('reads shortcuts the way people write them', () => {
    expect(keyLine('Enter')).toBe('key code 36');
    expect(keyLine('cmd+s')).toBe('keystroke "s" using {command down}');
    expect(keyLine('cmd+shift+p')).toBe('keystroke "p" using {command down, shift down}');
    expect(keyLine('shift+tab')).toBe('key code 48 using {shift down}');
  });

  it('says no rather than guessing at words that name no key', () => {
    expect(keyLine('')).toBeNull();
    expect(keyLine('wibble')).toBeNull();
    expect(keyLine('meta+q')).toBeNull();
  });

  it('lets the screen settle between moves', () => {
    expect(asScript(['click at {1, 2}'])).toContain('delay 0.15');
    expect(asScript(['click at {1, 2}']).startsWith('tell application "System Events"')).toBe(true);
  });
});

describe('one move at a time', () => {
  it('presses where it was told, in whole numbers', () => {
    const move = asMove({ do: 'click', x: 10.4, y: 20.6 });
    expect(move.kind).toBe('script');
    expect(move.kind === 'script' ? move.script : '').toBe('click at {10, 21}');
  });

  it('leaves out a press with nowhere to land', () => {
    expect(asMove({ do: 'click' }).kind).toBe('skip');
    expect(asMove({ do: 'click', x: 10 }).kind).toBe('skip');
  });

  it('types what it was given, whatever punctuation is in it', () => {
    const move = asMove({ do: 'type', text: 'he said "no"' });
    expect(move.kind === 'script' ? move.script : '').toBe('keystroke "he said \\"no\\""');
  });

  it('keeps a drag apart, because the computer cannot make one on its own', () => {
    const move = asMove({ do: 'drag', x: 1, y: 2, toX: 3, toY: 4 });
    expect(move.kind).toBe('drag');
    expect(move.kind === 'drag' ? move.args : []).toEqual(['dd:1,2', 'dm:3,4', 'du:3,4']);
  });

  it('holds a scroll and a wait to something a person would recognise', () => {
    const scroll = asMove({ do: 'scroll', way: 'up', amount: 3 });
    expect(scroll.kind === 'script' ? scroll.said : '').toContain('3 screens');
    const huge = asMove({ do: 'scroll', amount: 5000 });
    expect(huge.kind === 'script' ? huge.said : '').toContain('20 screens');
    const wait = asMove({ do: 'wait', ms: 99_999 });
    expect(wait.kind === 'script' ? wait.script : '').toBe('delay 10.00');
  });

  it('does nothing at all rather than something else, for a move it has no idea about', () => {
    expect(asMove({ do: 'pinch' }).kind).toBe('skip');
    expect(asMove({ do: 'move', x: 1, y: 2 }).kind).toBe('skip');
  });
});

describe('the picture and the pointing agree', () => {
  it('keeps a line ending out of a string the computer has to read', () => {
    expect(quoted('one\ntwo')).toBe('"one" & return & "two"');
    expect(quoted('plain')).toBe('"plain"');
  });

  it('has a second way to ask how big the screen is', () => {
    expect(readLooksLike('  Resolution: 3024 x 1964 Retina\n  UI Looks like: 1512 x 982')).toEqual({
      width: 1512,
      height: 982,
    });
    expect(readLooksLike('no displays here')).toBeNull();
  });

  it('measures the picture it is about to hand over', () => {
    expect(readPixels('  pixelWidth: 1440\n  pixelHeight: 900')).toEqual({ width: 1440, height: 900 });
    expect(readPixels('pixelWidth: 1440')).toBeNull();
  });

  it('reads the screen’s own size off the computer', () => {
    expect(readBounds('0, 0, 1440, 900')).toEqual({ width: 1440, height: 900 });
    expect(readBounds('nothing useful')).toBeNull();
    expect(readBounds('0, 0, 0, 0')).toBeNull();
  });

  it('says how big the picture is, in the numbers to point at', async () => {
    const host: DesktopHost = (tool, args) => {
      if (tool === 'osascript' && args.join(' ').includes('bounds')) {
        return Promise.resolve(ran({ out: '0, 0, 1440, 900' }));
      }
      if (tool === 'osascript') return Promise.resolve(ran({ out: 'Figma' }));
      if (tool === 'screencapture') {
        // Nothing is written, so the picture cannot be read back — which is the
        // path a refused permission takes too.
        return Promise.resolve(ran({ code: 1, said: 'no' }));
      }
      return Promise.resolve(ran());
    };
    const tools = desktopTools(ROOT, host);
    const shot = tools.find((one) => one.name === 'desktop_picture');
    const result = await shot?.execute('call-1', {}, undefined, undefined, undefined as never);
    const said = result?.content[0];
    expect(said?.type === 'text' ? said.text : '').toBe(DESKTOP_WORDS.cannotSee);
  });
});

describe('a picture nobody can trust is no picture', () => {
  /** The picture and the pointing have to agree. A picture handed over at a
   *  size the screen is not sends every press somewhere else. */
  function machine(over: Partial<Record<string, string>> = {}): DesktopHost {
    return async (tool, args) => {
      if (tool === 'osascript' && args.join(' ').includes('bounds')) {
        return ran({ out: over['bounds'] ?? '0, 0, 1440, 900' });
      }
      if (tool === 'system_profiler') return ran({ out: over['displays'] ?? '' });
      // The real ones write a file; so do these, or the reading below is of
      // nothing and every answer is the same answer.
      if (tool === 'screencapture') {
        await writeFile(args[args.length - 1] ?? '', 'a picture', 'utf8');
        return ran();
      }
      if (tool === 'sips' && args.includes('pixelWidth')) {
        return ran({ out: over['measured'] ?? '  pixelWidth: 1440\n  pixelHeight: 900' });
      }
      if (tool === 'sips') {
        if (over['sips'] === 'no') return ran({ code: 1 });
        await writeFile(args[args.length - 1] ?? '', 'a smaller picture', 'utf8');
        return ran();
      }
      return ran({ out: 'Figma' });
    };
  }

  async function pictureSays(host: DesktopHost): Promise<string> {
    const shot = desktopTools(ROOT, host).find((one) => one.name === 'desktop_picture');
    const result = await shot?.execute('call-1', {}, undefined, undefined, undefined as never);
    const said = result?.content[0];
    return said?.type === 'text' ? said.text : '';
  }

  it('says it cannot size the screen rather than guessing at one', async () => {
    expect(await pictureSays(machine({ bounds: 'nothing', displays: '' }))).toBe(DESKTOP_WORDS.noSize);
  });

  it('falls back to what the computer says about its displays', async () => {
    const said = await pictureSays(
      machine({ bounds: 'nothing', displays: 'UI Looks like: 1440 x 900' }),
    );
    expect(said).toContain('1440 across');
  });

  it('hands nothing over when the picture did not come back the size it asked for', async () => {
    expect(await pictureSays(machine({ measured: '  pixelWidth: 2880\n  pixelHeight: 1800' }))).toBe(
      DESKTOP_WORDS.noSize,
    );
    expect(await pictureSays(machine({ sips: 'no' }))).toBe(DESKTOP_WORDS.noSize);
  });
});

describe('when the computer has not been given permission', () => {
  it('knows a refusal to let us point at things, in every wording', () => {
    expect(refusedPointing('osascript is not allowed assistive access. (-1743)')).toBe(true);
    expect(refusedPointing('Not authorized to send Apple events')).toBe(true);
    expect(refusedPointing('something else went wrong')).toBe(false);
  });

  it('opens the setting rather than describing where it is', async () => {
    const opened: string[] = [];
    const host: DesktopHost = (tool, args) => {
      if (tool === 'open') {
        opened.push(args.join(' '));
        return Promise.resolve(ran());
      }
      return Promise.resolve(ran({ code: 1, said: 'osascript is not allowed assistive access. (-1743)' }));
    };
    const tools = desktopTools(ROOT, host);
    const apps = tools.find((one) => one.name === 'desktop_apps');
    const result = await apps?.execute('call-1', {}, undefined, undefined, undefined as never);
    const said = result?.content[0];
    expect(said?.type === 'text' ? said.text : '').toBe(DESKTOP_WORDS.cannotPoint);
    expect(opened.join(' ')).toContain('Privacy_Accessibility');
  });

  it('says all of it in plain words', () => {
    for (const said of Object.values(DESKTOP_WORDS)) {
      expect(said).not.toMatch(/\b(AppleScript|osascript|System Events|accessibility API|CGEvent)\b/);
    }
  });
});

describe('what the tools do', () => {
  it('offers exactly the four, named for what they do', () => {
    expect(desktopTools(ROOT, () => Promise.resolve(ran())).map((one) => one.name).sort()).toEqual([
      'desktop_apps',
      'desktop_do',
      'desktop_open',
      'desktop_picture',
    ]);
  });

  it('says which step it could not make rather than pretending it made it', async () => {
    const host: DesktopHost = (tool, args) => {
      if (tool === 'cliclick') return Promise.resolve(ran({ code: 127, said: '' }));
      if (tool === 'screencapture') return Promise.resolve(ran({ code: 1, said: 'no' }));
      if (tool === 'osascript' && args.join(' ').includes('bounds')) {
        return Promise.resolve(ran({ out: '0, 0, 1440, 900' }));
      }
      return Promise.resolve(ran({ out: 'Figma' }));
    };
    const tools = desktopTools(ROOT, host);
    const doing = tools.find((one) => one.name === 'desktop_do');
    const result = await doing?.execute(
      'call-1',
      { steps: [{ do: 'click', x: 5, y: 5 }, { do: 'drag', x: 1, y: 1, toX: 9, toY: 9 }] },
      undefined,
      undefined,
      undefined as never,
    );
    const said = result?.content[0];
    const text = said?.type === 'text' ? said.text : '';
    expect(text).toContain('Pressed 5, 5');
    expect(text).toContain(DESKTOP_WORDS.noDrag);
  });
});

describe('the Guard has an opinion about every one of them', () => {
  it('leaves no tool for it to guess about', () => {
    for (const tool of desktopTools(ROOT, () => Promise.resolve(ran()))) {
      const verdict = evaluate(call(tool.name, { app: 'Figma' }), ctx);
      if (verdict.kind === 'confirm') {
        expect(verdict.question).not.toContain('do not fully recognise');
      }
      expect(verdict.kind).not.toBe('deny');
    }
  });

  it('lets it read the list of what is open without asking', () => {
    expect(kindOf(call('desktop_apps'))).toBe('allow');
    expect(changesAnything(call('desktop_apps'), ctx)).toBe(false);
  });

  it('asks before a picture of the whole screen, and says why', () => {
    const verdict = evaluate(call('desktop_picture'), ctx);
    expect(verdict.kind).toBe('confirm');
    expect(verdict.kind === 'confirm' ? verdict.detail ?? '' : '').toMatch(/on screen/i);
    // Seeing is not changing, so a standing "ask me first about changes" does
    // not turn this into a second question about the same look.
    expect(changesAnything(call('desktop_picture'), ctx)).toBe(false);
  });

  it('asks before working the computer, and names the program it would open', () => {
    expect(kindOf(call('desktop_do', { steps: [{ do: 'click', x: 1, y: 1 }] }))).toBe('confirm');
    const opening = evaluate(call('desktop_open', { app: 'Figma' }), ctx);
    expect(opening.kind === 'confirm' ? opening.question : '').toContain('Figma');
  });

  it('refuses to type a key into a program on this computer', () => {
    for (const field of ['text', 'keys']) {
      expect(
        kindOf(
          call('desktop_do', {
            steps: [{ do: 'type', [field]: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
          }),
        ),
        field,
      ).toBe('deny');
    }
  });

  it('keeps its questions when the ladder is only quiet about files', () => {
    const changing: GuardFacts = { projectRoot: ROOT, howFar: 'changing', stopAsking: true };
    expect(evaluate(call('desktop_do', { steps: [{ do: 'click', x: 1, y: 1 }] }), changing).kind).toBe(
      'confirm',
    );
    expect(evaluate(call('browser_click', { target: '@e1' }), changing).kind).toBe('confirm');
  });
});
