/** An add-on that starts turns of its own and says its tools stand on their
 *  own. The declaration is the whole point: it is the one thing that makes
 *  running it without its hooks a decision the add-on has made rather than one
 *  somebody guessed at from the outside. */
export const grapheToolsOnly = true;

export default function toolsAlone(api) {
  api.registerTool({
    name: 'tally_words',
    description: 'Counts the words in a file. Answers within the call that asked for it.',
  });
  api.registerCommand('tally');
  api.on('agent_end', async () => {
    await api.sendMessage('carry on', { triggerTurn: true });
  });
}
