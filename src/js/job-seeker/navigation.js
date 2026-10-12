import { el } from '../shared/dom.js';
import { createIcon } from '../shared/icons.js';

const ITEMS = [
  ['/app', 'Home', 'home'],
  ['/seeker/applications', 'Applications', 'applications']
];

export function renderJobSeekerNavigation(activePath) {
  const nav = el('nav', { className: 'bottom-nav seeker-nav', attrs: { 'aria-label': 'Job seeker navigation' } });
  for (const [path, label, icon] of ITEMS) {
    nav.append(el('a', {
      className: path === activePath ? 'employed-nav-link active' : 'employed-nav-link',
      attrs: { href: '#' + path, 'aria-current': path === activePath ? 'page' : null }
    }, [createIcon(icon), el('span', { text: label })]));
  }
  return nav;
}
