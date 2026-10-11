import { el, makeButton, pageCard, statusMessage } from './dom.js';
import { createModeChoice } from './mode-choice.js';
import { createPreferenceFields } from './profile-fields.js';

export function renderDashboard(profile, options) {
  const name = profile.display_name || 'Your Workpath';
  const modeLabel = profile.mode === 'employed' ? 'Employed' : 'Job Seeker';
  const card = pageCard('Hello, ' + name, 'Your current mode is ' + modeLabel + '.');
  const feedback = statusMessage(options.notice, options.noticeKind || 'success');
  if (feedback) card.append(feedback);

  const modeChoice = createModeChoice(profile.mode, 'Work mode');
  modeChoice.element.classList.add('mode-switch');
  card.append(modeChoice.element);
  const modeStatus = el('p', { className: 'status-message', attrs: { role: 'status' } });
  card.append(modeStatus);

  for (const input of modeChoice.element.querySelectorAll('input')) {
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      for (const choice of modeChoice.element.querySelectorAll('input')) choice.disabled = true;
      modeStatus.textContent = 'Updating mode…';
      try {
        await options.onModeChange(input.value);
      } catch (error) {
        modeStatus.className = 'status-message status-error';
        modeStatus.textContent = error.message || 'We could not update your mode. Please try again.';
        for (const choice of modeChoice.element.querySelectorAll('input')) choice.disabled = false;
      }
    });
  }

  card.append(el('section', { className: 'placeholder-panel' }, [
    el('p', { className: 'eyebrow', text: 'YOUR DASHBOARD' }),
    el('h2', { text: profile.mode === 'employed' ? 'Employed dashboard coming soon' : 'Job seeker dashboard coming soon' }),
    el('p', { text: 'Switching modes changes your dashboard view. Your saved data stays in place.' })
  ]));

  card.append(renderSettings(profile, options));
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
  return el('div', { className: 'page-wrap dashboard-page' }, [card]);
}

function renderSettings(profile, options) {
  const details = el('details', { className: 'settings-panel' });
  details.append(el('summary', { text: 'Settings' }));
  details.append(el('p', { className: 'muted-copy', text: 'Update your currency, pay frequency, and time zone.' }));

  const preferences = createPreferenceFields(profile, 'settings');
  const form = el('form', { className: 'form-stack', attrs: { novalidate: '' } });
  form.append(preferences.element);
  const feedback = el('p', { className: 'status-message', attrs: { role: 'status' } });
  const save = makeButton('Save settings', { type: 'submit', className: 'button button-primary' });
  form.append(feedback, save);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    feedback.className = 'status-message';
    const validationError = preferences.validate();
    if (validationError) {
      feedback.className = 'status-message status-error';
      feedback.textContent = validationError;
      return;
    }
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await options.onSaveSettings(preferences.read());
      feedback.className = 'status-message status-success';
      feedback.textContent = 'Settings saved.';
    } catch (error) {
      feedback.className = 'status-message status-error';
      feedback.textContent = error.message || 'We could not save these settings. Please try again.';
    } finally {
      save.disabled = false;
      save.textContent = 'Save settings';
    }
  });
  details.append(form);
  return details;
}
