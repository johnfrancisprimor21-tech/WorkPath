import { el, makeButton } from '../shared/dom.js';

let deferredPrompt = null;
let installed = isStandalone();
const sections = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notifySections();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notifySections();
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (event) => {
    installed = event.matches || Boolean(navigator.standalone);
    notifySections();
  });
}

export function createInstallSection() {
  const section = el('section', { className: 'storage-section pwa-install-section' });
  const render = () => {
    section.replaceChildren(el('h2', { className: 'section-title', text: 'Install app' }));
    if (installed || isStandalone()) {
      installed = true;
      section.append(el('p', { className: 'muted-copy', text: 'Installed' }));
    } else if (deferredPrompt) {
      const button = makeButton('Install app', { className: 'button button-secondary' });
      button.addEventListener('click', async () => {
        const promptEvent = deferredPrompt;
        if (!promptEvent) return;
        deferredPrompt = null;
        button.disabled = true;
        try {
          await promptEvent.prompt();
          await promptEvent.userChoice;
        } finally {
          notifySections();
        }
      });
      section.append(button);
    } else if (isIosSafari()) {
      section.append(el('p', { className: 'muted-copy', text: 'Tap Share, then Add to Home Screen.' }));
    } else {
      section.append(el('p', { className: 'muted-copy', text: 'This browser does not support installing Workpath.' }));
    }
  };
  sections.add({ section, render });
  render();
  return section;
}

function notifySections() {
  for (const item of sections) {
    if (!item.section.isConnected) {
      sections.delete(item);
      continue;
    }
    item.render();
  }
}

function isStandalone() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone);
}

function isIosSafari() {
  const userAgent = globalThis.navigator?.userAgent || '';
  const platform = globalThis.navigator?.platform || '';
  const isAppleMobile = /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && (globalThis.navigator?.maxTouchPoints || 0) > 1);
  return isAppleMobile && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}
