import { renderAuthScreen, authErrorMessage } from './auth/screens.js';
import { renderDashboard } from './shared/dashboard.js';
import { el, makeButton, pageCard } from './shared/dom.js';
import { navigate, routeFromHash, watchRoutes } from './shared/router.js';
import { renderOnboarding } from './onboarding/onboarding.js';
import { getSupabaseClient } from './supabase.js';
import {
  clearRepo,
  configureIndexedDbRepo,
  configureSupabaseRepo,
  getRepo,
  getStorageMode,
  setStorageMode
} from './data/index.js';
import { hasLocalProfile } from './data/indexeddb-repo.js';
import { renderJobsPage } from './employed/jobs.js';
import { renderShiftsPage } from './employed/shifts.js';
import { renderPayrollPage } from './employed/payroll.js';
import { renderEmployedStatisticsPage, renderJobSeekerStatisticsPage } from './shared/statistics-screen.js';
import { renderApplicationsPage } from './job-seeker/applications.js';
import { renderSettingsPage } from './shared/settings.js';
import { currentMonthInTimeZone } from './shared/time.js';
import { countApplicationStatuses, summarizeShifts } from './shared/aggregations.js';
import { monthDateRange } from './shared/shift-summary.js';

const root = document.getElementById('app');

const state = {
  storageMode: getStorageMode(),
  localProfileExists: false,
  storageProtected: false,
  authReady: false,
  authError: null,
  session: null,
  profile: null,
  profileLoading: false,
  profileError: null,
  pendingEmail: null,
  notice: null,
  noticeKind: 'success'
};

let supabase;
let authSubscription = null;
let localRepo = null;
let dashboardView = null;
let employedStatsRange = 6;
let sessionVersion = 0;
let restoringSession = true;
let sawAuthEventDuringRestore = false;
let queuedRestoreSession = null;

watchRoutes(renderRoute);
void initializeStorageMode();

async function initializeStorageMode() {
  if (state.storageMode === 'local') {
    await initializeLocalMode();
    return;
  }
  await initializeAccountMode();
}

async function initializeAccountMode() {
  renderLoading('Restoring your session…');
  try {
    state.localProfileExists = await hasLocalProfile();
    setupAccountAuth();
    await restoreSession();
  } catch (error) {
    restoringSession = false;
    if (String(error.message || '').startsWith('Missing Supabase configuration:')) {
      showFatalError(error.message);
      return;
    }
    state.authReady = true;
    state.authError = error.message || 'The app could not start.';
    renderRoute();
  }
}

function setupAccountAuth() {
  supabase = getSupabaseClient();
  configureSupabaseRepo({ getUserId: () => state.session?.user?.id || null });
  if (authSubscription) return;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (restoringSession) {
      sawAuthEventDuringRestore = true;
      queuedRestoreSession = session;
      return;
    }
    if (event === 'SIGNED_OUT' || session?.user?.id !== state.session?.user?.id) {
      queueMicrotask(() => { void loadSession(session); });
      return;
    }
    state.session = session;
  });
  authSubscription = data?.subscription || null;
}

async function initializeLocalMode() {
  state.storageMode = 'local';
  restoringSession = false;
  state.authReady = false;
  state.authError = null;
  renderLoading('Opening data on this device…');
  authSubscription?.unsubscribe();
  authSubscription = null;
  try {
    await supabase?.auth.stopAutoRefresh?.();
  } catch {
    // A previously active account client should stay idle while local mode is open.
  }
  try {
    localRepo = configureIndexedDbRepo({ getUserId: () => state.session?.user?.id || null });
    const id = await localRepo.getOrCreateLocalUserId();
    state.session = { user: { id }, storageMode: 'local' };
    await initializeStoragePersistence(localRepo);
    await loadLocalProfile();
  } catch (error) {
    state.authReady = true;
    state.profileLoading = false;
    state.authError = error.message || 'We could not open data saved on this device.';
    renderRoute();
  }
}

