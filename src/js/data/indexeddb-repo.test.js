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

test('version 1 local data survives the version 2 payroll store upgrade', async () => {
  const databaseName = `workpath-local-upgrade-${++sequence}`;
  databaseNames.add(databaseName);
  const localUserId = '00000000-0000-4000-8000-000000000091';
  await createVersionOneDatabase(databaseName, localUserId);

  const repo = createIndexedDbRepo({ getUserId: () => localUserId, databaseName });
  repos.push(repo);
  const profile = await repo.profile.get();
  const employments = await repo.employments.list();
  const payrollEntries = await repo.payrollEntries.list();
  assert.equal(profile.display_name, 'Before upgrade');
  assert.equal(employments[0].employer_name, 'Old job');
  assert.deepEqual(payrollEntries, []);

  const upgraded = await openDatabase(databaseName);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.objectStoreNames.contains('payroll_entries'), true);
  assert.equal(upgraded.transaction('payroll_entries').objectStore('payroll_entries').indexNames.contains('user_id_pay_date'), true);
  upgraded.close();
});

function createVersionOneDatabase(databaseName, userId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('profiles', { keyPath: 'id' }).put({
        id: userId, display_name: 'Before upgrade', mode: 'employed', currency: 'USD',
        pay_frequency: 'weekly', timezone: 'UTC', onboarded: true, created_at: '2025-01-01T00:00:00.000Z'
      });
      const employments = db.createObjectStore('employments', { keyPath: 'id' });
      employments.createIndex('user_id', 'user_id');
      employments.put({ id: 'old-job', user_id: userId, employer_name: 'Old job', is_current: true, hourly_rate: 20 });
      const shifts = db.createObjectStore('shifts', { keyPath: 'id' });
      shifts.createIndex('user_id', 'user_id');
      shifts.createIndex('user_id_work_date', ['user_id', 'work_date']);
      shifts.createIndex('employment_id', 'employment_id');
      db.createObjectStore('applications', { keyPath: 'id' });
      db.createObjectStore('applicationEvents', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

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
