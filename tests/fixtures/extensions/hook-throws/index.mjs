/** A hook that falls over. The failure belongs to Pi's own reporting, so the
 *  budget must let it through rather than turning it into a quiet nothing. */
export default function hookThrows(api) {
  api.on('turn_end', () => {
    throw new Error('the tally blew up');
  });
}