async function initializeStoragePersistence(repo) {
  let protection = { requested: false, protected: false };
  try {
    protection = await repo.storage.getPersistenceState();
    if (!protection.requested) {
      const shouldRequest = await repo.storage.markPersistenceRequested();
      if (shouldRequest) {
        let granted = false;
        try {
          granted = Boolean(await globalThis.navigator?.storage?.persist?.());
        } catch {
          granted = false;
        }
        await repo.storage.setPersistenceProtected(granted);
        protection = { requested: true, protected: granted };
      }
    } else if (globalThis.navigator?.storage?.persisted) {
      protection = {
        ...protection,
        protected: Boolean(await globalThis.navigator.storage.persisted().catch(() => false)) || protection.protected
      };
    }
  } catch {
    protection = { requested: true, protected: false };
  }
  state.storageProtected = Boolean(protection.protected);
}

async function loadLocalProfile() {
  const version = ++sessionVersion;
  state.authReady = true;
  state.authError = null;
  state.profile = null;
  state.profileError = null;
  state.profileLoading = true;
  state.notice = null;
  renderRoute();
  try {
    const profile = await getRepo().profile.get();
    if (version !== sessionVersion) return;
    state.profile = profile;
    state.localProfileExists = true;
  } catch (error) {
    if (version !== sessionVersion) return;
    state.profileError = error.message || 'We could not load data saved on this device.';
  } finally {
    if (version === sessionVersion) {
      state.profileLoading = false;
      renderRoute();
    }
  }
}

async function restoreSession() {
  renderLoading('Restoring your session…');
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    restoringSession = false;
    const session = sawAuthEventDuringRestore ? queuedRestoreSession : data.session;
    await loadSession(session);
  } catch {
    restoringSession = false;
    state.authReady = true;
    state.authError = 'We could not restore your session. Check your connection and refresh the page.';
    renderRoute();
  }
}

async function loadSession(session) {
  const version = ++sessionVersion;
  state.session = session || null;
  state.authReady = true;
  state.authError = null;
  state.profile = null;
  state.profileError = null;
  state.profileLoading = Boolean(session);
  state.notice = null;
  if (!session) state.pendingEmail = null;
  renderRoute();

  if (!session) return;

  try {
    const profile = await getRepo().profile.get();
    if (version !== sessionVersion) return;
    state.profile = profile;
  } catch (error) {
    if (version !== sessionVersion) return;
    state.profileError = error.message || 'We could not load your profile. Check your connection and try again.';
  } finally {
    if (version === sessionVersion) {
      state.profileLoading = false;
      renderRoute();
    }
  }
}

