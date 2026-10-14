import { runContractTests } from './contract.suite.js';
import { createSupabaseRepo } from './supabase-repo.js';
import { createFakeSupabaseClient, createFakeSupabaseStore, seedFakeProfile } from '../../../tests/support/fake-supabase-client.js';

const DEFAULT_USER = '00000000-0000-4000-8000-000000000001';

async function makeRepo({ userId = DEFAULT_USER, store } = {}) {
  const sharedStore = store || createFakeSupabaseStore();
  seedFakeProfile(sharedStore, userId);
  const client = createFakeSupabaseClient({ store: sharedStore, userId });
  return createSupabaseRepo({ getUserId: () => userId, client });
}

makeRepo.createStore = createFakeSupabaseStore;
runContractTests(makeRepo);
