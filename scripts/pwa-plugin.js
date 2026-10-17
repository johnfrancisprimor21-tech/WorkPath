import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_PREFIX = 'workpath-shell-';
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icons/workpath.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];
const PROJECT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIRECTORY = resolve(PROJECT_DIRECTORY, 'public');

export function buildPrecacheList(fileNames) {
  const names = fileNames.map((entry) => typeof entry === 'string' ? entry : entry.fileName);
  const builtAssets = names
    .filter((name) => /^assets\/.*\.(?:js|css)$/i.test(name) && !/\.map$/i.test(name))
    .sort();
  return ['./index.html', ...PUBLIC_FILES.map((name) => './' + name), ...builtAssets.map((name) => './' + name)];
}

export function classifyFetchRequest({ method, url, origin, mode, scope, precacheUrls }) {
  if (method !== 'GET') return 'network';

  let requestUrl;
  try {
    requestUrl = new URL(url);
  } catch {
    return 'network';
  }
  if (requestUrl.origin !== origin) return 'network';
  if (mode === 'navigate') return 'navigation';

  const scopeUrl = scope || origin + '/';
  const isPrecached = precacheUrls.some((path) => new URL(path, scopeUrl).href === requestUrl.href);
  return isPrecached ? 'precache' : 'network';
}

export function createServiceWorkerSource({ cacheName, precacheUrls }) {
  return `const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};
const classifyFetchRequest = ${classifyFetchRequest.toString()};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => {
    return cache.addAll(PRECACHE_URLS.map((path) => new URL(path, self.registration.scope).href));
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const strategy = classifyFetchRequest({
    method: request.method,
    url: request.url,
    origin: self.location.origin,
    mode: request.mode,
    scope: self.registration.scope,
    precacheUrls: PRECACHE_URLS
  });
  if (strategy === 'network') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (strategy === 'navigation') {
      const indexUrl = new URL('./index.html', self.registration.scope).href;
      return (await cache.match(indexUrl, { ignoreVary: true })) || fetch(request);
    }
    return (await cache.match(request, { ignoreVary: true })) || fetch(request);
  })());
});
`;
}

export function workpathServiceWorkerPlugin() {
  return {
    name: 'workpath-service-worker',
    apply: 'build',
    generateBundle(_outputOptions, bundle) {
      const precacheUrls = buildPrecacheList(Object.keys(bundle));
      const hash = createHash('sha256');
      for (const url of precacheUrls) {
        const fileName = url.slice(2);
        const emitted = bundle[fileName];
        const content = emitted
          ? emitted.type === 'chunk' ? emitted.code : emitted.source
          : readFileSync(resolve(fileName === 'index.html' ? PROJECT_DIRECTORY : PUBLIC_DIRECTORY, fileName));
        hash.update(fileName).update('\0').update(content).update('\0');
      }
      const cacheHash = hash.digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: createServiceWorkerSource({
          cacheName: CACHE_PREFIX + cacheHash,
          precacheUrls
        })
      });
    }
  };
}
