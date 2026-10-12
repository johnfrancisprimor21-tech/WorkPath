import { renderAuthScreen, authErrorMessage } from './auth/screens.js';
import { renderDashboard } from './shared/dashboard.js';
import { el, makeButton, pageCard } from './shared/dom.js';
import { navigate, routeFromHash, watchRoutes } from './shared/router.js';
import { renderOnboarding } from './onboarding/onboarding.js';
import { getSupabaseClient } from './supabase.js';
import { renderJobsPage } from './employed/jobs.js';
import { renderShiftsPage } from './employed/shifts.js';
import { renderApplicationsPage } from './job-seeker/applications.js';
import { APPLICATION_STATUSES } from './job-seeker/helpers.js';

const root = document.getElementById('app');
const PROFILE_COLUMNS = 'id, display_name, mode, currency, pay_frequency, timezone, onboarded';

const state = {
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
let dashboardView = null;
let sessionVersion = 0;
let restoringSession = true;
let sawAuthEventDuringRestore = false;
let queuedRestoreSession = null;

try {
  supabase = getSupabaseClient();
} catch (error) {
  showFatalError(error.message);
}

if (supabase) {
  watchRoutes(renderRoute);
  supabase.auth.onAuthStateChange((event, session) => {
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

  void restoreSession();
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
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', session.user.id)
      .maybeSingle();
    if (version !== sessionVersion) return;
    if (error) {
      state.profileError = profileFetchError(error);
    } else if (!data) {
      state.profileError = 'We could not find your profile. Sign out and sign in again, or contact support.';
    } else {
      state.profile = data;
    }
  } catch {
    if (version !== sessionVersion) return;
    state.profileError = 'We could not load your profile. Check your connection and try again.';
  } finally {
    if (version === sessionVersion) {
      state.profileLoading = false;
      renderRoute();
    }
  }
}

function renderRoute() {
  if (!root || !supabase) return;
  if (!state.authReady || state.profileLoading) {
    renderLoading(state.profileLoading ? 'Loading your profile…' : 'Restoring your session…');
    return;
  }
  if (state.authError) {
    renderProblem('Session unavailable', state.authError, {
      label: 'Refresh page',
      action: () => window.location.reload()
    });
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
      onSubmit: submitAuthForm,
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

  if (route === '/employed/jobs' || route === '/employed/shifts') {
    if (state.profile.mode !== 'employed') {
      navigate('/app', { replace: true });
      return;
    }
    dashboardView = null;
    const pageOptions = { supabase, userId: state.session.user.id, profile: state.profile };
    try {
      root.replaceChildren(route === '/employed/jobs'
        ? renderJobsPage(pageOptions)
        : renderShiftsPage(pageOptions));
    } catch (error) {
      renderProblem('Employed records unavailable', error.message || 'We could not open this page.', {
        label: 'Return home',
        action: () => navigate('/app')
      });
    }
    return;
  }

  if (route === '/seeker/applications') {
    if (state.profile.mode !== 'job_seeker') {
      navigate('/app', { replace: true });
      return;
    }
    dashboardView = null;
    const pageOptions = { supabase, userId: state.session.user.id, profile: state.profile };
    try {
      root.replaceChildren(renderApplicationsPage(pageOptions));
    } catch (error) {
      renderProblem('Applications unavailable', error.message || 'We could not open this page.', {
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
      onSaveSettings: saveSettings,
      loadApplicationSummary,
      onLogout: logout
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
  const userId = state.session.user.id;
  const queries = [null, ...APPLICATION_STATUSES].map(async (status) => {
    let query = supabase.from('applications').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (status) query = query.eq('status', status);
    const result = await query;
    if (result.error) throw result.error;
    return [status || 'all', result.count || 0];
  });
  return Object.fromEntries(await Promise.all(queries));
}

async function submitAuthForm({ email, password, mode }) {
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
  const { data, error } = await supabase
    .from('profiles')
    .update(values)
    .eq('id', state.session.user.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(profileSaveError(error));
  if (!data) throw new Error('We could not find your profile to update. Please sign out and sign in again.');
  return data;
}

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error('We could not log you out. Please try again.');
  state.pendingEmail = null;
  await loadSession(null);
}

function profileFetchError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('fetch') || message.includes('network')) {
    return 'We could not load your profile. Check your connection and try again.';
  }
  return 'We could not load your profile. Refresh the page and try again.';
}

function profileSaveError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('profiles_onboarded_required_fields')) {
    return 'Choose both a currency and a time zone before finishing setup.';
  }
  if (message.includes('profiles_currency_format')) {
    return 'Choose a valid three-letter currency code.';
  }
  if (code === '23514') {
    return 'Check the required profile details and try again.';
  }
  if (message.includes('fetch') || message.includes('network')) {
    return 'We could not reach the database. Check your connection and try again.';
  }
  if (code === '42501' || message.includes('row-level security')) {
    return 'We could not save these settings. Refresh the page and try again.';
  }
  return 'We could not save your profile. Check your choices and try again.';
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

function startRoute() {
  renderRoute();
}

startRoute();
