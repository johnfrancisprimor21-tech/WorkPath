const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function registerPwaUpdates() {
  if (!import.meta.env.PROD || typeof window === 'undefined') return;
  if (!/^https?:$/.test(window.location.protocol) || window.Capacitor || !navigator.serviceWorker) return;

  let registration = null;
  let lastUpdateCheck = 0;
  let reloadRequested = false;
  let reloadStarted = false;
  const banner = createUpdateBanner();
  document.body.append(banner.element);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadRequested || reloadStarted) return;
    reloadStarted = true;
    window.location.reload();
  });

  banner.button.addEventListener('click', () => {
    const waiting = registration?.waiting;
    if (!waiting) return;
    reloadRequested = true;
    banner.button.disabled = true;
    banner.button.textContent = 'Updating…';
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });

  const showWaitingWorker = () => {
    if (registration?.waiting && navigator.serviceWorker.controller) {
      banner.element.hidden = false;
    }
  };

  const checkForUpdate = async (force = false) => {
    if (!registration) return;
    const now = Date.now();
    if (!force && now - lastUpdateCheck < UPDATE_INTERVAL_MS) return;
    lastUpdateCheck = now;
    try {
      await registration.update();
      showWaitingWorker();
    } catch (error) {
      console.warn('Workpath could not check for an app update.', error);
    }
  };

  const appBase = new URL(import.meta.env.BASE_URL, window.location.href);
  const scriptUrl = new URL('sw.js', appBase);
  navigator.serviceWorker.register(scriptUrl, {
    scope: appBase.pathname.endsWith('/') ? appBase.pathname : appBase.pathname + '/'
  }).then((value) => {
    registration = value;
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') showWaitingWorker();
      });
    });
    showWaitingWorker();
    // register() performs the startup service worker update check.
    lastUpdateCheck = Date.now();
  }).catch((error) => {
    console.warn('Workpath could not register its offline app shell.', error);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  window.setInterval(() => void checkForUpdate(), UPDATE_INTERVAL_MS);
}

function createUpdateBanner() {
  const element = document.createElement('aside');
  element.className = 'pwa-update-banner';
  element.hidden = true;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  const message = document.createElement('span');
  message.textContent = 'A new version is ready';
  const button = document.createElement('button');
  button.className = 'button button-primary pwa-reload-button';
  button.type = 'button';
  button.textContent = 'Reload';
  element.append(message, button);
  return { element, button };
}
