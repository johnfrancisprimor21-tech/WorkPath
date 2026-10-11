import { el, field, makeButton, pageCard } from '../shared/dom.js';
import { createPreferenceFields } from '../shared/profile-fields.js';
import { createModeChoice } from '../shared/mode-choice.js';

export function renderOnboarding(profile, onSubmit) {
  const card = pageCard('Set up your profile', 'Choose your work mode and preferences. You can update these settings later.');
  const form = el('form', { className: 'form-stack', attrs: { novalidate: '' } });
  const displayName = el('input', { attrs: { type: 'text', autocomplete: 'name', maxlength: '100' } });
  displayName.name = 'display_name';
  displayName.value = profile.display_name || '';
  form.append(field('Display name (optional)', displayName));

  const modeChoice = createModeChoice(profile.mode || 'job_seeker', 'Choose your mode');
  form.append(modeChoice.element);

  const preferences = createPreferenceFields(profile, 'onboarding');
  form.append(preferences.element);

  const feedback = el('p', { className: 'status-message status-error', attrs: { role: 'alert' } });
  const submit = makeButton('Save and continue', { type: 'submit', className: 'button button-primary button-wide' });
  form.append(feedback, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    const validationError = preferences.validate();
    if (validationError) {
      feedback.textContent = validationError;
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      await onSubmit({
        display_name: displayName.value.trim() || null,
        mode: modeChoice.read(),
        ...preferences.read(),
        onboarded: true
      });
    } catch (error) {
      feedback.textContent = error.message || 'We could not save your profile. Please try again.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Save and continue';
    }
  });

  card.append(form);
  return el('div', { className: 'page-wrap' }, [card]);
}
