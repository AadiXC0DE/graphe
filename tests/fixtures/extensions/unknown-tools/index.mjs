/** Two tools whose names no renderer here has ever heard of, one of them
 *  namespaced the way an MCP bridge names things. A call to either has to come
 *  out as an ordinary step carrying the name the add-on gave it. */
export default function unknownTools(api) {
  api.registerTool({
    name: 'wobble_the_page',
    label: 'Wobble the page',
    description: 'Nudges the page until it looks level.',
    parameters: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    execute: async (_id, params) => ({
      content: [{ type: 'text', text: `wobbled by ${String(params.amount)}` }],
    }),
  });

  api.registerTool({
    name: 'mcp__ledger__post',
    label: 'Post to the ledger',
    description: 'Posts one line to the ledger service.',
    parameters: {
      type: 'object',
      properties: { entry: { type: 'string' } },
      required: ['entry'],
    },
    execute: async (_id, params) => ({
      content: [
        { type: 'text', text: params.entry },
        { type: 'resource', resource: { uri: 'ledger://entry/1', name: 'entry-1.json' } },
      ],
      details: { note: 'posted' },
    }),
  });
}
