import { el, makeButton } from './dom.js';
import { createModeChoice } from './mode-choice.js';
import { createIcon } from './icons.js';
import { renderEmployedNavigation } from '../employed/navigation.js';
import { renderJobSeekerNavigation } from '../job-seeker/navigation.js';
import { formatWorkedMinutes } from '../employed/shift-summary.js';

export function renderDashboard(profile, options) {
  const element = el('div', { className: 'page-wrap authenticated-page dashboard-page' });
  const settingsButton = makeButton('', { className: 'icon-button' });
  settingsButton.setAttribute('aria-label', 'Open settings');
  settingsButton.append(createIcon('settings'));
  settingsButton.addEventListener('click', options.onOpenSettings);
  const header = el('header', { className: 'home-topbar' }, [
    el('p', { className: 'brand-title', text: 'Workpath' }),
    settingsButton
  ]);

  const card = el('section', { className: 'card home-card' }, [
    el('h1', { className: 'home-title', text: 'Hello, ' + (profile.display_name || 'there') }),
    el('p', { className: 'home-intro', text: 'A clear view of your work life starts here.' })
  ]);
  const modeChoice = createModeChoice(profile.mode, 'Work mode');
  modeChoice.element.classList.add('mode-switch');
  card.append(modeChoice.element);

  const feedback = el('p', { className: 'status-message', attrs: { role: 'status' } });
  setFeedback(feedback, options.notice, options.noticeKind || 'success');
  const modeStatus = el('p', { className: 'status-message', attrs: { role: 'status', 'aria-live': 'polite' } });
  const modePanel = el('section', { className: 'home-mode-panel' });
  card.append(feedback, modeStatus, modePanel);

  const navigationSlot = el('div');
  element.append(header, card, navigationSlot);
  let summaryVersion = 0;
  updateModeContent(profile.mode);
  updateNavigation(profile.mode);

  for (const input of modeChoice.element.querySelectorAll('input')) {
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      for (const choice of modeChoice.element.querySelectorAll('input')) choice.disabled = true;
      modeStatus.textContent = 'Updating mode…';
      modeStatus.className = 'status-message';
      try {
        await options.onModeChange(input.value);
      } catch (error) {
        if (!feedback.textContent) {
          modeStatus.className = 'status-message status-error';
          modeStatus.textContent = error.message || 'We could not update your mode. Please try again.';
        }
        for (const choice of modeChoice.element.querySelectorAll('input')) choice.disabled = false;
        const currentMode = modeChoice.element.querySelector('input:checked')?.value;
        for (const choice of modeChoice.element.querySelectorAll('input')) choice.checked = choice.value === currentMode;
      }
    });
  }

  return {
    element,
    updateMode(updatedProfile, notice, noticeKind = 'success') {
      updateModeContent(updatedProfile.mode);
      updateNavigation(updatedProfile.mode);
      for (const choice of modeChoice.element.querySelectorAll('input')) {
        choice.checked = choice.value === updatedProfile.mode;
        choice.disabled = false;
      }
      modeStatus.textContent = '';
      modeStatus.className = 'status-message';
      setFeedback(feedback, notice, noticeKind);
    }
  };

  function updateNavigation(mode) {
    navigationSlot.replaceChildren(mode === 'employed'
      ? renderEmployedNavigation('/app')
      : renderJobSeekerNavigation('/app'));
  }

  function updateModeContent(mode) {
    const version = ++summaryVersion;
    const employed = mode === 'employed';
    const summary = renderSummarySkeletons(employed ? 'Monthly work summary' : 'Job search summary');
    const actions = el('div', { className: 'dashboard-feature-links' });
    if (employed) {
      actions.append(
        el('a', { className: 'button button-primary', text: 'Log a shift', attrs: { href: '#/employed/shifts' } }),
        el('a', { className: 'button button-secondary', text: 'My jobs', attrs: { href: '#/employed/jobs' } })
      );
    } else {
      actions.append(
        el('a', { className: 'button button-primary', text: 'Add an application', attrs: { href: '#/seeker/applications?add=1' } }),
        el('a', { className: 'button button-secondary', text: 'View applications', attrs: { href: '#/seeker/applications' } })
      );
    }
    modePanel.replaceChildren(summary, actions);
    void loadSummary(summary, version, employed);
  }

  async function loadSummary(target, version, employed) {
    try {
      const values = employed
        ? await options.loadEmploymentSummary()
        : await options.loadApplicationSummary();
      if (version !== summaryVersion) return;
      const items = employed
        ? [
            ['Total worked time', formatWorkedMinutes(values.workedMinutes)],
            ['Overtime shifts', String(values.overtimeCount)],
            ['Days worked', String(values.daysWorked)]
          ]
        : [
            ['Applied', String(values.all)],
            ['Interviews', String(values.interview)],
            ['Offers', String(values.offer)]
          ];
      target.replaceChildren(...items.map(([label, value]) => summaryTile(label, value)));
      target.setAttribute('aria-busy', 'false');
    } catch {
      if (version !== summaryVersion) return;
      target.className = 'summary-load-error';
      target.setAttribute('aria-busy', 'false');
      target.textContent = 'We could not load your summary right now. Please try again later.';
    }
  }
}

function renderSummarySkeletons(label) {
  const summary = el('section', {
    className: 'home-summary month-summary',
    attrs: { 'aria-label': label, 'aria-busy': 'true', role: 'status' }
  });
  for (let i = 0; i < 3; i += 1) {
    summary.append(el('div', { className: 'summary-item summary-skeleton', attrs: { 'aria-hidden': 'true' } }, [
      el('span', { className: 'skeleton-line skeleton-label' }),
      el('span', { className: 'skeleton-line skeleton-value' })
    ]));
  }
  return summary;
}

function summaryTile(label, value) {
  return el('div', { className: 'summary-item' }, [
    el('span', { className: 'summary-label', text: label }),
    el('strong', { className: 'summary-value', text: value })
  ]);
}

function setFeedback(element, message, kind = 'success') {
  element.textContent = message || '';
  element.className = 'status-message' + (message ? ' status-' + kind : '');
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  element.hidden = !message;
}
