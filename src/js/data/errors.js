/** A normalized repository error safe for screens to display. */
export class DataError extends Error {
  /**
   * @param {'validation'|'permission'|'not_found'|'network'|'unknown'} code
   * @param {string} message User-friendly message that does not expose backend internals.
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DataError';
    this.code = code;
  }
}
