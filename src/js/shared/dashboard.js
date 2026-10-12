import { el, makeButton, pageCard } from './dom.js';
import { createModeChoice } from './mode-choice.js';
import { createPreferenceFields } from './profile-fields.js';
import { renderEmployedNavigation } from '../employed/navigation.js';

export function renderDashboard(profile, options) {
  const name = profile.display_name || 'Your Workpath';
  const modeLabel = profile.mode === 'employed' ? 'Employed' : 'Job Seeker';
  const card = pageCard('Hello, ' + name, 'Your current mode is ' + modeLabel + '.');
  const modeSummary = card.querySelector('.card-description');
  const navigationSlot = el('div');
  const feedback = el('p', { className: 'status-message', attrs: { role: 'status' } });
  setFeedback(feedback, options.notice, options.noticeKind || 'success');
  card.append(feedback);

  const modeChoice = createModeChoice(profile.mode, 'Work mode');
  modeChoice.element.classList.add('mode-switch');
  card.append(modeChoice.element);
  const modeStatus = el('p', { className: 'status-message', attrs: { role: 'status' } });
  card.append(modeStatus);

  const modePanel = el('section', { className: 'placeholder-panel' });
  updateModeContent(profile.mode);
  card.append(modePanel);

  const settings = renderSettings(profile, options);
  card.append(settings.element);

  for (const input of modeChoice.element.querySelectorAll('input')) {
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      settings.clearError();
      for (const choice of modeChoice.element.querySelectorAll('input')) choice.disabled = true;
      modeStatus.textContent = 'Updating mode…';
      try {
        await options.onModeChange(input.value);
      } catch (error) {
        if (!feedback.textContent) {
          modeStatus.className = 'status-message status-error';
          modeStatus.textContent = error.message || 'We could not update your mode. Please try again.';
        }
        for (const choice of modeChoice.element.querySelectorAll('input')) choice.disabled = false;
      }
    });
  }

  const logout = makeButton('Log out', { className: 'button button-secondary button-wide' });
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    logout.textContent = 'Logging out…';
    try {
      await options.onLogout();
    } catch (error) {
      modeStatus.className = 'status-message status-error';
      modeStatus.textContent = error.message || 'We could not log you out. Please try again.';
      logout.disabled = false;
      logout.textContent = 'Log out';
    }
  });
  card.append(el('div', { className: 'card-actions' }, [logout]));
  const element = el('div', { className: 'page-wrap dashboard-page' }, [navigationSlot, card]);
  updateNavigation(profile.mode);

  return {
    element,
    updateMode(updatedProfile, notice, noticeKind = 'success') {
      const updatedModeLabel = updatedProfile.mode === 'employed' ? 'Employed' : 'Job Seeker';
      modeSummary.textContent = 'Your current mode is ' + updatedModeLabel + '.';
      updateModeContent(updatedProfile.mode);
      updateNavigation(updatedProfile.mode);
      for (const choice of modeChoice.element.querySelectorAll('input')) {
        choice.checked = choice.value === updatedProfile.mode;
        choice.disabled = false;
      }
      modeStatus.textContent = '';
      modeStatus.className = 'status-message';
      settings.clearError();
      setFeedback(feedback, notice, noticeKind);
    }
  };

  function updateNavigation(mode) {
    if (mode === 'employed') navigationSlot.replaceChildren(renderEmployedNavigation('/app'));
    else navigationSlot.replaceChildren();
  }

  function updateModeContent(mode) {
    if (mode === 'employed') {
      const heading = el('h2', { text: 'Employed workspace' });
      const links = el('div', { className: 'dashboard-feature-links' }, [
        el('a', { className: 'button button-primary', text: 'Log a shift', attrs: { href: '#/employed/shifts' } }),
        el('a', { className: 'button button-secondary', text: 'My jobs', attrs: { href: '#/employed/jobs' } })
      ]);
      modePanel.replaceChildren(
        el('p', { className: 'eyebrow', text: 'YOUR DASHBOARD' }),
        heading,
        el('p', { text: 'Track jobs and record your work days.' }),
        links
      );
    } else {
      modePanel.replaceChildren(
        el('p', { className: 'eyebrow', text: 'YOUR DASHBOARD' }),
        el('h2', { text: 'Job seeker dashboard coming soon' }),
        el('p', { text: 'Switching modes changes your dashboard view. Your saved data stays in place.' })
      );
    }
  }
}

function renderSettings(profile, options) {
  const details = el('details', { className: 'settings-panel' });
  details.append(el('summary', { text: 'Settings' }));
  details.append(el('p', { className: 'muted-copy', text: 'Update your currency, pay frequency, and time zone.' }));

  const preferences = createPreferenceFields(profile, 'settings');
  const form = el('form', { className: 'form-stack', attrs: { novalidate: '' } });
  form.append(preferences.element);
  const feedback = el('p', { className: 'status-message', attrs: { role: 'status' } });
  feedback.hidden = true;
  const save = makeButton('Save settings', { type: 'submit', className: 'button button-primary' });
  form.append(feedback, save);

  function clearFeedback() {
    feedback.textContent = '';
    feedback.className = 'status-message';
    feedback.hidden = true;
  }

  function clearError() {
    if (feedback.classList.contains('status-error')) clearFeedback();
  }

  for (const control of preferences.element.querySelectorAll('input, select, textarea')) {
    control.addEventListener('input', clearFeedback);
    control.addEventListener('change', clearFeedback);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFeedback();
    const validationError = preferences.validate();
    if (validationError) {
      feedback.className = 'status-message status-error';
      feedback.textContent = validationError;
      feedback.hidden = false;
      return;
    }
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await options.onSaveSettings(preferences.read());
      feedback.className = 'status-message status-success';
      feedback.textContent = 'Settings saved.';
      feedback.hidden = false;
    } catch (error) {
      feedback.className = 'status-message status-error';
      feedback.textContent = error.message || 'We could not save these settings. Please try again.';
      feedback.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = 'Save settings';
    }
  });
  details.append(form);
  return { element: details, clearError };
}

function setFeedback(element, message, kind = 'success') {
  element.textContent = message || '';
  element.className = 'status-message' + (message ? ' status-' + kind : '');
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  element.hidden = !message;
}
