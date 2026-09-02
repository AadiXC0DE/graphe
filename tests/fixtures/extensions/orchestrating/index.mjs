/** An add-on that drives: it takes the end of a turn, asks for another one, and
 *  registers a tool whose work outlives the call that started it. */
const LONG = `Runs the job in the background and reports when it finishes. ${'Detail. '.repeat(768)}`;

export default function orchestrating(api) {
  api.on('agent_end', async () => {
    await api.sendMessage('carry on', { triggerTurn: true });
  });
  api.on('before_agent_start', () => {});
  api.on('tool_call', () => {});
  api.registerTool({ name: 'dispatch', description: LONG });
  api.sendMessage('starting', { triggerTurn: true });
}
