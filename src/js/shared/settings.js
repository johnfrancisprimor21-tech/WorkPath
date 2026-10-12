import { el, makeButton, pageCard } from './dom.js';
import { createPreferenceFields } from './profile-fields.js';
import { createIcon } from './icons.js';
import { renderEmployedNavigation } from '../employed/navigation.js';
import { renderJobSeekerNavigation } from '../job-seeker/navigation.js';

export function renderSettingsPage(profile, options) {
  const page = el('div', { className: 'page-wrap authenticated-page settings-page' });
  const back = el('a', { className: 'back-link', attrs: { href: '#/app' } }, [
    createIcon('back'),
    el('span', { text: 'Back to Home' })
  ]);
  const card = pageCard('Settings', 'Update your currency, pay frequency, and time zone.');
  const preferences = createPreferenceFields(profile, 'settings');
  const form = el('form', { className: 'form-stack', attrs: { novalidate: '' } });
  form.append(preferences.element);

  const feedback = el('p', { className: 'status-message', attrs: { role: 'status' } });
  feedback.hidden = true;
  const save = makeButton('Save settings', { type: 'submit', className: 'button button-primary button-wide' });
  form.append(feedback, save);

  function clearFeedback() {
    feedback.textContent = '';
    feedback.className = 'status-message';
    feedback.hidden = true;
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
      showFeedback(validationError, 'error');
      return;
    }
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await options.onSaveSettings(preferences.read());
      showFeedback('Settings saved.', 'success');
    } catch (error) {
      showFeedback(error.message || 'We could not save these settings. Please try again.', 'error');
    } finally {
      save.disabled = false;
      save.textContent = 'Save settings';
    }
  });

  function showFeedback(message, kind) {
    feedback.className = 'status-message status-' + kind;
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  const logoutStatus = el('p', { className: 'status-message', attrs: { role: 'alert' } });
  const logout = makeButton('Log out', { className: 'button button-secondary button-wide' });
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    logout.textContent = 'Logging out…';
    try {
      await options.onLogout();
    } catch (error) {
      logoutStatus.className = 'status-message status-error';
      logoutStatus.textContent = error.message || 'We could not log you out. Please try again.';
      logout.disabled = false;
      logout.textContent = 'Log out';
    }
  });
  card.append(form, el('div', { className: 'settings-logout' }, [logoutStatus, logout]));
  page.append(back, card, profile.mode === 'employed'
    ? renderEmployedNavigation(null)
    : renderJobSeekerNavigation(null));
  return page;
}
