import { el, field, makeButton, pageCard } from '../shared/dom.js';
import {
  formatDateLabel,
  formatTime,
  localDateTimeToUtc,
  todayInTimeZone,
  utcToLocalDateTime
} from '../shared/time.js';
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  countApplicationStatuses,
  isValidEmail,
  isValidHttpUrl
} from './helpers.js';
import { renderJobSeekerNavigation } from './navigation.js';
import { createIcon } from '../shared/icons.js';

const APPLICATION_COLUMNS = 'id, company, position, source, job_url, location, date_applied, status, contact_name, contact_email, notes, updated_at';
const EVENT_COLUMNS = 'id, application_id, event_type, event_date, notes';
const EVENT_TYPES = [
  ['interview', 'Interview'],
  ['follow_up', 'Follow up'],
  ['offer', 'Offer'],
  ['rejection', 'Rejection'],
  ['note', 'Note']
];
const FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
  ['rejected', 'Rejected'],
  ['no_response', 'No response']
];

export function renderApplicationsPage({ supabase, userId, profile }) {
  const page = el('div', { className: 'page-wrap authenticated-page seeker-page' });
  const card = pageCard('My applications', 'Track applications and follow each one through its timeline.');
  page.append(card);

  const message = el('p', { className: 'status-message', attrs: { role: 'status' } });
  const eventWarning = el('p', { className: 'status-warning', attrs: { role: 'status' } });
  eventWarning.hidden = true;
  const tools = el('section', { className: 'application-tools', attrs: { 'aria-label': 'Filter applications' } });
  const search = el('input', { attrs: { type: 'search', name: 'application_search', autocomplete: 'off' } });
  tools.append(field('Search company or position', search));
  const filters = el('div', { className: 'filter-chips', attrs: { 'aria-label': 'Application status filters' } });
  const filterButtons = new Map();
  for (const [status, label] of FILTERS) {
    const button = makeButton(label, { className: 'filter-chip' });
    button.setAttribute('aria-pressed', status === 'all' ? 'true' : 'false');
    button.addEventListener('click', () => {
      selectedStatus = status;
      updateFilterButtons();
      applyFilters();
    });
    filters.append(button);
    filterButtons.set(status, button);
  }
  tools.append(filters);

  const latestNote = el('p', { className: 'muted-copy latest-note', text: 'Showing the latest 500 applications.' });
  latestNote.hidden = true;
  const addButton = makeButton('', { className: 'button button-primary floating-add-button' });
  addButton.setAttribute('aria-label', 'Add an application');
  addButton.title = 'Add an application';
  addButton.append(createIcon('plus'));
  const formSlot = el('div');
  const empty = el('section', { className: 'empty-state' }, [
    el('h2', { text: 'Add your first application' }),
    el('p', { text: 'Your applications and their updates will appear here.' }),
    makeButton('Add your first application', { className: 'button button-primary' })
  ]);
  empty.querySelector('button').addEventListener('click', () => openApplicationForm());
  empty.hidden = true;
  const noMatches = el('p', { className: 'empty-filter-state', text: 'No applications match these filters.' });
  noMatches.hidden = true;
  const applicationList = el('div', { className: 'record-list application-list' });
  card.append(message, eventWarning, tools, latestNote, formSlot, empty, noMatches, applicationList);

  let applications = [];
  let selectedStatus = 'all';
  let searchText = '';
  const cardViews = new Map();
  search.addEventListener('input', () => {
    searchText = search.value.trim().toLocaleLowerCase();
    applyFilters();
  });
  addButton.addEventListener('click', () => openApplicationForm());
  void loadApplications();
  if (new URLSearchParams(window.location.hash.split('?')[1] || '').get('add') === '1') {
    openApplicationForm();
  }

  async function loadApplications() {
    setMessage(message, 'Loading applications…', 'loading');
    setPageButtonsBusy(true);
    try {
      const { data, error } = await supabase
        .from('applications')
        .select(APPLICATION_COLUMNS)
        .eq('user_id', userId)
        .order('date_applied', { ascending: false })
        .limit(500);
      if (error) throw error;
      applications = data || [];
      latestNote.hidden = applications.length < 500;
      setMessage(message, '', 'status');
      renderApplications();
    } catch (error) {
      applications = [];
      applicationList.replaceChildren();
      empty.hidden = true;
      setMessage(message, applicationError(error), 'error');
    } finally {
      setPageButtonsBusy(false);
    }
  }

  function renderApplications() {
    applicationList.replaceChildren();
    cardViews.clear();
    latestNote.hidden = applications.length < 500;
    updateFilterButtons();
    empty.hidden = applications.length !== 0;
    tools.hidden = false;
    if (!applications.length) {
      noMatches.hidden = true;
      return;
    }
    for (const application of applications) {
      const view = renderApplicationCard(application);
      cardViews.set(application.id, view);
      applicationList.append(view.card);
    }
    applyFilters();
  }

  function renderApplicationCard(application) {
    const item = el('article', { className: 'record-card application-card' });
    const initials = application.company.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map((word) => Array.from(word)[0]).join('').toLocaleUpperCase();
    const identity = el('div', { className: 'application-identity' }, [
      el('h2', { text: application.company }),
      el('p', { className: 'record-subtitle', text: application.position }),
      el('p', { className: 'record-meta', text: 'Applied ' + formatDateLabel(application.date_applied) })
    ]);
    const avatar = el('div', { className: 'application-avatar', text: initials, attrs: { 'aria-hidden': 'true' } });
    const badge = el('span', {
      className: 'application-status-badge status-' + application.status,
      text: APPLICATION_STATUS_LABELS[application.status] || application.status
    });
    item.append(el('div', { className: 'application-card-heading' }, [avatar, identity, badge]));
    if (application.location) item.append(el('p', { className: 'record-meta', text: 'Location: ' + application.location }));
    if (application.source) item.append(el('p', { className: 'record-meta', text: 'Source: ' + application.source }));

    if (application.job_url && isValidHttpUrl(application.job_url)) {
      const safeUrl = new URL(application.job_url.trim()).toString();
      const link = el('a', {
        className: 'job-url-link',
        text: 'View job posting',
        attrs: { href: safeUrl, target: '_blank', rel: 'noopener noreferrer' }
      });
      item.append(link);
    }
    if (application.notes) {
      const preview = application.notes.length > 180 ? application.notes.slice(0, 177) + '…' : application.notes;
      item.append(el('p', { className: 'record-notes notes-preview', text: preview }));
    }

    const statusSelect = el('select', { attrs: { name: 'status' } });
    for (const status of APPLICATION_STATUSES) {
      statusSelect.append(el('option', { text: APPLICATION_STATUS_LABELS[status], attrs: { value: status } }));
    }
    statusSelect.value = application.status;
    const statusControl = field('Change status', statusSelect);
    item.append(statusControl);
    const statusWarning = el('small', { className: 'status-warning', attrs: { role: 'status' } });
    statusWarning.hidden = true;
    item.append(statusWarning);
    statusSelect.addEventListener('change', () => { void changeStatus(application, statusSelect, badge, statusWarning); });

    const actions = el('div', { className: 'record-actions' });
    const edit = makeButton('Edit', { className: 'button button-secondary' });
    edit.addEventListener('click', () => openApplicationForm(application));
    const remove = makeButton('Delete', { className: 'button button-secondary' });
    const deleteArea = el('div', { className: 'inline-confirmation' });
    remove.addEventListener('click', () => showApplicationDeleteConfirmation(application, deleteArea));
    actions.append(edit, remove);
    item.append(actions, deleteArea);

    const timeline = createTimeline(application);
    item.append(timeline.details);
    return { card: item, statusSelect, badge, statusWarning, timeline };
  }

  function createTimeline(application) {
    const details = el('details', { className: 'application-timeline' });
    details.append(el('summary', { text: 'Timeline' }));
    const status = el('p', { className: 'status-message', attrs: { role: 'status' } });
    const eventList = el('div', { className: 'timeline-list' });
    const addEvent = makeButton('Add event', { className: 'button button-primary' });
    const formSlot = el('div');
    details.append(status, eventList, addEvent, formSlot);

    let events = [];
    let loaded = false;
    let loading = false;
    details.addEventListener('toggle', () => {
      if (details.open && !loaded && !loading) void loadEvents();
    });
    addEvent.addEventListener('click', () => openEventForm());

    async function loadEvents() {
      loading = true;
      setMessage(status, 'Loading timeline…', 'loading');
      addEvent.disabled = true;
      try {
        const { data, error } = await supabase
          .from('application_events')
          .select(EVENT_COLUMNS)
          .eq('application_id', application.id)
          .eq('user_id', userId)
          .order('event_date', { ascending: false });
        if (error) throw error;
        events = data || [];
        loaded = true;
        setMessage(status, '', 'status');
        renderEvents();
      } catch (error) {
        setMessage(status, eventError(error), 'error');
      } finally {
        loading = false;
        addEvent.disabled = false;
      }
    }

    function renderEvents() {
      eventList.replaceChildren();
      if (!events.length) {
        eventList.append(el('p', { className: 'muted-copy', text: 'No timeline events yet.' }));
        return;
      }
      for (const event of events) eventList.append(renderEvent(event));
    }

    function renderEvent(event) {
      const row = el('article', { className: 'timeline-event' });
      const eventLabel = event.event_type === 'status_changed'
        ? 'Status changed'
        : EVENT_TYPES.find(([value]) => value === event.event_type)?.[1] || event.event_type;
      row.append(el('h3', { text: eventLabel }));
      row.append(el('p', {
        className: 'record-meta',
        text: formatTimelineDate(event.event_date, profile.timezone)
      }));
      if (event.notes) row.append(el('p', { className: 'record-notes', text: event.notes }));
      const actionArea = el('div', { className: 'inline-confirmation' });
      if (event.event_type !== 'status_changed') {
        const edit = makeButton('Edit event', { className: 'button button-secondary' });
        edit.addEventListener('click', () => openEventForm(event));
        row.append(edit);
      }
      const remove = makeButton('Delete event', { className: 'button button-secondary' });
      remove.addEventListener('click', () => showEventDeleteConfirmation(event, actionArea));
      row.append(remove, actionArea);
      return row;
    }

    function showEventDeleteConfirmation(event, area) {
      area.replaceChildren(el('p', { className: 'inline-confirmation-copy', text: 'Delete this timeline event?' }));
      const confirm = makeButton('Delete event', { className: 'button button-danger' });
      const cancel = makeButton('Keep event', { className: 'button button-secondary' });
      area.append(confirm, cancel);
      cancel.addEventListener('click', renderEvents);
      confirm.addEventListener('click', async () => {
        setPageButtonsBusy(true);
        try {
          const { error } = await supabase
            .from('application_events')
            .delete()
            .eq('id', event.id)
            .eq('user_id', userId)
            .eq('application_id', application.id);
          if (error) throw error;
          events = events.filter((entry) => entry.id !== event.id);
          renderEvents();
        } catch (error) {
          setMessage(status, eventError(error), 'error');
        } finally {
          setPageButtonsBusy(false);
        }
      });
    }

    function openEventForm(event = null) {
      const form = el('form', { className: 'record-form form-stack', attrs: { novalidate: '' } });
      const eventType = el('select', { attrs: { name: 'event_type', required: '' } });
      for (const [value, label] of EVENT_TYPES) eventType.append(el('option', { text: label, attrs: { value } }));
      const defaultEventInstant = event ? null : new Date();
      const now = utcToLocalDateTime(event?.event_date || defaultEventInstant, profile.timezone);
      const dateTime = el('input', { attrs: { type: 'datetime-local', name: 'event_date', required: '' } });
      dateTime.value = now.date + 'T' + now.time;
      const initialDateTime = dateTime.value;
      if (event) eventType.value = event.event_type;
      const notes = el('textarea', { attrs: { name: 'notes', maxlength: '500', rows: '3' } });
      notes.value = event?.notes || '';
      const feedback = el('p', { className: 'status-message', attrs: { role: 'alert' } });
      const save = makeButton(event ? 'Save event changes' : 'Save event', { type: 'submit', className: 'button button-primary' });
      const cancel = makeButton('Cancel', { className: 'button button-secondary' });
      form.append(
        field('Event type', eventType),
        field('Date and time', dateTime),
        field('Notes (optional)', notes),
        feedback,
        el('div', { className: 'record-actions' }, [save, cancel])
      );
      cancel.addEventListener('click', () => formSlot.replaceChildren());
      form.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const noteText = notes.value.trim();
        if (noteText.length > 500) {
          feedback.textContent = 'Event notes must be 500 characters or fewer.';
          notes.focus();
          return;
        }
        let eventDate;
        try {
          if (!event && dateTime.value === initialDateTime) {
            eventDate = defaultEventInstant.toISOString();
          } else {
            const [date, time] = dateTime.value.split('T');
            eventDate = localDateTimeToUtc(date, time, profile.timezone);
          }
        } catch (error) {
          feedback.textContent = error.message || 'Choose a valid event date and time.';
          return;
        }
        setPageButtonsBusy(true);
        setFormBusy(form, true);
        try {
          const values = {
              application_id: application.id,
              user_id: userId,
              event_type: eventType.value,
              event_date: eventDate,
              notes: noteText || null
          };
          const query = event
            ? supabase.from('application_events').update(values).eq('id', event.id)
              .eq('application_id', application.id).eq('user_id', userId)
            : supabase.from('application_events').insert(values);
          const { data, error } = await query.select(EVENT_COLUMNS).single();
          if (error) throw error;
          events = event
            ? events.map((entry) => entry.id === event.id ? data : entry)
            : [data, ...events];
          events.sort((a, b) => Date.parse(b.event_date) - Date.parse(a.event_date));
          loaded = true;
          formSlot.replaceChildren();
          setMessage(status, '', 'status');
          renderEvents();
        } catch (error) {
          feedback.textContent = eventError(error);
        } finally {
          setFormBusy(form, false);
          setPageButtonsBusy(false);
        }
      });
      formSlot.replaceChildren(form);
      eventType.focus();
    }

    return { details, loadEvents };
  }

  async function changeStatus(application, select, badge, warning) {
    const previousStatus = application.status;
    const nextStatus = select.value;
    if (nextStatus === previousStatus) return;
    eventWarning.textContent = '';
    eventWarning.hidden = true;
    warning.textContent = '';
    warning.hidden = true;
    select.disabled = true;
    try {
      const { data, error } = await supabase
        .from('applications')
        .update({ status: nextStatus })
        .eq('id', application.id)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('We could not find this application to update. Refresh the page and try again.');

      application.status = nextStatus;
      badge.textContent = APPLICATION_STATUS_LABELS[nextStatus];
      badge.className = 'application-status-badge status-' + nextStatus;
      updateFilterButtons();
      applyFilters();
      try {
        const { error: eventInsertError } = await supabase.from('application_events').insert({
          application_id: application.id,
          user_id: userId,
          event_type: 'status_changed',
          event_date: new Date().toISOString(),
          notes: previousStatus + ' -> ' + nextStatus
        });
        if (eventInsertError) throw eventInsertError;
      } catch {
        warning.textContent = 'Status saved, but its timeline event could not be added.';
        warning.hidden = false;
        eventWarning.textContent = 'An application status was saved, but its timeline event could not be added.';
        eventWarning.hidden = false;
      }
      const view = cardViews.get(application.id);
      if (view?.timeline.details.open) await view.timeline.loadEvents();
    } catch (error) {
      select.value = previousStatus;
      warning.textContent = applicationError(error);
      warning.hidden = false;
    } finally {
      select.disabled = false;
    }
  }

  function updateFilterButtons() {
    const counts = countApplicationStatuses(applications);
    for (const [status, label] of FILTERS) {
      const button = filterButtons.get(status);
      button.textContent = label + ' (' + counts[status] + ')';
      button.classList.toggle('active', selectedStatus === status);
      button.setAttribute('aria-pressed', selectedStatus === status ? 'true' : 'false');
    }
  }

  function applyFilters() {
    let visibleCount = 0;
    for (const application of applications) {
      const view = cardViews.get(application.id);
      if (!view) continue;
      const matchesStatus = selectedStatus === 'all' || application.status === selectedStatus;
      const searchable = (application.company + ' ' + application.position).toLocaleLowerCase();
      const matchesSearch = !searchText || searchable.includes(searchText);
      view.card.hidden = !(matchesStatus && matchesSearch);
      if (!view.card.hidden) visibleCount += 1;
    }
    noMatches.hidden = applications.length === 0 || visibleCount > 0;
  }

  function openApplicationForm(application = null) {
    const form = el('form', { className: 'record-form form-stack', attrs: { novalidate: '' } });
    const heading = el('h2', { text: application ? 'Edit application' : 'Add an application' });
    const company = textField('company', application?.company, 100, true);
    const position = textField('position', application?.position, 100, true);
    const dateApplied = el('input', { attrs: { type: 'date', name: 'date_applied', required: '' } });
    dateApplied.value = application?.date_applied || todayInTimeZone(profile.timezone);
    const statusSelect = createStatusSelect(application?.status || 'pending');
    const source = textField('source', application?.source, 60);
    const jobUrl = el('input', { attrs: { type: 'url', name: 'job_url', inputmode: 'url' } });
    jobUrl.value = application?.job_url || '';
    const location = textField('location', application?.location, 100);
    const contactName = textField('contact_name', application?.contact_name, 100);
    const contactEmail = el('input', { attrs: { type: 'email', name: 'contact_email', autocomplete: 'email' } });
    contactEmail.value = application?.contact_email || '';
    const notes = el('textarea', { attrs: { name: 'notes', maxlength: '1000', rows: '4' } });
    notes.value = application?.notes || '';
    const feedback = el('p', { className: 'status-message', attrs: { role: 'alert' } });
    const save = makeButton(application ? 'Save changes' : 'Save application', { type: 'submit', className: 'button button-primary' });
    const cancel = makeButton('Cancel', { className: 'button button-secondary' });

    form.append(
      heading,
      field('Company', company),
      field('Position', position),
      field('Date applied', dateApplied),
      field('Status', statusSelect),
      field('Source', source),
      field('Job URL (http or https)', jobUrl),
      field('Location', location),
      field('Contact name', contactName),
      field('Contact email', contactEmail),
      field('Notes', notes),
      feedback,
      el('div', { className: 'record-actions' }, [save, cancel])
    );
    cancel.addEventListener('click', () => formSlot.replaceChildren());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.textContent = '';
      const values = {
        company: company.value.trim(),
        position: position.value.trim(),
        date_applied: dateApplied.value,
        status: statusSelect.value,
        source: source.value.trim() || null,
        job_url: jobUrl.value.trim() || null,
        location: location.value.trim() || null,
        contact_name: contactName.value.trim() || null,
        contact_email: contactEmail.value.trim() || null,
        notes: notes.value.trim() || null
      };
      const validationMessage = validateApplication(values);
      if (validationMessage) {
        feedback.textContent = validationMessage.message;
        validationMessage.control.focus();
        return;
      }
      setPageButtonsBusy(true);
      setFormBusy(form, true);
      try {
        let saved;
        if (application) {
          const { data, error } = await supabase
            .from('applications')
            .update(values)
            .eq('id', application.id)
            .eq('user_id', userId)
            .select(APPLICATION_COLUMNS)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error('We could not find this application to update. Refresh the page and try again.');
          saved = data;
          applications = applications.map((entry) => entry.id === saved.id ? saved : entry)
            .sort((a, b) => b.date_applied.localeCompare(a.date_applied))
            .slice(0, 500);
        } else {
          const { data, error } = await supabase
            .from('applications')
            .insert({ ...values, user_id: userId })
            .select(APPLICATION_COLUMNS)
            .single();
          if (error) throw error;
          saved = data;
          applications = [saved, ...applications].sort((a, b) => b.date_applied.localeCompare(a.date_applied)).slice(0, 500);
        }
        formSlot.replaceChildren();
        renderApplications();
      } catch (error) {
        feedback.textContent = applicationError(error);
      } finally {
        setFormBusy(form, false);
        setPageButtonsBusy(false);
      }
    });
    formSlot.replaceChildren(form);
    company.focus();

    function validateApplication(values) {
      if (!values.company) return { control: company, message: 'Enter a company name.' };
      if (values.company.length > 100) return { control: company, message: 'Company must be 100 characters or fewer.' };
      if (!values.position) return { control: position, message: 'Enter a position.' };
      if (values.position.length > 100) return { control: position, message: 'Position must be 100 characters or fewer.' };
      if (!values.date_applied) return { control: dateApplied, message: 'Choose the date you applied.' };
      if ((values.source || '').length > 60) return { control: source, message: 'Source must be 60 characters or fewer.' };
      if (!isValidHttpUrl(values.job_url)) return { control: jobUrl, message: 'Enter a valid http or https job URL.' };
      if ((values.location || '').length > 100) return { control: location, message: 'Location must be 100 characters or fewer.' };
      if ((values.contact_name || '').length > 100) return { control: contactName, message: 'Contact name must be 100 characters or fewer.' };
      if (!isValidEmail(values.contact_email)) return { control: contactEmail, message: 'Enter a valid contact email address.' };
      if ((values.notes || '').length > 1000) return { control: notes, message: 'Notes must be 1,000 characters or fewer.' };
      return null;
    }
  }

  function showApplicationDeleteConfirmation(application, area) {
    area.replaceChildren(el('p', {
      className: 'inline-confirmation-copy',
      text: 'Delete this application? Its timeline events will be deleted too.'
    }));
    const confirm = makeButton('Delete application', { className: 'button button-danger' });
    const cancel = makeButton('Keep application', { className: 'button button-secondary' });
    area.append(confirm, cancel);
    cancel.addEventListener('click', renderApplications);
    confirm.addEventListener('click', async () => {
      setPageButtonsBusy(true);
      try {
        const { error } = await supabase
          .from('applications')
          .delete()
          .eq('id', application.id)
          .eq('user_id', userId);
        if (error) throw error;
        applications = applications.filter((entry) => entry.id !== application.id);
        renderApplications();
      } catch (error) {
        setMessage(message, applicationError(error), 'error');
      } finally {
        setPageButtonsBusy(false);
      }
    });
  }

  function setPageButtonsBusy(busy) {
    for (const button of page.querySelectorAll('button')) button.disabled = busy;
  }

  function textField(name, value, maxLength, required = false) {
    const input = el('input', { attrs: { type: 'text', name, maxlength: maxLength, required: required ? '' : null } });
    input.value = value || '';
    return input;
  }

  function createStatusSelect(value) {
    const select = el('select', { attrs: { name: 'status', required: '' } });
    for (const status of APPLICATION_STATUSES) {
      select.append(el('option', { text: APPLICATION_STATUS_LABELS[status], attrs: { value: status } }));
    }
    select.value = value;
    return select;
  }

  page.append(addButton, renderJobSeekerNavigation('/seeker/applications'));
  return page;
}

