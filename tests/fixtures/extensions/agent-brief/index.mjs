/** One of the two third-party helpers the plan asks for, written on its own:
 *  a goal and the files worth reading, handed to a writer. Nothing here is a
 *  name this app knows, so its calls have to be shown like any other step. */
const brief = {
  name: 'brief_the_writer',
  label: 'Brief the writer',
  description: 'Hands a goal and the files that matter to a writer and reports what came back.',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'What the writing has to achieve.' },
      files: { type: 'array', items: { type: 'string' }, description: 'The files worth reading.' },
    },
    required: ['goal'],
  },
};

export default function agentBrief(api) {
  api.registerTool({
    ...brief,
    execute: async (_id, params, _signal, onUpdate) => {
      const files = Array.isArray(params.files) ? params.files : [];
      onUpdate?.({ content: [{ type: 'text', text: `reading ${String(files.length)} files` }] });
      return {
        content: [{ type: 'text', text: `briefed: ${String(params.goal)}` }],
        details: { note: `${String(files.length)} files read` },
      };
    },
  });
}
