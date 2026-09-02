/** An add-on that falls over the moment it is handed the API. */
export default function broken() {
  throw new Error('cannot start');
}