export function formatTimelineDate(timestamp, timeZone) {
  const local = utcToLocalDateTime(timestamp, timeZone);
  return formatDateLabel(local.date) + ' · ' + formatTime(timestamp, timeZone);
}

function setMessage(element, text, kind) {
  element.textContent = text;
  element.className = 'status-message' + (kind === 'error' ? ' status-error' : '');
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  element.hidden = !text;
}

function setFormBusy(form, busy) {
  for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = busy;
}

function eventError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  if (code === '23502') return 'Add the required event details and try again.';
  if (code === '23503') return 'This application is no longer available.';
  if (code === '42501' || message.includes('row-level security')) return 'You can only change events on your own applications.';
  if (message.includes('fetch') || message.includes('network')) return 'We could not reach the database. Check your connection and try again.';
  return 'We could not load or save this timeline event. Try again.';
}

function applicationError(error) {
  if (error instanceof Error && !error.code && !error.message.includes('fetch')) return error.message;
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  if (code === '23502') return 'Company, position, and date applied are required.';
  if (code === '23503') return 'This record is no longer available.';
  if (code === '42501' || message.includes('row-level security')) return 'You can only change your own applications.';
  if (message.includes('fetch') || message.includes('network')) return 'We could not reach the database. Check your connection and try again.';
  return 'We could not load or save applications. Check the details and try again.';
}