function renderRoute() {
  if (!root) return;
  if (!state.authReady || state.profileLoading) {
    renderLoading(state.profileLoading ? 'Loading your profile…' : 'Restoring your session…');
    return;
  }
  if (state.authError) {
    if (state.storageMode === 'local') {
      renderProblem('Local data unavailable', state.authError, {
        label: 'Try again',
        action: () => { void initializeLocalMode(); }
      }, {
        label: 'Sign in or create an account',
        action: switchToAccountAuth
      });
    } else {
      renderProblem('Session unavailable', state.authError, {
        label: 'Refresh page',
        action: () => window.location.reload()
      });
    }
    return;
  }

  const route = routeFromHash();
  if (!state.session) {
    if (route !== '/login' && route !== '/signup') {
      navigate('/login', { replace: true });
      return;
    }
    root.replaceChildren(renderAuthScreen({
      mode: route.slice(1),
      confirmationEmail: route === '/signup' ? state.pendingEmail : null,
      localProfileExists: state.localProfileExists,
      onSubmit: submitAuthForm,
      onUseLocal: switchToLocalMode,
      onConfirmation: (email) => {
        state.pendingEmail = email;
        renderRoute();
      },
      onNavigate: (path) => navigate(path)
    }));
    return;
  }

  if (state.profileError || !state.profile) {
    renderProblem('Profile unavailable', state.profileError || 'We could not load your profile.', {
      label: 'Try again',
      action: () => { void loadSession(state.session); }
    }, {
      label: 'Log out',
      action: logout
    });
    return;
  }

  if (!state.profile.onboarded) {
    if (route !== '/onboarding') {
      navigate('/onboarding', { replace: true });
      return;
    }
    try {
      root.replaceChildren(renderOnboarding(state.profile, saveOnboarding));
    } catch (error) {
      renderProblem('Setup choices unavailable', error.message, {
        label: 'Log out',
        action: logout
      });
    }
    return;
  }

  if (route === null || route === '/login' || route === '/signup' || route === '/onboarding') {
    navigate('/app', { replace: true });
    return;
  }

  if (route === '/employed/jobs' || route === '/employed/shifts' || route === '/employed/pay' || route === '/employed/stats') {
    if (state.profile.mode !== 'employed') {
      navigate('/app', { replace: true });
      return;
    }
    dashboardView = null;
    const pageOptions = { repo: getRepo(), profile: state.profile };
    try {
      root.replaceChildren(route === '/employed/jobs'
        ? renderJobsPage(pageOptions)
        : route === '/employed/shifts'
          ? renderShiftsPage(pageOptions)
          : route === '/employed/pay'
            ? renderPayrollPage(pageOptions)
            : renderEmployedStatisticsPage({
                ...pageOptions,
                selectedRange: employedStatsRange,
                onRangeChange: (value) => { employedStatsRange = value; }
              }));
    } catch (error) {
      renderProblem('Employed records unavailable', error.message || 'We could not open this page.', {
        label: 'Return home',
        action: () => navigate('/app')
      });
    }
    return;
  }

  if (route === '/seeker/applications' || route === '/seeker/stats') {
    if (state.profile.mode !== 'job_seeker') {
      navigate('/app', { replace: true });
      return;
    }
    dashboardView = null;
    const pageOptions = { repo: getRepo(), profile: state.profile };
    try {
      root.replaceChildren(route === '/seeker/applications'
        ? renderApplicationsPage(pageOptions)
        : renderJobSeekerStatisticsPage(pageOptions));
    } catch (error) {
      renderProblem('Applications unavailable', error.message || 'We could not open this page.', {
        label: 'Return home',
        action: () => navigate('/app')
      });
    }
    return;
  }

  if (route === '/settings') {
    dashboardView = null;
    try {
      root.replaceChildren(renderSettingsPage(state.profile, {
        storageMode: state.storageMode,
        storageProtected: state.storageProtected,
        onSaveSettings: saveSettings,
        onLogout: logout,
        onSwitchToAccount: switchToAccountAuth,
        onDeleteLocalData: deleteAllLocalData
      }));
    } catch (error) {
      renderProblem('Settings unavailable', error.message || 'We could not open your settings.', {
        label: 'Return home',
        action: () => navigate('/app')
      });
    }
    return;
  }

  if (route !== '/app') {
    navigate('/app', { replace: true });
    return;
  }

  try {
    const dashboardOptions = {
      notice: state.notice,
      noticeKind: state.noticeKind,
      onModeChange: changeMode,
      onOpenSettings: () => navigate('/settings'),
      loadEmploymentSummary,
      loadApplicationSummary,
    };
    if (dashboardView?.element.parentElement === root) {
      dashboardView.updateMode(state.profile, state.notice, state.noticeKind);
    } else {
      dashboardView = renderDashboard(state.profile, dashboardOptions);
      root.replaceChildren(dashboardView.element);
    }
  } catch (error) {
    renderProblem('Settings unavailable', error.message, { label: 'Log out', action: logout });
  }
}

async function loadApplicationSummary() {
  if (!state.session) throw new Error('Your session ended. Please sign in again.');
  const applications = await getRepo().applications.list();
  return countApplicationStatuses(applications);
}

async function loadEmploymentSummary() {
  if (!state.session || !state.profile) throw new Error('Your session ended. Please sign in again.');
  const range = monthDateRange(currentMonthInTimeZone(state.profile.timezone));
  const shifts = await getRepo().shifts.listBetween(range.fromDate, range.toDate);
  return summarizeShifts(shifts);
}

async function submitAuthForm({ email, password, mode }) {
  setupAccountAuth();
  if (mode === 'signup') {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw new Error(authErrorMessage(error, mode));
    if (!data.session) return { confirmationRequired: true };
    state.pendingEmail = null;
    await loadSession(data.session);
    return { confirmationRequired: false };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authErrorMessage(error, mode));
  if (!data.session) throw new Error('We could not start your session. Please try again.');
  state.pendingEmail = null;
  await loadSession(data.session);
  return { confirmationRequired: false };
}

