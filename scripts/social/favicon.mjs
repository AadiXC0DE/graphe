/** Builds the site's icons from the app icon. Google wants a square whose side
 *  is a multiple of 48, and falls back to /favicon.ico when nothing is declared. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const py = `
from PIL import Image
src = Image.open('build/icon.png').convert('RGBA')
mark = src.crop(src.split()[3].getbbox())           # drop the launcher padding

# Flatten onto the mark's own black so a transparent corner never shows through.
def at(size):
    out = Image.new('RGB', (size, size), (19, 17, 16))
    out.paste(mark.resize((size, size), Image.LANCZOS), (0, 0), mark.resize((size, size), Image.LANCZOS))
    return out

at(96).save('site/favicon-96x96.png')
at(192).save('site/favicon-192x192.png')
at(180).save('site/apple-touch-icon.png')
at(256).save('site/favicon.ico', sizes=[(16,16),(32,32),(48,48)])
print('icons written')
`;
execFileSync('python3', ['-c', py], { cwd: fileURLToPath(new URL('../..', import.meta.url)), stdio: 'inherit' });
