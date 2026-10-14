import { el, field, makeButton, pageCard } from '../shared/dom.js';
import { todayInTimeZone } from '../shared/time.js';
import { renderEmployedNavigation } from './navigation.js';

export function renderJobsPage({ repo, profile }) {
  const page = el('div', { className: 'page-wrap authenticated-page employed-page' });

  const card = pageCard('My jobs', 'Keep track of your current and past jobs.');
  page.append(card);

  const message = el('p', { className: 'status-message', attrs: { role: 'status' } });
  const addButton = makeButton('Add a job', { className: 'button button-primary' });
  const formSlot = el('div');
  const list = el('div', { className: 'record-list' });
  card.append(message, addButton, formSlot, list);

  addButton.addEventListener('click', () => openForm());
  void loadJobs();

  let loadedJobs = [];
  async function loadJobs() {
    setMessage(message, 'Loading jobs…', 'loading');
    addButton.disabled = true;
    try {
      loadedJobs = await repo.employments.list();
      setMessage(message, '', 'status');
      renderList(loadedJobs);
    } catch (error) {
      list.replaceChildren();
      setMessage(message, error.message || 'We could not save this job. Check the details and try again.', 'error');
    } finally {
      addButton.disabled = false;
    }
  }

  function renderList(jobs) {
    list.replaceChildren();
    if (!jobs.length) {
      const empty = el('section', { className: 'empty-state' }, [
        el('h2', { text: 'Add your first job' }),
        el('p', { text: 'Your job details will be available when you log shifts.' }),
        makeButton('Add your first job', { className: 'button button-primary' })
      ]);
      empty.querySelector('button').addEventListener('click', () => openForm());
      list.append(empty);
      return;
    }

    for (const job of jobs) {
      const item = el('article', { className: 'record-card' });
      const identity = el('div', { className: 'job-identity' }, [el('h2', { text: job.employer_name })]);
      if (job.job_title) identity.append(el('p', { className: 'record-subtitle', text: job.job_title }));
      const statusLabel = job.is_current ? 'Current' : 'Ended';
      item.append(el('div', { className: 'job-card-heading' }, [
        identity,
        el('span', { className: 'job-status-badge' + (job.is_current ? ' current' : ' ended'), text: statusLabel })
      ]));
      const dates = [job.start_date ? 'Started ' + job.start_date : null, !job.is_current && job.end_date ? 'Ended ' + job.end_date : null]
        .filter(Boolean);
      item.append(el('p', { className: 'record-meta', text: dates.join(' · ') }));
      item.append(el('p', {
        className: 'record-meta',
        text: job.hourly_rate === null || job.hourly_rate === ''
          ? 'Hourly rate not set'
          : 'Hourly rate: ' + (profile.currency || '') + ' ' + Number(job.hourly_rate).toFixed(2)
      }));

      const actions = el('div', { className: 'record-actions' });
      const editButton = makeButton('Edit', { className: 'button button-secondary' });
      editButton.addEventListener('click', () => openForm(job));
      actions.append(editButton);

      if (job.is_current) {
        const endButton = makeButton('Mark as ended', { className: 'button button-secondary' });
        endButton.addEventListener('click', () => { void endJob(job, actions); });
        actions.append(endButton);
      }

      const deleteButton = makeButton('Delete', { className: 'button button-secondary' });
      deleteButton.addEventListener('click', () => showDeleteConfirmation(job, actions));
      actions.append(deleteButton);
      item.append(actions);
      list.append(item);
    }
  }

  function openForm(job = null) {
    const form = el('form', { className: 'record-form form-stack', attrs: { novalidate: '' } });
    const title = el('h2', { text: job ? 'Edit job' : 'Add a job' });
    const employerName = el('input', { attrs: { type: 'text', name: 'employer_name', maxlength: '100', required: '' } });
    employerName.value = job?.employer_name || '';
    const jobTitle = el('input', { attrs: { type: 'text', name: 'job_title' } });
    jobTitle.value = job?.job_title || '';
    const hourlyRate = el('input', { attrs: { type: 'number', name: 'hourly_rate', min: '0', step: '0.01' } });
    hourlyRate.value = job?.hourly_rate ?? '';
    const startDate = el('input', { attrs: { type: 'date', name: 'start_date' } });
    startDate.value = job?.start_date || '';
    const endDate = el('input', { attrs: { type: 'date', name: 'end_date' } });
    endDate.value = job?.end_date || '';
    const current = el('input', { attrs: { type: 'checkbox', name: 'is_current' } });
    current.checked = job ? job.is_current : true;

    form.append(
      title,
      field('Employer name', employerName),
      field('Job title', jobTitle),
      field('Hourly rate (' + (profile.currency || 'currency') + ')', hourlyRate),
      field('Start date', startDate),
      field('End date (optional)', endDate),
      el('label', { className: 'checkbox-control' }, [current, el('span', { text: 'This is my current job' })])
    );
    const feedback = el('p', { className: 'status-message', attrs: { role: 'alert' } });
    const saveButton = makeButton(job ? 'Save job' : 'Add job', { type: 'submit', className: 'button button-primary' });
    const cancelButton = makeButton('Cancel', { className: 'button button-secondary' });
    const actions = el('div', { className: 'record-actions' }, [saveButton, cancelButton]);
    form.append(feedback, actions);
    cancelButton.addEventListener('click', () => formSlot.replaceChildren());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.textContent = '';
      const name = employerName.value.trim();
      const rate = hourlyRate.value === '' ? null : Number(hourlyRate.value);
      if (!name) {
        feedback.textContent = 'Enter an employer name.';
        employerName.focus();
        return;
      }
      if (name.length > 100) {
        feedback.textContent = 'Employer name must be 100 characters or fewer.';
        employerName.focus();
        return;
      }
      if (rate !== null && (!Number.isFinite(rate) || rate < 0 || hourlyRate.validity.stepMismatch)) {
        feedback.textContent = 'Enter a valid hourly rate of zero or more, using up to two decimal places.';
        hourlyRate.focus();
        return;
      }
      if (startDate.value && endDate.value && endDate.value < startDate.value) {
        feedback.textContent = 'End date cannot be before the start date.';
        endDate.focus();
        return;
      }

      const values = {
        employer_name: name,
        job_title: jobTitle.value.trim() || null,
        hourly_rate: rate,
        start_date: startDate.value || null,
        end_date: endDate.value || null,
        is_current: current.checked
      };
      setPageButtonsBusy(true);
      setFormBusy(form, true);
      try {
        if (job) await repo.employments.update(job.id, values);
        else await repo.employments.create(values);
        formSlot.replaceChildren();
        await loadJobs();
      } catch (error) {
        feedback.textContent = error.message || 'We could not save this job. Check the details and try again.';
      } finally {
        setFormBusy(form, false);
        setPageButtonsBusy(false);
      }
    });
    formSlot.replaceChildren(form);
    employerName.focus();
  }

  async function endJob(job, actions) {
    const endDate = todayInTimeZone(profile.timezone);
    if (job.start_date && endDate < job.start_date) {
      setMessage(message, 'A job cannot end before its start date.', 'error');
      return;
    }
    setPageButtonsBusy(true);
    try {
      await repo.employments.update(job.id, { is_current: false, end_date: endDate });
      await loadJobs();
    } catch (error) {
      setMessage(message, error.message || 'We could not save this job. Check the details and try again.', 'error');
    } finally {
      setPageButtonsBusy(false);
    }
  }

  function showDeleteConfirmation(job, actions) {
    actions.replaceChildren(el('p', {
      className: 'inline-confirmation-copy',
      text: 'Delete this job? Existing shifts and paydays will stay but lose their employer link.'
    }));
    const confirm = makeButton('Delete job', { className: 'button button-danger' });
    const cancel = makeButton('Keep job', { className: 'button button-secondary' });
    actions.append(confirm, cancel);
    cancel.addEventListener('click', () => renderListFromCurrentData());
    confirm.addEventListener('click', async () => {
      setPageButtonsBusy(true);
      try {
        await repo.employments.remove(job.id);
        await loadJobs();
      } catch (error) {
        setMessage(message, error.message || 'We could not save this job. Check the details and try again.', 'error');
      } finally {
        setPageButtonsBusy(false);
      }
    });
  }

  function renderListFromCurrentData() {
    renderList(loadedJobs);
  }

  function setPageButtonsBusy(busy) {
    for (const button of page.querySelectorAll('button')) button.disabled = busy;
  }

  page.append(renderEmployedNavigation('/employed/jobs'));
  return page;
}

function setMessage(element, message, kind) {
  element.textContent = message;
  element.className = 'status-message' + (kind === 'error' ? ' status-error' : '');
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  element.hidden = !message;
}

function setFormBusy(form, busy) {
  for (const control of form.querySelectorAll('input, button')) control.disabled = busy;
}
