import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPrecacheList, classifyFetchRequest, createServiceWorkerSource } from './pwa-plugin.js';

const projectRoot = new URL('../', import.meta.url);

test('precache builder includes the app shell, public icons and hashed JS/CSS but not maps', () => {
  assert.deepEqual(buildPrecacheList([
    'assets/app-123.js',
    'assets/app-123.js.map',
    'assets/styles-456.css',
    'assets/icon.svg',
    'index.html'
  ]), [
    './index.html',
    './manifest.webmanifest',
    './icons/workpath.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './icons/apple-touch-icon.png',
    './assets/app-123.js',
    './assets/styles-456.css'
  ]);
});

test('fetch routing bypasses external and non-GET requests, serves navigations and known assets only', () => {
  const context = {
    origin: 'https://workpath.example',
    scope: 'https://workpath.example/app/',
    precacheUrls: ['./index.html', './assets/app-abc.js']
  };
  assert.equal(classifyFetchRequest({ ...context, method: 'GET', url: 'https://project.supabase.co/rest/v1/profiles', mode: 'cors' }), 'network');
  assert.equal(classifyFetchRequest({ ...context, method: 'POST', url: 'https://workpath.example/app/submit', mode: 'cors' }), 'network');
  assert.equal(classifyFetchRequest({ ...context, method: 'GET', url: 'https://workpath.example/app/employed/shifts', mode: 'navigate' }), 'navigation');
  assert.equal(classifyFetchRequest({ ...context, method: 'GET', url: 'https://workpath.example/app/assets/app-abc.js', mode: 'no-cors' }), 'precache');
  assert.equal(classifyFetchRequest({ ...context, method: 'GET', url: 'https://workpath.example/app/unknown.json', mode: 'cors' }), 'network');
});

test('generated worker waits for consent and cache-matches only precached URLs without Vary mismatches', () => {
  const source = createServiceWorkerSource({ cacheName: 'workpath-shell-0123456789ab', precacheUrls: ['./index.html'] });
  const installHandler = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('activate'"));
  assert.doesNotMatch(installHandler, /skipWaiting/);
  assert.match(source, /event\.data\?\.type === 'SKIP_WAITING'/);
  assert.match(source, /cache\.match\(request, \{ ignoreVary: true \}\)/);
});

test('manifest uses relative standalone URLs and declares real PNGs at their stated sizes', () => {
  const manifest = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', projectRoot), 'utf8'));
  assert.equal(manifest.name, 'Workpath');
  assert.equal(manifest.short_name, 'Workpath');
  assert.ok(manifest.description);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.background_color, '#0f1a17');
  assert.equal(manifest.theme_color, '#0f1a17');

  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('./'), 'icon paths should be relative');
    const bytes = readFileSync(new URL('public/' + icon.src.slice(2), projectRoot));
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const expectedSize = Number(icon.sizes.split('x')[0]);
    assert.equal(width, expectedSize, icon.src);
    assert.equal(height, expectedSize, icon.src);
    assert.equal(icon.purpose, icon.src.includes('maskable') ? 'maskable' : 'any');
  }
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  const appleIcon = readFileSync(new URL('public/icons/apple-touch-icon.png', projectRoot));
  assert.equal(appleIcon.toString('ascii', 1, 4), 'PNG');
  assert.equal(appleIcon.readUInt32BE(16), 180);
  assert.equal(appleIcon.readUInt32BE(20), 180);
});
