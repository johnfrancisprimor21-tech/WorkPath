import { el } from '../shared/dom.js';

const ITEMS = [
  ['/app', 'Home'],
  ['/employed/shifts', 'Shifts'],
  ['/employed/jobs', 'Jobs']
];

export function renderEmployedNavigation(activePath) {
  const nav = el('nav', { className: 'employed-nav', attrs: { 'aria-label': 'Employed navigation' } });
  for (const [path, label] of ITEMS) {
    nav.append(el('a', {
      className: path === activePath ? 'employed-nav-link active' : 'employed-nav-link',
      text: label,
      attrs: { href: '#' + path, 'aria-current': path === activePath ? 'page' : null }
    }));
  }
  return nav;
}
