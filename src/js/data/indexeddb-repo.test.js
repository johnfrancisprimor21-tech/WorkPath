import 'fake-indexeddb/auto';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { runContractTests } from './contract.suite.js';
import { createIndexedDbRepo, deleteIndexedDbDatabase, hasLocalProfile } from './indexeddb-repo.js';

const USER_A = '00000000-0000-4000-8000-000000000001';
const repos = [];
const databaseNames = new Set();
let sequence = 0;

function makeRepo({ userId = USER_A, store } = {}) {
  const databaseName = store?.databaseName || `workpath-contract-${++sequence}`;
  databaseNames.add(databaseName);
  const repo = createIndexedDbRepo({ getUserId: () => userId, databaseName });
  repos.push(repo);
  return repo;
}

makeRepo.createStore = () => ({ databaseName: `workpath-contract-shared-${++sequence}` });
runContractTests(makeRepo);

test('local identity is stable and existing profile detection does not create a profile', async () => {
  const databaseName = `workpath-local-identity-${++sequence}`;
  databaseNames.add(databaseName);
  const repo = createIndexedDbRepo({ getUserId: () => localId, databaseName });
  repos.push(repo);
  let localId = null;

  assert.equal(await hasLocalProfile({ databaseName }), false);
  localId = await repo.getOrCreateLocalUserId();
  assert.match(localId, /^[0-9a-f-]{36}$/i);
  assert.equal(await hasLocalProfile({ databaseName }), false);
  const profile = await repo.profile.get();
  assert.equal(profile.id, localId);
  assert.equal(profile.mode, 'job_seeker');
  assert.equal(profile.onboarded, false);
  assert.equal(await hasLocalProfile({ databaseName }), true);

  const secondRepo = createIndexedDbRepo({ getUserId: () => null, databaseName });
  repos.push(secondRepo);
  assert.equal(await secondRepo.getOrCreateLocalUserId(), localId);
});

test('deleteDatabase closes the repo and removes the entire local database', async () => {
  const databaseName = `workpath-local-delete-${++sequence}`;
  databaseNames.add(databaseName);
  const repo = createIndexedDbRepo({ getUserId: () => localId, databaseName });
  repos.push(repo);
  let localId = null;

  localId = await repo.getOrCreateLocalUserId();
  await repo.profile.get();
  assert.equal(await hasLocalProfile({ databaseName }), true);
  await repo.deleteDatabase();
  assert.equal(await hasLocalProfile({ databaseName }), false);
});

test('blocked database deletion asks the user to close other Workpath tabs', async () => {
  const databaseName = `workpath-local-delete-blocked-${++sequence}`;
  databaseNames.add(databaseName);
  const repo = createIndexedDbRepo({ getUserId: () => localId, databaseName });
  repos.push(repo);
  let localId = null;
  localId = await repo.getOrCreateLocalUserId();
  await repo.profile.get();
  const otherTab = await openDatabase(databaseName);

  await assert.rejects(repo.deleteDatabase(), /Close other Workpath tabs and try again\./);
  otherTab.close();
  await deleteIndexedDbDatabase(databaseName);
});

function openDatabase(databaseName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

after(async () => {
  for (const repo of repos) repo.close();
  for (const databaseName of databaseNames) {
    await deleteIndexedDbDatabase(databaseName);
  }
});
