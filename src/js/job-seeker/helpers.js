import { APPLICATION_STATUSES, countApplicationStatuses } from '../shared/aggregations.js';

export { APPLICATION_STATUSES, countApplicationStatuses };
export const APPLICATION_STATUS_LABELS = {
  pending: 'Pending',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  no_response: 'No response'
};

export function isValidHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isValidEmail(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}