async function saveOnboarding(values) {
  const updated = await updateOwnProfile(values);
  state.profile = updated;
  state.notice = null;
  navigate('/app');
}

async function changeMode(mode) {
  if (mode !== 'employed' && mode !== 'job_seeker') throw new Error('Choose one of the available work modes.');
  try {
    state.profile = await updateOwnProfile({ mode });
    state.notice = 'Mode updated. Your saved data stays in place.';
    state.noticeKind = 'success';
    dashboardView?.updateMode(state.profile, state.notice, state.noticeKind);
  } catch (error) {
    state.notice = error.message;
    state.noticeKind = 'error';
    dashboardView?.updateMode(state.profile, state.notice, state.noticeKind);
    throw error;
  }
}

async function saveSettings(values) {
  state.profile = await updateOwnProfile(values);
  state.notice = null;
}

async function updateOwnProfile(values) {
  if (!state.session) throw new Error('Your session ended. Please sign in again.');
  return getRepo().profile.update(values);
}

async function switchToLocalMode() {
  setStorageMode('local');
  state.storageMode = 'local';
  state.session = null;
  state.profile = null;
  state.profileLoading = false;
  state.profileError = null;
  state.authError = null;
  state.pendingEmail = null;
  state.notice = null;
  await initializeLocalMode();
}

function switchToAccountAuth() {
  authSubscription?.unsubscribe();
  authSubscription = null;
  localRepo?.close();
  localRepo = null;
  setStorageMode('account');
  state.storageMode = 'account';
  state.session = null;
  state.profile = null;
  state.profileLoading = false;
  state.profileError = null;
  state.authError = null;
  state.authReady = true;
  state.pendingEmail = null;
  state.notice = null;
  clearRepo();
  navigate('/login', { replace: true });
  renderRoute();
}

async function deleteAllLocalData() {
  if (!localRepo) throw new Error('Local storage is unavailable. Refresh the page and try again.');
  await localRepo.deleteDatabase();
  localRepo = null;
  clearRepo();
  setStorageMode(null);
  state.storageMode = 'account';
  state.localProfileExists = false;
  state.session = null;
  state.profile = null;
  state.profileLoading = false;
  state.profileError = null;
  state.authError = null;
  state.authReady = true;
  state.pendingEmail = null;
  state.notice = null;
  navigate('/login', { replace: true });
  renderRoute();
}

async function logout() {
  if (state.storageMode === 'local') {
    switchToAccountAuth();
    return;
  }
  if (!supabase) throw new Error('We could not log you out. Please try again.');
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error('We could not log you out. Please try again.');
  state.pendingEmail = null;
  await loadSession(null);
}

function renderLoading(message) {
  const panel = el('section', { className: 'loading-panel', attrs: { role: 'status', 'aria-live': 'polite' } }, [
    el('span', { className: 'loading-spinner', attrs: { 'aria-hidden': 'true' } }),
    el('p', { text: message })
  ]);
  root.replaceChildren(el('div', { className: 'page-wrap' }, [panel]));
}

function renderProblem(title, message, primaryAction, secondaryAction) {
  const card = pageCard(title, message);
  const actions = el('div', { className: 'form-stack' });
  if (primaryAction) {
    const primary = makeButton(primaryAction.label, { className: 'button button-primary button-wide' });
    primary.addEventListener('click', primaryAction.action);
    actions.append(primary);
  }
  if (secondaryAction) {
    const secondary = makeButton(secondaryAction.label, { className: 'button button-secondary button-wide' });
    secondary.addEventListener('click', secondaryAction.action);
    actions.append(secondary);
  }
  card.append(actions);
  root.replaceChildren(el('div', { className: 'page-wrap' }, [card]));
}

function showFatalError(message) {
  const card = pageCard('Workpath needs setup', message || 'The app could not start.');
  card.append(el('p', {
    className: 'muted-copy',
    text: 'Add the required Vite environment values to .env.local and restart the development server.'
  }));
  root.replaceChildren(el('div', { className: 'page-wrap auth-page' }, [card]));
}
