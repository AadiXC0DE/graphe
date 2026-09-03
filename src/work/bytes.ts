/** Sizes the way a person reads them, not the way a disk reports them.
 *
 * Its own file because the window needs it and everything else in
 * `work/storage` reaches the disk: importing it from there pulled `node:fs`
 * into the browser bundle and the build stopped.
 */

export function saysBytes(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1000) return `${String(Math.round(n))} B`;
  if (n < 1000 * 1000) return `${(n / 1000).toFixed(0)} KB`;
  if (n < 1000 * 1000 * 1000) return `${(n / (1000 * 1000)).toFixed(n < 10 * 1000 * 1000 ? 1 : 0)} MB`;
  return `${(n / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}
