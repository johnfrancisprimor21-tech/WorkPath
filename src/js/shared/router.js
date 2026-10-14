const ROUTES = new Set(['/login', '/signup', '/onboarding', '/app', '/settings', '/employed/jobs', '/employed/shifts', '/employed/pay', '/seeker/applications']);

export function routeFromHash() {
  const path = window.location.hash.replace(/^#/, '').split('?')[0];
  return ROUTES.has(path) ? path : null;
}

export function navigate(path, options = {}) {
  const hash = '#' + path;
  if (window.location.hash === hash) return;
  if (options.replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new Event('hashchange'));
  } else {
    window.location.hash = path;
  }
}

export function watchRoutes(callback) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}
