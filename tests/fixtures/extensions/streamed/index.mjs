/** A tool that says what it is doing while it does it: the answer arrives in
 *  pieces before the answer arrives. */
export default function streamed(api) {
  api.registerTool({
    name: 'crawl_the_pages',
    label: 'Crawl the pages',
    description: 'Crawls the pages and reports each one as it goes.',
    parameters: {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    },
    execute: async (_id, params, _signal, onUpdate) => {
      const found = [];
      for (let at = 1; at <= params.count; at += 1) {
        found.push(`page ${String(at)}`);
        onUpdate?.({ content: [{ type: 'text', text: found.join('\n') }] });
      }
      return {
        content: [{ type: 'text', text: found.join('\n') }],
        details: { note: `${String(found.length)} pages` },
      };
    },
  });
}
