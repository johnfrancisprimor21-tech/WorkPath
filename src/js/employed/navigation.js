import { el } from '../shared/dom.js';
import { createIcon } from '../shared/icons.js';

const ITEMS = [
  ['/app', 'Home', 'home'],
  ['/employed/shifts', 'Shifts', 'calendar'],
  ['/employed/pay', 'Pay', 'pay'],
  ['/employed/jobs', 'Jobs', 'jobs']
];

export function renderEmployedNavigation(activePath) {
  const nav = el('nav', { className: 'bottom-nav employed-nav', attrs: { 'aria-label': 'Employed navigation' } });
  for (const [path, label, icon] of ITEMS) {
    nav.append(el('a', {
      className: path === activePath ? 'employed-nav-link active' : 'employed-nav-link',
      attrs: { href: '#' + path, 'aria-current': path === activePath ? 'page' : null }
    }, [createIcon(icon), el('span', { text: label })]));
  }
  return nav;
}
