import { el, field, makeButton, pageCard, textInput } from './dom.js';
import { createPreferenceFields } from './profile-fields.js';
import { createIcon } from './icons.js';
import { renderEmployedNavigation } from '../employed/navigation.js';
import { renderJobSeekerNavigation } from '../job-seeker/navigation.js';
import { renderTransferSection } from '../transfer/settings-transfer.js';
import { createInstallSection } from '../pwa/install.js';

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

  const storage = createStorageSection(options);
  const transfer = renderTransferSection({
    repo: options.repo,
    profile,
    storageMode: options.storageMode,
    fileApi: options.fileApi,
    getReadOnlyLocalRepo: options.getReadOnlyLocalRepo,
    onLocalCopyDeleted: options.onLocalCopyDeleted,
    fileApi: options.fileApi
  });
  const install = createInstallSection();
  card.append(form, storage.section, transfer, install);
  if (options.storageMode === 'local') {
    card.append(storage.localActions);
  } else {
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
    card.append(el('div', { className: 'settings-logout' }, [logoutStatus, logout]));
  }
  page.append(back, card, profile.mode === 'employed'
    ? renderEmployedNavigation(null)
    : renderJobSeekerNavigation(null));
  return page;
}

function createStorageSection(options) {
  const section = el('section', { className: 'storage-section' });
  section.append(el('h2', { className: 'section-title', text: 'Storage' }));
  if (options.storageMode !== 'local') {
    section.append(el('p', { className: 'storage-mode-label', text: 'Account (online)' }));
    return { section, localActions: null };
  }

  section.append(
    el('p', { className: 'storage-mode-label', text: 'On this device' }),
    el('p', {
      className: 'muted-copy',
      text: options.storageProtected
        ? 'Your browser is protecting this storage from automatic cleanup.'
        : 'Storage is not guaranteed. Your browser may clear this data.'
    })
  );

  const localActions = el('div', { className: 'local-storage-actions' });
  const switchButton = makeButton('Sign in or create an account', { className: 'button button-secondary button-wide' });
  switchButton.addEventListener('click', () => options.onSwitchToAccount());
  localActions.append(switchButton);

  const deleteForm = el('form', { className: 'form-stack delete-local-form', attrs: { novalidate: '' } });
  const confirmation = textInput({ autocomplete: 'off', maxLength: 6, minLength: 6, required: true });
  confirmation.name = 'delete_confirmation';
  confirmation.placeholder = 'DELETE';
  const confirmationField = field('Type DELETE to confirm', confirmation, {
    hint: 'This removes all data saved on this device.'
  });
  const deleteFeedback = el('p', { className: 'status-message', attrs: { role: 'alert' } });
  const deleteButton = makeButton('Delete all data on this device', {
    type: 'submit',
    className: 'button button-danger button-wide',
    disabled: true
  });
  confirmation.addEventListener('input', () => {
    deleteButton.disabled = confirmation.value !== 'DELETE';
    deleteFeedback.textContent = '';
    deleteFeedback.className = 'status-message';
  });
  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (confirmation.value !== 'DELETE') {
      deleteFeedback.className = 'status-message status-error';
      deleteFeedback.textContent = 'Type DELETE to confirm.';
      return;
    }
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting…';
    try {
      await options.onDeleteLocalData();
    } catch (error) {
      deleteFeedback.className = 'status-message status-error';
      deleteFeedback.textContent = error.message || 'We could not delete local data. Close other Workpath tabs and try again.';
      deleteButton.disabled = false;
      deleteButton.textContent = 'Delete all data on this device';
    }
  });
  deleteForm.append(confirmationField, deleteFeedback, deleteButton);
  localActions.append(deleteForm);
  return { section, localActions };
}
