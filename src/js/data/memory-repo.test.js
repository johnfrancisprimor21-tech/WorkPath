import { runContractTests } from './contract.suite.js';
import { createMemoryRepo, createMemoryStore } from './memory-repo.js';

const DEFAULT_USER = '00000000-0000-4000-8000-000000000001';

async function makeRepo({ userId = DEFAULT_USER, store } = {}) {
  return createMemoryRepo({ getUserId: () => userId, store });
}

makeRepo.createStore = createMemoryStore;
runContractTests(makeRepo);
