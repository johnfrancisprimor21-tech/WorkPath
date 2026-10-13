import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const directTableQuery = /\bsupabase\w*\.from\s*\(/i;
const clientModuleImport = /\b(?:from\s*|import\s*\()\s*['"][^'"]*(?:\/|\.)supabase\.js['"]\s*\)?/i;
const allowedClientImportFiles = new Set(['app.js']);

test('data boundary pattern flags Supabase table queries but not Array.from', () => {
  assert.equal(directTableQuery.test('supabase.from("x")'), true);
  assert.equal(directTableQuery.test('Array.from(x)'), false);
  assert.equal(clientModuleImport.test("import { getSupabaseClient } from './supabase.js'"), true);
  assert.equal(clientModuleImport.test("const client = await import('../supabase.js')"), true);
});

test('only the data layer accesses Supabase tables', () => {
  const violations = [];
  for (const file of javascriptFiles(sourceRoot)) {
    const localPath = relative(sourceRoot, file).split(sep).join('/');
    if (localPath.startsWith('data/')) continue;
    const source = readFileSync(file, 'utf8');
    if (directTableQuery.test(source)) violations.push(localPath);
    if (clientModuleImport.test(source) && !allowedClientImportFiles.has(localPath)) violations.push(localPath);
  }
  assert.deepEqual([...new Set(violations)].sort(), []);
});

function javascriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}
