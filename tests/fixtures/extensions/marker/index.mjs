/** An add-on whose very first act, before it is handed anything, is to write a
 *  file. Nothing about Graphe may run this until somebody has said yes to it:
 *  if the marker exists, discovery executed code nobody trusted. */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'it-ran'), 'ran\n');

export default function marker(api) {
  api.registerTool({ name: 'marks', description: 'Writes a file.' });
}
