import { DataError } from './errors.js';

/** Return a timestamp as an ISO-8601 UTC string with a trailing Z. */
export function normalizeTimestamp(value) {
  if (value == null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new DataError('unknown', 'We could not read this date and time. Refresh the page and try again.');
  }
  return date.toISOString();
}
