/** An ordinary add-on: two tools, nothing that starts work of its own. */
export default function plain(api) {
  api.registerTool({ name: 'count_words', description: 'Count the words in a file.' });
  api.registerTool({ name: 'spell_check', description: 'Check spelling in a file.' });
  api.registerCommand('spell');
}
