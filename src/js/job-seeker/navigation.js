import { el } from '../shared/dom.js';

const ITEMS = [
  ['/app', 'Home'],
  ['/seeker/applications', 'Applications']
];

export function renderJobSeekerNavigation(activePath) {
  const nav = el('nav', { className: 'employed-nav seeker-nav', attrs: { 'aria-label': 'Job seeker navigation' } });
  for (const [path, label] of ITEMS) {
    nav.append(el('a', {
      className: path === activePath ? 'employed-nav-link active' : 'employed-nav-link',
      text: label,
      attrs: { href: '#' + path, 'aria-current': path === activePath ? 'page' : null }
    }));
  }
  return nav;
}
