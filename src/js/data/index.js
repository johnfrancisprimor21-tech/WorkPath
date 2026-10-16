import { createSupabaseRepo } from './supabase-repo.js';
import { createIndexedDbRepo, deleteIndexedDbDatabase, hasLocalProfile, LOCAL_DATABASE_NAME } from './indexeddb-repo.js';

export const STORAGE_MODE_KEY = 'workpath.storageMode';
let activeRepo = null;
let inMemoryStorageMode = 'account';

export function configureSupabaseRepo(options) {
  activeRepo = createSupabaseRepo(options);
  return activeRepo;
}

export function configureIndexedDbRepo(options) {
  activeRepo = createIndexedDbRepo(options);
  return activeRepo;
}

/** Return only read methods for an existing on-device profile, without creating local data. */
export async function getReadOnlyLocalRepo() {
  if (!await hasLocalProfile({ databaseName: LOCAL_DATABASE_NAME })) return null;
  const identityRepo = createIndexedDbRepo({ getUserId: () => null });
  let localUserId;
  try {
    localUserId = await identityRepo.getOrCreateLocalUserId();
  } finally {
    identityRepo.close();
  }
  const repo = createIndexedDbRepo({
    getUserId: () => localUserId,
    databaseName: LOCAL_DATABASE_NAME
  });
  return {
    profile: { get: () => repo.profile.get() },
    employments: { list: () => repo.employments.list() },
    shifts: { listBetween: (fromDate, toDate) => repo.shifts.listBetween(fromDate, toDate) },
    payrollEntries: {
      list: (options) => repo.payrollEntries.list(options),
      listBetween: (fromDate, toDate) => repo.payrollEntries.listBetween(fromDate, toDate)
    },
    applications: { list: (options) => repo.applications.list(options) },
    applicationEvents: { listForApplication: (applicationId) => repo.applicationEvents.listForApplication(applicationId) },
    close: () => repo.close()
  };
}

/** Delete the default local database after the UI has requested typed confirmation. */
export function deleteLocalDatabase() {
  return deleteIndexedDbDatabase(LOCAL_DATABASE_NAME);
}

export function getStorageMode() {
  try {
    if (!globalThis.localStorage) return inMemoryStorageMode;
    const value = globalThis.localStorage.getItem(STORAGE_MODE_KEY);
    if (value === 'local' || value === 'account') {
      inMemoryStorageMode = value;
      return value;
    }
    inMemoryStorageMode = 'account';
    return 'account';
  } catch {
    return inMemoryStorageMode;
  }
}

/** Persist a mode choice when possible; callers can still use the in-memory choice for this session. */
export function setStorageMode(mode) {
  if (mode !== 'local' && mode !== 'account' && mode !== null) {
    throw new TypeError('Storage mode must be local, account, or null.');
  }
  inMemoryStorageMode = mode || 'account';
  try {
    if (!globalThis.localStorage) return false;
    if (mode === null) globalThis.localStorage?.removeItem(STORAGE_MODE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function clearRepo() {
  activeRepo = null;
}

export function getRepo() {
  if (!activeRepo) throw new Error('The Workpath data repository is not configured.');
  return activeRepo;
}
