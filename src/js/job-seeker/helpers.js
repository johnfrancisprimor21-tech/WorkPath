export const APPLICATION_STATUSES = ['pending', 'interview', 'offer', 'rejected', 'no_response'];
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

export function countApplicationStatuses(applications) {
  const counts = { all: applications.length };
  for (const status of APPLICATION_STATUSES) counts[status] = 0;
  for (const application of applications) {
    if (Object.hasOwn(counts, application.status) && application.status !== 'all') counts[application.status] += 1;
  }
  return counts;
}
