/** A hook that never answers: it neither settles nor rejects, so the only way
 *  past it is to stop waiting. */
export default function hookNever(api) {
  api.on('turn_end', () => new Promise(() => {}));
}
