import { createSupabaseRepo } from './supabase-repo.js';

let activeRepo = null;

export function configureSupabaseRepo(options) {
  activeRepo = createSupabaseRepo(options);
  return activeRepo;
}

export function getRepo() {
  if (!activeRepo) throw new Error('The Workpath data repository is not configured.');
  return activeRepo;
}
