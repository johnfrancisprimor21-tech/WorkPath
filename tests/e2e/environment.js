import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AUTH_STATE = path.join(ROOT, 'playwright', '.auth', 'account.json');
export const PROFILE_STATE = path.join(ROOT, 'playwright', '.auth', 'profile.json');
export const BASE_URL = 'http://127.0.0.1:5173';

export function loadE2EEnvironment() {
  const file = path.join(ROOT, '.env.e2e.local');
  if (!fs.existsSync(file)) return false;
  const contents = fs.readFileSync(file, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(E2E_EMAIL|E2E_PASSWORD)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    process.env[match[1]] = unquote(match[2]);
  }
  return Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
}

export function hasE2ECredentials() {
  return Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
}

function unquote(value) {
  if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"')
    || (value[0] === "'" && value.at(-1) === "'"))) return value.slice(1, -1);
  return value;
}
