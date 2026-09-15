/** An add-on that is more than one file: the tool it registers is named by a
 *  module beside it, so the whole folder is what somebody agreed to, not the
 *  entry file alone. */
import { THING } from './words.mjs';

export default function transitive(api) {
  api.registerTool({
    name: `tidy_the_${THING}`,
    label: `Tidy the ${THING}`,
    description: `Tidies the ${THING}.`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: `tidied the ${THING}` }] }),
  });
}
