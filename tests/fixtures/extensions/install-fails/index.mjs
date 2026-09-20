/** An add-on that cannot even be read: its module falls over on the way in, so
 *  there is nothing to classify and nothing may be marked active. */
throw new Error('install-fails: the module could not be read');

export default function never(_api) {
  // Reached by nobody. The throw above is the whole of what this add-on does.
}
